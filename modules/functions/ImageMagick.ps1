function Write-MagickLog {
    param (
        [Parameter(ValueFromPipeline=$true)]
        [string]$Message
    )
    $mutex = New-Object System.Threading.Mutex($false, "Global\PosterizarrMagickLogMutex")
    try {
        $mutex.WaitOne() | Out-Null
        $Message | Out-File $global:magickLog -Append
    } finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}

function Get-OverlayAndBorderSettings {
    param (
        [string]$AddBorder,
        [string]$AddOverlay,
        [string]$SkipAddTextAndOverlay,
        [string]$SkipAddTextAndBorder,
        $PosterWithText
    )

    $LocalAddBorder = $AddBorder
    $LocalAddOverlay = $AddOverlay

    if (($SkipAddTextAndOverlay -eq 'true') -and $PosterWithText) {
        $LocalAddOverlay = 'false'
    }
    if (($SkipAddTextAndBorder -eq 'true') -and $PosterWithText) {
        $LocalAddBorder = 'false'
    }
    if ($SkipAddTextAndOverlay -eq 'true' -and $SkipAddTextAndBorder -eq 'true' -and $PosterWithText) {
        $LocalAddBorder = 'false'
        $LocalAddOverlay = 'false'
    }

    return @{
        Border = $LocalAddBorder
        Overlay = $LocalAddOverlay
    }
}

function Get-SkipTextSetting {
    param (
        [string]$SkipAddText,
        [string]$SkipAddTextAndOverlay,
        $PosterWithText
    )

    if (($SkipAddText -eq 'true' -or $SkipAddTextAndOverlay -eq 'true') -and $PosterWithText) {
        return 'true'
    }
    return 'false'
}
function Test-IsPosterizarrAsset {
    param ([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $false }

    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $buffer = New-Object byte[] 65536
            $bytesRead = $stream.Read($buffer, 0, $buffer.Length)

            # Convert to string (Try UTF8 first, then check for typical ASCII)
            $content = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)

            # Returns True if any keywords match
            return $content -match 'posterizarr|overlay|titlecard|created with posterizarr|created with ppm'
        }
        finally {
            $stream.Dispose()
        }
    }
    catch {
        return $false
    }
}
function New-TextSizeCacheKey {
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][hashtable]$Params)
    $list = [System.Collections.Generic.List[string]]::new()
    $list.Add("text=`"$Text`"")
    foreach ($k in ((($Params.Keys | ForEach-Object { $_.ToString().ToLowerInvariant() }) | Sort-Object))) {
        $v = $Params[$k]; if ($null -eq $v) { $v = '' }
        $list.Add(("{0}={1}" -f ($k.ToString().ToLowerInvariant()), ($v.ToString())))
    }
    $payload = [string]::Join('|', $list)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
    return $hash
}
function Set-TextSizeCacheEntry {
    param([Parameter(Mandatory)][string]$Key, [Parameter(Mandatory)]$Result, [string]$Path = $Global:TextSizeCachePath)

    # Ensure directory exists
    if (-not (Test-Path -LiteralPath $Path)) {
        try { '{}' | Set-Content -LiteralPath $Path -Encoding UTF8 } catch {}
    }

    $mutex = New-Object System.Threading.Mutex($false, "Global\PosterizarrTextSizeCacheMutex")
    $hasMutex = $false

    try {
        $hasMutex = $mutex.WaitOne(5000)

        $raw = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 } else { '{}' }
        if (-not $raw) { $raw = '{}' }

        try {
            $db = $raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            # If JSON is corrupt, log it and reset DB so we don't crash next time
            Write-Entry -Message "TextSizeCache JSON is corrupt. Resetting cache." -Path $global:configLogging -Color Yellow -log Warning
            $db = @{}
        }

        if ($null -eq $db) { $db = @{ } }

        $db | Add-Member -NotePropertyName $Key -NotePropertyValue $Result -Force
        ($db | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Path -Encoding UTF8
    }
    catch {
        Write-Entry -Message "Failed to write to TextSizeCache: $_" -Path $global:configLogging -Color Red -log Error
    }
    finally {
        if ($hasMutex) {
            $mutex.ReleaseMutex()
        }
        $mutex.Dispose()
    }
}
function Get-OptimalPointSize {
    param(
        [string]$text,
        [string]$fontImagemagick,
        [int]$box_width,
        [int]$box_height,
        [int]$min_pointsize,
        [int]$max_pointsize,
        [int]$lineSpacing # parameter for line height
    )

    try {
        if (-not $script:IMVersion) { $script:IMVersion = (& $magick -version | Select-Object -First 1) }

        $__tsc_Params = @{
            font = $fontImagemagick; w = $box_width; h = $box_height;
            min = $min_pointsize; max = $max_pointsize; line = $lineSpacing;
            imv = $script:IMVersion; algo = 'Get-OptimalPointSize-v1'
        }

        $__tsc_Key = New-TextSizeCacheKey -Text $text -Params $__tsc_Params
        $__tsc_Path = if ($Global:TextSizeCachePath) { $Global:TextSizeCachePath } else { Join-Path $global:ScriptRoot 'Cache\text_size_cache.json' }

        # Wrapped in try/catch to ensure corruption doesn't stop flow
        try {
            $__tsc_Hit = Get-TextSizeFromCache -Key $__tsc_Key -Path $__tsc_Path
        }
        catch {
            $__tsc_Hit = $null
        }

        if ($__tsc_Hit) {
            if ($__tsc_Hit.PSObject.Properties.Name -contains 'isTruncated') { $global:IsTruncated = [bool]$__tsc_Hit.isTruncated } else { $global:IsTruncated = $null }
            $script:CurrentTextSizeSource = 'cache'
            if ($global:tsHitsBag) { $global:tsHitsBag.Add(1) }   # [stats] count cache hits
            return [int]$__tsc_Hit.pointSize
        }
    }
    catch {
        # If cache logic fails entirely, ignore and proceed to calculate
        Write-Entry -Message "Cache lookup failed, proceeding with calculation. Error: $_" -Path $global:configLogging -Color Yellow -log Debug
    }

    $global:IsTruncated = $null

    # Construct the command with interline spacing and font option
    $cmd = "& `"$magick`" -size ${box_width}x${box_height} -font `"$fontImagemagick`" -gravity center -fill black -interline-spacing ${lineSpacing} caption:`"$text`" -format `"%[caption:pointsize]`" info:"

    # Log the command for debugging purposes
    $cmd | Out-File $magickLog -Append

    # [stats] start timing the ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“missÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â compute path
    $tsc_sw = [Diagnostics.Stopwatch]::StartNew()

    # Execute the command and get the current point size
    $current_pointsize = [int](Invoke-Expression $cmd | Out-String).Trim()

    # Apply point size limits
    if ($current_pointsize -gt $max_pointsize) {
        $current_pointsize = $max_pointsize
    }
    elseif ($current_pointsize -lt $min_pointsize) {
        Write-Entry -Subtext "Text truncated! optimalFontSize: $current_pointsize below min_pointsize: $min_pointsize" -Path $global:configLogging -Color Yellow -log Warning
        $global:IsTruncated = $true
        $current_pointsize = $min_pointsize
    }

    # [stats] stop timer and record miss metrics
    $tsc_sw.Stop()
    if ($global:tsMissMsBag -ne $null) {
        $global:tsMissMsBag.Add($tsc_sw.ElapsedMilliseconds)
    }

    # Wrapped in try/catch to ensure saving errors don't crash script
    try {
        $__tsc_Save = [PSCustomObject]@{ pointSize = [int]$current_pointsize; isTruncated = [bool]$global:IsTruncated }
        Set-TextSizeCacheEntry -Key $__tsc_Key -Result $__tsc_Save -Path $__tsc_Path
    }
    catch {
        Write-Entry -Message "Failed to save to text size cache: $_" -Path $global:configLogging -Color Yellow -log Debug
    }

    $script:CurrentTextSizeSource = 'calculated'
    return $current_pointsize
}
function CheckImageMagick {
    param (
        [string]$magick,
        [string]$magickinstalllocation
    )

    if (!(Test-Path $magick)) {
        if ($global:OSType -ne "Win32NT") {
            if ($global:OSType -ne "Docker") {
                Write-Entry -Message "ImageMagick missing, downloading the portable version for you..." -Path $global:configLogging -Color Yellow -log Warning
                $magickUrl = "https://imagemagick.org/archive/binaries/magick"
                Invoke-WebRequest -Uri $magickUrl -OutFile "$global:ScriptRoot/magick"
                chmod +x "$global:ScriptRoot/magick"
                Write-Entry -Subtext "Made the portable Magick executable..." -Path $global:configLogging -Color Green -log Info
            }
        }
        else {

            $result = Invoke-WebRequest "https://imagemagick.org/archive/binaries/?C=M;O=D"
            $LatestRelease = [regex]::Matches($result.Content, 'href="(ImageMagick-7[^"]+-portable-Q16-HDRI-x64\.7z)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 1

            Write-Entry -Message "ImageMagick missing, please manually install/copy portable Imagemagick from here: https://imagemagick.org/archive/binaries/$LatestRelease" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            Exit
        }
    }
}
function CheckOverlayDimensions {
    param (
        [string]$Posteroverlay,
        [string]$ShowPosteroverlay,
        [string]$Seasonoverlay,
        [string]$Backgroundoverlay,
        [string]$ShowBackgroundoverlay,
        [string]$Collectionoverlay,
        [string]$Titlecardoverlay,
        [string]$Posteroverlay4k,
        [string]$Posteroverlay1080p,
        [string]$Backgroundoverlay4k,
        [string]$Backgroundoverlay1080p,
        [string]$TCoverlay4k,
        [string]$TCoverlay1080p,
        [string]$PosterSize,
        [string]$BackgroundSize,
        [string]$Posteroverlay4KDoVi,
        [string]$Posteroverlay4KHDR10,
        [string]$Posteroverlay4KDoViHDR10,
        [string]$Backgroundoverlay4KDoVi,
        [string]$Backgroundoverlay4KHDR10,
        [string]$Backgroundoverlay4KDoViHDR10,
        [string]$TCoverlay4KDoVi,
        [string]$TCoverlay4KHDR10,
        [string]$TCoverlay4KDoViHDR10
    )
    # This function checks a single overlay's dimensions
    function Test-Dimension {
        param (
            [string]$OverlayPath,
            [string]$ExpectedSize,
            [string]$OverlayName
        )

        # If the path is $null or empty (i.e., optional overlay not configured),
        if ([string]::IsNullOrEmpty($OverlayPath)) {
            return
        }

        try {
            $actualDimensions = & $magick $OverlayPath -format "%wx%h" info:

            if ($actualDimensions -eq $ExpectedSize) {
                Write-Entry -Subtext "$OverlayName is correctly sized at: $ExpectedSize" -Path $global:configLogging -Color Cyan -log Info
            }
            else {
                Write-Entry -Subtext "$OverlayName is NOT correctly sized at: $ExpectedSize. Actual dimensions: $actualDimensions" -Path $global:configLogging -Color Yellow -log Warning
            }
        }
        catch {
            Write-Entry -Subtext "Failed to check dimensions for $OverlayName at path $OverlayPath. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
        }
    }

    # Standard Poster Types (expect PosterSize)
    Test-Dimension -OverlayPath $Posteroverlay -ExpectedSize $PosterSize -OverlayName "Poster overlay"
    Test-Dimension -OverlayPath $ShowPosteroverlay -ExpectedSize $PosterSize -OverlayName "Show Poster overlay"
    Test-Dimension -OverlayPath $Seasonoverlay -ExpectedSize $PosterSize -OverlayName "Season overlay"
    Test-Dimension -OverlayPath $Collectionoverlay -ExpectedSize $PosterSize -OverlayName "Collection overlay"
    Test-Dimension -OverlayPath $Posteroverlay4k -ExpectedSize $PosterSize -OverlayName "4K Poster overlay"
    Test-Dimension -OverlayPath $Posteroverlay1080p -ExpectedSize $PosterSize -OverlayName "1080p Poster overlay"

    # Standard Background/TC Types (expect BackgroundSize)
    Test-Dimension -OverlayPath $Backgroundoverlay -ExpectedSize $BackgroundSize -OverlayName "Background overlay"
    Test-Dimension -OverlayPath $ShowBackgroundoverlay -ExpectedSize $BackgroundSize -OverlayName "Show Background overlay"
    Test-Dimension -OverlayPath $Titlecardoverlay -ExpectedSize $BackgroundSize -OverlayName "TitleCard overlay"
    Test-Dimension -OverlayPath $Backgroundoverlay4k -ExpectedSize $BackgroundSize -OverlayName "4K Background overlay"
    Test-Dimension -OverlayPath $Backgroundoverlay1080p -ExpectedSize $BackgroundSize -OverlayName "1080p Background overlay"
    Test-Dimension -OverlayPath $TCoverlay4k -ExpectedSize $BackgroundSize -OverlayName "4K TitleCard overlay"
    Test-Dimension -OverlayPath $TCoverlay1080p -ExpectedSize $BackgroundSize -OverlayName "1080p TitleCard overlay"

    # 4K Poster Types (expect PosterSize)
    Test-Dimension -OverlayPath $Posteroverlay4KDoVi -ExpectedSize $PosterSize -OverlayName "4K DoVi Poster overlay"
    Test-Dimension -OverlayPath $Posteroverlay4KHDR10 -ExpectedSize $PosterSize -OverlayName "4K HDR10 Poster overlay"
    Test-Dimension -OverlayPath $Posteroverlay4KDoViHDR10 -ExpectedSize $PosterSize -OverlayName "4K DoVi/HDR10 Poster overlay"

    # 4K Background Types (expect BackgroundSize)
    Test-Dimension -OverlayPath $Backgroundoverlay4KDoVi -ExpectedSize $BackgroundSize -OverlayName "4K DoVi Background overlay"
    Test-Dimension -OverlayPath $Backgroundoverlay4KHDR10 -ExpectedSize $BackgroundSize -OverlayName "4K HDR10 Background overlay"
    Test-Dimension -OverlayPath $Backgroundoverlay4KDoViHDR10 -ExpectedSize $BackgroundSize -OverlayName "4K DoVi/HDR10 Background overlay"

    # 4K TC Types (expect BackgroundSize)
    Test-Dimension -OverlayPath $TCoverlay4KDoVi -ExpectedSize $BackgroundSize -OverlayName "4K DoVi TitleCard overlay"
    Test-Dimension -OverlayPath $TCoverlay4KHDR10 -ExpectedSize $BackgroundSize -OverlayName "4K HDR10 TitleCard overlay"
    Test-Dimension -OverlayPath $TCoverlay4KDoViHDR10 -ExpectedSize $BackgroundSize -OverlayName "4K DoVi/HDR10 TitleCard overlay"
}
function InvokeMagickCommand {
    param (
        [string]$Command,
        [string]$Arguments
    )

    $global:ImageMagickError = $null
    if ([string]::IsNullOrWhiteSpace($Arguments)) {
        Write-Entry -Subtext "Skipping: No arguments provided for magick command." -Path $global:configLogging -Color Cyan -log Debug
        return
    }
    function GetMagickErrorMessage {
        param (
            [string]$ErrorMessage
        )

        $global:ImageMagickError = $true
        $lines = $ErrorMessage -split "convert: |magick.exe: |magick: |@"

        if ($lines.Count -ge 2 -and -not [string]::IsNullOrWhiteSpace($lines[1])) {
            return $lines[1].Trim()
        }
        Else {
            # Fallback to returning the whole error
            return $ErrorMessage.Trim()
        }
    }

    try {
        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = $Command
        $processInfo.Arguments = $Arguments
        $processInfo.RedirectStandardOutput = $true
        $processInfo.RedirectStandardError = $true
        $processInfo.UseShellExecute = $false
        $processInfo.CreateNoWindow = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $processInfo

        try {
            $process.Start() | Out-Null

            # Read stdout and stderr concurrently to prevent pipe-buffer deadlock.
            # If stdout is not drained while waiting on stderr (or vice-versa), the
            # magick process blocks filling the pipe → WaitForExit never returns.
            $stdoutTask = $process.StandardOutput.ReadToEndAsync()
            $errorOutput = $process.StandardError.ReadToEnd()

            # Wait for the process to exit
            $process.WaitForExit()

            # Drain stdout (discard; only stderr carries actionable messages)
            $null = $stdoutTask.GetAwaiter().GetResult()

            # Check if there was any error output
            if (-not [string]::IsNullOrWhiteSpace($errorOutput)) {
                Write-Entry -Subtext "An error occurred while executing the magick command:" -Path $global:configLogging -Color Red -log Error
                Write-Entry -Subtext (GetMagickErrorMessage $errorOutput) -Path $global:configLogging -Color Red -log Error
                Write-Entry -Subtext "$errorOutput" -Path $global:configLogging -Color Cyan -log Debug
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
        }
        catch {
            Write-Entry -Subtext "Failed to start the process or read the error output:" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext $_.Exception.Message -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

        }
        finally {
            if ($process) {
                $process.Dispose()
            }
        }
    }
    catch {
        Write-Entry -Subtext "An unexpected error occurred while setting up the process:" -Path $global:configLogging -Color Red -log Error
        Write-Entry -Subtext $_.Exception.Message -Path $global:configLogging -Color Red -log Error
        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

    }
}
function Write-TextSizeCacheSummary {
    param([string]$Label = "Text-size cache")
    $tsHits = if ($global:tsHitsBag) { $global:tsHitsBag.Count } else { 0 }
    $tsMiss = if ($global:tsMissMsBag) { $global:tsMissMsBag.Count } else { 0 }
    $tsRuns = $tsMiss
    $tsMs = 0
    if ($global:tsMissMsBag) { foreach ($ms in $global:tsMissMsBag) { $tsMs += $ms } }

    $total = $tsHits + $tsMiss
    $rate = if ($total) { [math]::Round(100 * $tsHits / $total, 2) } else { 0 }
    $avg = if ($tsRuns) { [math]::Round($tsMs / $tsRuns, 2) } else { 150 } # default to 150ms per magick call if cache hits 100%
    $saved = [TimeSpan]::FromMilliseconds([double]($tsHits * $avg))
    Write-Entry -Subtext ("{0}: {1} Hits, {2} Misses ({3}% Hit Rate) | ImageMagick Calls: {4} (Total {5} ms) | Estimated Time Saved: {6}h {7}m {8}s" -f `
            $Label, $tsHits, $tsMiss, $rate, $tsRuns, $tsMs, $saved.Hours, $saved.Minutes, $saved.Seconds) `
        -Path $global:configLogging -Color Green -log Info
}