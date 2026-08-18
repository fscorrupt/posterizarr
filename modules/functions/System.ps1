function Increment-GlobalStat {
    param([string]$StatName)
    $mutex = New-Object System.Threading.Mutex($false, "Global\PosterizarrStatsMutex")
    try {
        $mutex.WaitOne() | Out-Null
        $val = 0
        if ($global:runspaceStats.ContainsKey($StatName)) {
            $val = $global:runspaceStats[$StatName] + 1
            $global:runspaceStats[$StatName] = $val
        } else {
            $val = 1
            $global:runspaceStats[$StatName] = $val
        }
        Set-Variable -Name $StatName -Value $val -Scope Global -Force
        return $val
    } finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}
function Sync-GlobalStats {
    if ($global:runspaceStats) {
        foreach ($key in $global:runspaceStats.Keys) {
            Set-Variable -Name $key -Value $global:runspaceStats[$key] -Scope Global -Force
        }
    }
}
function HandleScriptExit {
    param (
        [string]$Message,
        [string]$Status = "down"
    )

    Write-Entry -Message $Message -Path $global:configLogging -Color Red -log Error

    # Global Cleanup
    if (Test-Path $CurrentlyRunning) {
        try {
            Remove-Item -LiteralPath $CurrentlyRunning -ErrorAction Stop | Out-Null
        }
        catch {
            Write-Entry -Message "Failed to delete '$CurrentlyRunning'." -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Reason: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'
        }
    }

    # Uptime Kuma Notification
    if ($global:UptimeKumaUrl) {
        Send-UptimeKumaWebhook -status $Status -msg $Message
    }

    if ($global:ConfigOverride -and (Test-Path $global:ConfigOverride)) {
        Remove-Item -Path $global:ConfigOverride -Force -ErrorAction SilentlyContinue
    }

    # Exit the script entirely
    Write-Entry -Message "Exiting Posterizarr run..." -Path $global:configLogging -Color Red -log Error
    $global:ExitRequested = $true
    exit
}
function New-PosterizarrSupportZip {
    param(
        [string]$BasePath
    )

    # 0. Timestamp + paths (match Python zip name)
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $stagingDir = Join-Path $BasePath "SupportZip_$timestamp"
    $zipPath = Join-Path $BasePath "posterizarr_support_$timestamp.zip"

    # Base dirs (equivalent to globals in main.py)
    $databaseDir = Join-Path $BasePath "database"
    $logsDir = Join-Path $BasePath "Logs"
    $rotatedDir = Join-Path $BasePath "RotatedLogs"
    $uiLogsDir = Join-Path $BasePath "UILogs"

    # 1. Staging + database subdir
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    $dbStagingDir = Join-Path $stagingDir "database"
    New-Item -ItemType Directory -Path $dbStagingDir -Force | Out-Null

    # ---------------------------------------------------------------------
    # 2. Copy Log Folders (with ignore rules like Python)
    #    - Logs / RotatedLogs: ignore *.json
    #    - UILogs: keep .json (only ignore pyc/__pycache__/.DS_Store)
    # ---------------------------------------------------------------------

    function Copy-Tree {
        param(
            [string]$Source,
            [string]$Dest,
            [string[]]$ExcludeExtensions = @(),
            [string[]]$ExcludeNames = @()
        )

        if (-not (Test-Path $Source)) { return }

        New-Item -ItemType Directory -Path $Dest -Force | Out-Null

        Get-ChildItem -Path $Source -Recurse | ForEach-Object {
            # Skip excluded names (e.g. __pycache__, .DS_Store)
            if ($ExcludeNames -contains $_.Name) { return }

            # Skip excluded extensions (e.g. .json)
            if ($_.PSIsContainer -eq $false -and $ExcludeExtensions -contains $_.Extension.ToLower()) {
                return
            }

            $relative = $_.FullName.Substring($Source.Length).TrimStart('\', '/')
            $target = Join-Path $Dest $relative

            if ($_.PSIsContainer) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
            }
            else {
                New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
                Copy-Item $_.FullName -Destination $target -Force
            }
        }
    }

    # Logs: ignore *.json (ignore_patterns_logs)
    if (Test-Path $logsDir) {
        Copy-Tree -Source $logsDir -Dest (Join-Path $stagingDir "Logs") `
            -ExcludeExtensions @(".json") `
            -ExcludeNames @("__pycache__", ".DS_Store")
    }

    # RotatedLogs: same rule as Logs
    if (Test-Path $rotatedDir) {
        Copy-Tree -Source $rotatedDir -Dest (Join-Path $stagingDir "RotatedLogs") `
            -ExcludeExtensions @(".json") `
            -ExcludeNames @("__pycache__", ".DS_Store")
    }

    # UILogs: default ignore (no .json exclusion)
    if (Test-Path $uiLogsDir) {
        Copy-Tree -Source $uiLogsDir -Dest (Join-Path $stagingDir "UILogs") `
            -ExcludeExtensions @() `
            -ExcludeNames @("__pycache__", ".DS_Store")
    }

    # ---------------------------------------------------------------------
    # 3. Copy & sanitize databases (mirror Python as closely as possible)
    # ---------------------------------------------------------------------

    # 3a. Copy non-sensitive DBs
    $nonSensitiveDbs = @(
        "media_export.db",
        "runtime_stats.db",
        "server_libraries.db"
    )

    foreach ($dbName in $nonSensitiveDbs) {
        $srcDb = Join-Path $databaseDir $dbName
        if (Test-Path $srcDb) {
            Copy-Item $srcDb -Destination (Join-Path $dbStagingDir $dbName) -Force
        }
    }

    # Copy + sanitize imagechoices.db (via Python sqlite3, like your function)
    $srcImageChoicesDb = Join-Path $databaseDir "imagechoices.db"
    $copiedImageChoicesDb = Join-Path $dbStagingDir "imagechoices.db"

    if (Test-Path $srcImageChoicesDb) {
        Copy-Item $srcImageChoicesDb -Destination $copiedImageChoicesDb -Force

        # The Python snippet below is a near-direct port of your sanitization logic.
        $pyScript = @'
import sqlite3, re, sys

db_path = sys.argv[1]

ALLOWED_PREFIXES = [
    "https://image.tmdb.org",
    "https://artworks.thetvdb.com",
    "https://assets.fanart.tv",
    "https://m.media-amazon.com",
    "https://www.themoviedb.org",
    "https://fanart.tv",
    "https://www.thetvdb.com",
]

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute(
    "SELECT id, DownloadSource FROM imagechoices WHERE DownloadSource LIKE 'http%%'"
)
rows = cursor.fetchall()

updates = []

for row_id, source in rows:
    if not source:
        continue

    sanitized_source = source
    is_allowed = False

    for prefix in ALLOWED_PREFIXES:
        if source.startswith(prefix):
            is_allowed = True
            break

    if not is_allowed:
        sanitized_source = re.sub(r"(https?://)[^/]+", r"\\1[MASKED_HOST]", sanitized_source, count=1)

    sanitized_source = re.sub(r"([?&][^=]*Token=)[^&]+", r"\\1[MASKED_TOKEN]", sanitized_source, flags=re.IGNORECASE)
    sanitized_source = re.sub(r"([?&][^=]*api_key=)[^&]+", r"\\1[MASKED_KEY]", sanitized_source, flags=re.IGNORECASE)
    sanitized_source = re.sub(r"([?&][^=]*pin=)[^&]+", r"\\1[MASKED_PIN]", sanitized_source, flags=re.IGNORECASE)

    if sanitized_source != source:
        updates.append((sanitized_source, row_id))

if updates:
    cursor.executemany(
        "UPDATE imagechoices SET DownloadSource = ? WHERE id = ?", updates
    )
    conn.commit()

conn.close()
'@

        # Write Python snippet to a temp file and execute it against the copied DB
        $tmpPy = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.IO.Path]::GetRandomFileName() + ".py")
        Set-Content -Path $tmpPy -Value $pyScript -Encoding UTF8

        $pythonExe = "python"
        & $pythonExe $tmpPy $copiedImageChoicesDb 2>$null

        Remove-Item $tmpPy -Force -ErrorAction SilentlyContinue
    }

    # Sanitize ImageChoices.csv (searches all subdirs)
    $allowedPrefixes = @(
        "https://image.tmdb.org",
        "https://artworks.thetvdb.com",
        "https://assets.fanart.tv",
        "https://m.media-amazon.com",
        "https://www.themoviedb.org",
        "https://fanart.tv",
        "https://www.thetvdb.com"
    )

    $csvFiles = Get-ChildItem -Path $stagingDir -Recurse -Filter "ImageChoices.csv" -File
    $totalSanitizedRows = 0

    foreach ($csv in $csvFiles) {
        $path = $csv.FullName
        try {
            $rows = Import-Csv -Path $path -Delimiter ';'
            if (-not $rows) { continue }

            # Ensure required columns exist
            $props = $rows[0].PSObject.Properties.Name
            if (-not ($props -contains 'Download Source' -and $props -contains 'Fav Provider Link')) {
                continue
            }

            $sanitizedInFile = 0

            foreach ($row in $rows) {
                $origDownload = $row.'Download Source'
                $origFav = $row.'Fav Provider Link'

                $newDownload = $origDownload
                $newFav = $origFav

                if ($newDownload -and $newDownload -like 'http*') {
                    $isAllowed = $false
                    foreach ($prefix in $allowedPrefixes) {
                        if ($newDownload.StartsWith($prefix)) { $isAllowed = $true; break }
                    }

                    if (-not $isAllowed) {
                        $newDownload = $newDownload -replace '(https?://)[^/]+', '$1[MASKED_HOST]'
                    }

                    $newDownload = $newDownload -replace '([?&][^=]*Token=)[^&]+', '$1[MASKED_TOKEN]'
                    $newDownload = $newDownload -replace '([?&][^=]*api_key=)[^&]+', '$1[MASKED_KEY]'
                    $newDownload = $newDownload -replace '([?&][^=]*pin=)[^&]+', '$1[MASKED_PIN]'
                }

                if ($newFav -and $newFav -like 'http*') {
                    $isAllowedFav = $false
                    foreach ($prefix in $allowedPrefixes) {
                        if ($newFav.StartsWith($prefix)) { $isAllowedFav = $true; break }
                    }

                    if (-not $isAllowedFav) {
                        $newFav = $newFav -replace '(https?://)[^/]+', '$1[MASKED_HOST]'
                    }

                    $newFav = $newFav -replace '([?&][^=]*Token=)[^&]+', '$1[MASKED_TOKEN]'
                    $newFav = $newFav -replace '([?&][^=]*api_key=)[^&]+', '$1[MASKED_KEY]'
                    $newFav = $newFav -replace '([?&][^=]*pin=)[^&]+', '$1[MASKED_PIN]'
                }

                if ($newDownload -ne $origDownload -or $newFav -ne $origFav) {
                    $sanitizedInFile++
                    $row.'Download Source' = $newDownload
                    $row.'Fav Provider Link' = $newFav
                }
            }

            if ($sanitizedInFile -gt 0) {
                $totalSanitizedRows += $sanitizedInFile
            }

            # Overwrite CSV with sanitized rows (Manual write to force QUOTE_ALL)
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            $sw = [System.IO.StreamWriter]::new($path, $false, $utf8NoBom)

            # Get headers from the first row object
            $headers = $rows[0].PSObject.Properties.Name

            # Write headers (all quoted)
            $headerLine = ($headers | ForEach-Object { '"{0}"' -f $_.Replace('"', '""') }) -join ';'
            $sw.WriteLine($headerLine)

            # Write data rows (all quoted)
            foreach ($r in $rows) {
                $line = ($headers | ForEach-Object {
                        $val = $r.$_
                        '"{0}"' -f "$val".Replace('"', '""')
                    }) -join ';'
                $sw.WriteLine($line)
            }
            $sw.Dispose()
        }
        catch {
            # Log-like behavior; in PS script we can just Write-Host or ignore
            Write-Host "[SupportZip] Failed to sanitize $($csv.Name): $($_.Exception.Message)"
        }
    }

    # ---------------------------------------------------------------------
    # 4. Create ZIP file
    # ---------------------------------------------------------------------
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    # Calculate the ABSOLUTE path for the zip file, because we are about to change directories
    $absZipPath = $zipPath
    if (-not [System.IO.Path]::IsPathRooted($zipPath)) {
        $absZipPath = Join-Path (Get-Location).Path $zipPath
    }

    # Enter the staging directory to force Compress-Archive
    # to treat the *contents* as the root of the zip.
    Push-Location $stagingDir
    try {
        Compress-Archive -Path * -DestinationPath $absZipPath -Force
    }
    finally {
        # Return to the original directory
        Pop-Location
    }

    # Cleanup staging
    Remove-Item $stagingDir -Recurse -Force

    return $zipPath
}
function Get-TextSizeFromCache {
    param([Parameter(Mandatory)][string]$Key, [string]$Path = $Global:TextSizeCachePath)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }

    $mutex = New-Object System.Threading.Mutex($false, "Global\PosterizarrTextSizeCacheMutex")
    $hasMutex = $false
    try {
        $hasMutex = $mutex.WaitOne(5000)
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        if (-not $raw) { return $null }

        $db = $raw | ConvertFrom-Json -ErrorAction Stop
        if ($db.PSObject.Properties.Name -contains $Key) { return $db.$Key }
    }
    catch {
        # If any file read or json parse error occurs, return null (miss)
        return $null
    }
    finally {
        if ($hasMutex) {
            $mutex.ReleaseMutex()
        }
        $mutex.Dispose()
    }
    return $null
}
function InvokeIMChecks {
    # Check for latest Imagemagick Version
    if ($global:OSarch -eq "Arm64") {
        try {
            $global:CurrentImagemagickversion = & $magick -version
        }
        catch {
            Write-Entry -Message "Could not query installed Imagemagick" -Path $global:configLogging -Color Red -log Error
            # Clear Running File
            HandleScriptExit -Message "Imagemagick missing"
        }
        $global:CurrentImagemagickversion = [regex]::Match($global:CurrentImagemagickversion, 'Version: ImageMagick (\d+(\.\d+){1,2}-\d+)')
        $global:CurrentImagemagickversion = $global:CurrentImagemagickversion.Groups[1].Value.replace('-', '.')
        Write-Entry -Message "Current Imagemagick Version: $global:CurrentImagemagickversion" -Path $global:configLogging -Color White -log Info
    }
    Else {
        # Check ImageMagick now:
        CheckImageMagick -magick $magick -magickinstalllocation $magickinstalllocation

        $global:CurrentImagemagickversion = & $magick -version
        $global:CurrentImagemagickversion = [regex]::Match($global:CurrentImagemagickversion, 'Version: ImageMagick (\d+(\.\d+){1,2}-\d+)')
        $global:CurrentImagemagickversion = $global:CurrentImagemagickversion.Groups[1].Value.replace('-', '.')
        Write-Entry -Message "Current Imagemagick Version: $global:CurrentImagemagickversion" -Path $global:configLogging -Color White -log Info
    }

    if ($global:OSType -eq "Docker") {
        #$OSVersionTag = (Get-Content /etc/os-release | Select-String -Pattern "^PRETTY_NAME=").ToString().Split('=')[1].Trim('"').replace('Alpine Linux ', '')
        $Url = "https://pkgs.alpinelinux.org/package/edge/community/x86_64/imagemagick"
        $response = Invoke-WebRequest -Uri $url
        $htmlContent = $response.Content
        $regexPattern = '<th class="header">Version<\/th>\s*<td>\s*<strong[^>]*>([\d\.]+-r\d+)<\/strong>'
        $Versionmatching = [regex]::Matches($htmlContent, $regexPattern)

        if ($Versionmatching.Count -gt 0) {
            $global:LatestImagemagickversion = $Versionmatching[0].Groups[1].Value.split('-')[0]
        }
        <#
        $Url = "https://raw.githubusercontent.com/SoftCreatR/imei/main/versions/imagemagick.version"
        $response = Invoke-WebRequest -Uri $url
        $htmlContent = $response.Content
        $regexPattern = '(\d+\.\d+\.\d+-\d+)'
        $Versionmatching = [regex]::Matches($htmlContent, $regexPattern)

        if ($Versionmatching.Count -gt 0) {
            $global:LatestImagemagickversion = $Versionmatching[0].Value
        }
    #>
    }
    Elseif ($global:OSType -eq "Win32NT") {
        try {
            $Url = "https://imagemagick.org/archive/binaries/?C=M;O=D"
            $result = Invoke-WebRequest -Uri $Url -ErrorAction Stop

            $global:LatestImagemagickversion = ($result.links.href |
                Where-Object { $_ -like '*portable-Q16-HDRI-x64.zip' } |
                Sort-Object -Descending)[0] -replace '-portable-Q16-HDRI-x64.zip', '' -replace 'ImageMagick-', ''
        }
        catch {
            # Fallback to GitHub API if direct access is forbidden or fails
            Write-Entry -Subtext "Primary method failed. Falling back to GitHub API..." -Path $global:configLogging -Color Yellow -log Debug
            $global:LatestImagemagickversion = (Invoke-RestMethod -Uri "https://api.github.com/repos/ImageMagick/ImageMagick/releases/latest" -Method Get).tag_name
        }
    }
    Else {
        $global:LatestImagemagickversion = (Invoke-RestMethod -Uri "https://api.github.com/repos/ImageMagick/ImageMagick/releases/latest" -Method Get).tag_name
    }
    if ($global:LatestImagemagickversion) {
        $global:LatestImagemagickversiontemp = $global:LatestImagemagickversion
        $global:LatestImagemagickversion = $global:LatestImagemagickversion.replace('-', '.')
        Write-Entry -Subtext "Latest Imagemagick Version: $global:LatestImagemagickversion" -Path $global:configLogging -Color Yellow -log Info
    }

    # Auto Update Magick
    if ($AutoUpdateIM -eq 'true' -and $global:OSType -ne "Docker" -and $global:OSType -eq "Win32NT" -and $global:LatestImagemagickversion -gt $global:CurrentImagemagickversion -and $global:OSarch -ne "Arm64") {
        Remove-Item -LiteralPath "$global:ScriptRoot/magick" -Force

        if ($global:OSType -ne "Win32NT") {
            if ($global:OSType -ne "Docker") {
                Write-Entry -Subtext "Downloading the latest Imagemagick portable version for you..." -Path $global:configLogging -Color Cyan -log Info
                $magickUrl = "https://imagemagick.org/archive/binaries/magick"
                Invoke-WebRequest -Uri $magickUrl -OutFile "$global:ScriptRoot/magick"
                chmod +x "$global:ScriptRoot/magick"
                Write-Entry -Subtext "Made the portable Magick executable..." -Path $global:configLogging -Color Green -log Info
            }
        }
    }
}
function Output-ConfigJson {
    param (
        $obj,
        [int]$indentLevel = 0
    )
    function RedactUrl($value) {
        if ($null -eq $value) { return $null }
        if ($value.Length -le 10) { return $value }
        return ($value[0..9] -join '') + '****'
    }
    function RedactKey($value) {
        if ($null -eq $value) { return $null }
        # If the string is 1 character or less, return it as-is.
        if ($value.Length -le 1) {
            return $value
        }
        # For any string longer than 1 char, show the first char and then redact.
        return $value.Substring(0, 1) + '****'
    }
    $redactKeys = @("tvdbapi", "tmdbtoken", "fanarttvapikey", "plextoken", "jellyfinapikey", "embyapikey", "embyurl", "jellyfinurl", "discord", "plexurl", "UptimeKumaUrl", "AppriseUrl", "basicAuthPassword", "basicAuthUsername")
    $indent = '  ' * $indentLevel

    if ($indentLevel -eq 0) {
        foreach ($section in $obj.PSObject.Properties) {
            if ($section.Name -eq "ActiveBlueprintName" -or $section.Name -eq "CustomBlueprints") { continue }
            Write-Entry "===== $($section.Name) =====" -Path $global:configLogging -Color Yellow -log Info
            Output-ConfigJson -obj $section.Value -indentLevel 1
        }
        return
    }

    if ($obj -is [System.Management.Automation.PSCustomObject] -or $obj -is [Hashtable]) {
        foreach ($prop in $obj.PSObject.Properties) {
            $keyLower = $prop.Name.ToLower()
            $val = $prop.Value

            if ($redactKeys -contains $keyLower) {
                if ($keyLower.EndsWith("url")) {
                    $redacted = RedactUrl $val
                }
                else {
                    $redacted = RedactKey $val
                }
                Write-Entry -Subtext "$indent$($prop.Name): $redacted" -Path $global:configLogging -Color Cyan -log Info
            }
            elseif ($keyLower -eq "blueprints") {
                $parsedBlueprints = $null
                if ($val -is [string]) {
                    try { $parsedBlueprints = $val | ConvertFrom-Json } catch {}
                } else {
                    $parsedBlueprints = $val
                }

                if ($parsedBlueprints) {
                    $bpCount = @($parsedBlueprints).Count
                    Write-Entry -Subtext "$indent$($prop.Name): <$bpCount custom blueprint(s) loaded>" -Path $global:configLogging -Color Cyan -log Info

                    foreach ($bp in $parsedBlueprints) {
                        $bpName = if ($bp.customTitle) { $bp.customTitle } else { $bp.id }
                        Write-Entry -Subtext "$indent  - Blueprint: $bpName" -Path $global:configLogging -Color Yellow -log Info
                        if ($bp.updates -and $bp.updates.nested) {
                            Output-ConfigJson -obj $bp.updates.nested -indentLevel ($indentLevel + 2)
                        }
                    }
                } else {
                    Write-Entry -Subtext "$indent$($prop.Name): <0 custom blueprint(s) loaded>" -Path $global:configLogging -Color Cyan -log Info
                }
            }
            elseif ($val -is [System.Management.Automation.PSCustomObject] -or $val -is [Hashtable]) {
                # For nested objects, print key with colon and then recurse with increased indent
                Write-Entry -Subtext "$indent$($prop.Name):" -Path $global:configLogging -Color Cyan -log Info
                Output-ConfigJson -obj $val -indentLevel ($indentLevel + 1)
            }
            elseif ($val -is [System.Collections.IEnumerable] -and -not ($val -is [string])) {
                # For arrays/lists, join with comma and print on the same line
                $joined = ($val | ForEach-Object { $_ }) -join ", "
                Write-Entry -Subtext "$indent$($prop.Name): $joined" -Path $global:configLogging -Color Cyan -log Info
            }
            else {
                Write-Entry -Subtext "$indent$($prop.Name): $val" -Path $global:configLogging -Color Cyan -log Info
            }
        }
    }
    else {
        Write-Entry -Subtext ("{0}{1}" -f ('  ' * $indentLevel), $obj) -Path $global:configLogging -Color Cyan -log Info
    }
}
function Initialize-LanguageSettings {
    param (
        [string]$SettingName, # e.g. "PreferredLanguageOrder"
        [string]$Label,       # e.g. "Poster"
        [string[]]$Default = @("xx", "en", "de")
    )

    # Get the starting value (global if exists, else default)
    if (Get-Variable -Name $SettingName -Scope Global -ErrorAction SilentlyContinue) {
        $valueToValidate = (Get-Variable -Name $SettingName -Scope Global).Value
    }
    else {
        $valueToValidate = $Default
        Write-Entry -Message "$Label search Order not set in Config, setting it to '$($Default -join ",")'" -Path "$global:configLogging" -Color Yellow -log Warning
    }

    # Log and remove invalid entries (> 2 chars and not "xx")
    $invalids = $valueToValidate | Where-Object { $_ -ne 'xx' -and $_.Length -ne 2 }
    foreach ($inv in $invalids) {
        Write-Entry -Message "$Label search Order contains invalid language code '$inv' (must be exactly 2 chars), removing it." -Path "$global:configLogging" -Color Red -log Error
    }

    $validLangs = $valueToValidate | Where-Object { $_ -eq 'xx' -or ($_ -match '^[a-z]{2}$') }

    # Fallback to default if empty after filtering
    if (-not $validLangs -or $validLangs.Count -eq 0) {
        $validLangs = $Default
        Write-Entry -Message "$Label order invalid after filtering, using default '$($Default -join ",")'" -Path "$global:configLogging" -Color Red -log Error
    }

    # Always overwrite the global variable
    Set-Variable -Name $SettingName -Scope Global -Value $validLangs -Force

    # Derived variants
    $tmdbLangs = @()
    foreach ($lang in $validLangs) {
        $mappedLang = $null
        if ($null -ne $global:TmdbLanguageMappings) {
            if ($global:TmdbLanguageMappings -is [System.Collections.IDictionary]) {
                $mappedLang = $global:TmdbLanguageMappings[$lang]
            } else {
                $mappedLang = $global:TmdbLanguageMappings.$lang
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($mappedLang)) {
            $tmdbLangs += $mappedLang
        } else {
            $tmdbLangs += $lang
        }
    }
    Set-Variable -Name "${SettingName}TMDB"   -Scope Global -Value $tmdbLangs
    Set-Variable -Name "${SettingName}Fanart" -Scope Global -Value ($validLangs -replace '^xx$', '00')
    Set-Variable -Name "${SettingName}TVDB"   -Scope Global -Value ($validLangs -replace '^xx$', 'null')

    # Flags
    if ($validLangs -contains 'xx' -and $validLangs.Count -eq 1) {
        Set-Variable -Name "${Label}PreferTextless" -Scope Global -Value $true
        Set-Variable -Name "${Label}OnlyTextless"   -Scope Global -Value $true
    }
    elseif ($validLangs[0] -eq 'xx') {
        Set-Variable -Name "${Label}PreferTextless" -Scope Global -Value $true
        Set-Variable -Name "${Label}OnlyTextless"   -Scope Global -Value $false
    }
    else {
        Set-Variable -Name "${Label}PreferTextless" -Scope Global -Value $false
        Set-Variable -Name "${Label}OnlyTextless"   -Scope Global -Value $false
    }

    # Debug logs

    $preferTextless = (Get-Variable -Name "${Label}PreferTextless" -Scope Global).Value
    $onlyTextless = (Get-Variable -Name "${Label}OnlyTextless" -Scope Global).Value

    Write-Entry -Subtext "$Label PreferTextless Value: $preferTextless" -Path "$global:configLogging" -Color Cyan -log Debug
    Write-Entry -Subtext "$Label OnlyTextless Value: $onlyTextless" -Path "$global:configLogging" -Color Cyan -log Debug

}
function Set-LibraryLanguageOverride {
    # A library override sets one language order (PreferredLanguageOrder) that
    # applies to every asset type for that library - a "this library is
    # German/French/etc" switch, not four settings to keep in sync. Season and
    # Background inherit it directly; TC keeps its textless-first ("xx") lead
    # unless the override already starts with one, since TC language is about
    # base-image search, not the library's spoken language.
    param([string]$LibraryName)

    # $global:LibraryLanguageOverrides is a PSCustomObject when read fresh from
    # config.json, but crossing into a -Parallel runspace via $using: deserializes
    # it as a Hashtable instead - handle both shapes rather than assuming one.
    $override = $null
    if ($null -ne $global:LibraryLanguageOverrides) {
        if ($global:LibraryLanguageOverrides -is [System.Collections.IDictionary]) {
            $override = $global:LibraryLanguageOverrides[$LibraryName]
        } else {
            $override = $global:LibraryLanguageOverrides.$LibraryName
        }
    }

    if (-not $override) {
        Set-Variable -Name "PreferredLanguageOrder" -Scope Global -Value $global:DefaultPreferredLanguageOrder
        Set-Variable -Name "PreferredSeasonLanguageOrder" -Scope Global -Value $global:DefaultPreferredSeasonLanguageOrder
        Set-Variable -Name "PreferredTCLanguageOrder" -Scope Global -Value $global:DefaultPreferredTCLanguageOrder
        Set-Variable -Name "PreferredBackgroundLanguageOrder" -Scope Global -Value $global:DefaultPreferredBackgroundLanguageOrder
        Set-Variable -Name "LogoLanguageOrder" -Scope Global -Value $global:DefaultLogoLanguageOrder
    }
    else {
        $order = if ($override.PreferredLanguageOrder) { $override.PreferredLanguageOrder } else { $global:DefaultPreferredLanguageOrder }

        $applyToPoster = if ($null -ne $override.ApplyToPoster) { [bool]$override.ApplyToPoster } else { $true }
        $applyToSeason = if ($null -ne $override.ApplyToSeason) { [bool]$override.ApplyToSeason } else { $true }
        $applyToBackground = if ($null -ne $override.ApplyToBackground) { [bool]$override.ApplyToBackground } else { $true }
        $applyToLogo = if ($null -ne $override.ApplyToLogo) { [bool]$override.ApplyToLogo } else { $true }

        $posterOrder = if ($applyToPoster) { $order } else { $global:DefaultPreferredLanguageOrder }
        $seasonOrder = if ($applyToSeason) { $order } else { $global:DefaultPreferredSeasonLanguageOrder }
        $backgroundOrder = if ($applyToBackground) { $order } else { $global:DefaultPreferredBackgroundLanguageOrder }
        $logoOrder = if ($applyToLogo) { $order } else { $global:DefaultLogoLanguageOrder }

        $tcOrder = if ($order -and $order[0] -eq 'xx') { $order } else { @('xx') + $order }

        Set-Variable -Name "PreferredLanguageOrder" -Scope Global -Value $posterOrder
        Set-Variable -Name "PreferredSeasonLanguageOrder" -Scope Global -Value $seasonOrder
        Set-Variable -Name "PreferredTCLanguageOrder" -Scope Global -Value $tcOrder
        Set-Variable -Name "PreferredBackgroundLanguageOrder" -Scope Global -Value $backgroundOrder
        Set-Variable -Name "LogoLanguageOrder" -Scope Global -Value $logoOrder
    }

    Initialize-LanguageSettings -SettingName "PreferredLanguageOrder"           -Label "Poster"
    Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder"     -Label "Season"
    Initialize-LanguageSettings -SettingName "PreferredTCLanguageOrder"         -Label "TC"
    Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background"
    Initialize-LanguageSettings -SettingName "LogoLanguageOrder"                -Label "Logo"
}
function Test-PathPermissions {
    param (
        [string]$PathToTest
    )

    # Extract drive (if any) from the path (Windows paths like P:\assetsbackup)
    $driveLetter = ($PathToTest -split ':')[0]

    # If path starts with a drive letter but that drive doesn't exist, log and skip
    if ($PathToTest -match '^[A-Za-z]:\\' -and -not (Get-PSDrive -Name $driveLetter -ErrorAction SilentlyContinue)) {
        Write-Entry -Message "Drive '$($driveLetter):' not found. The path '$PathToTest' appears to use a Windows-style default." -Path "$global:configLogging" -Color Yellow -log Warning
        Write-Entry -Subtext "Please update this path to a valid mount (e.g., /assetsbackup)." -Path "$global:configLogging" -Color Cyan -log Info
        Write-Entry -Message "Refer to the official docker-compose.yml template for correct volume mappings:" -Path "$global:configLogging" -Color Cyan -log Info
        Write-Entry -Subtext "https://raw.githubusercontent.com/fscorrupt/posterizarr/refs/heads/main/docker-compose.yml" -Path "$global:configLogging" -Color Cyan -log Info
        return
    }

    # Check if directory exists
    $canRead = Test-Path $PathToTest -PathType Container -ErrorAction SilentlyContinue

    # Check write access
    $testFile = Join-Path $PathToTest ".perm_check"

    try {
        New-Item -ItemType File -Path $testFile -Force -ErrorAction Stop | Out-Null
        Remove-Item $testFile -Force
        $canWrite = $true
    }
    catch {
        $canWrite = $false
    }

    if ($canRead -and $canWrite) {
        Write-Entry -Message "You have read and write permissions to $PathToTest" -Path "$global:configLogging" -Color Green -log Info
    }
    else {
        Write-Entry -Message "You do NOT have read and/or write permissions to $PathToTest" -Path "$global:configLogging" -Color Red -log Error
        if ($PathToTest -eq $AssetPath) {
            # Clear Running File
            HandleScriptExit -Message "Perm issues on /assets"
        }
    }
}
function Get-Resolution {
    param ($Width)
    switch ($true) {
        ($Width -ge 7680) { return "8K" }
        ($Width -ge 5120) { return "5K" }
        ($Width -ge 3840) { return "4K" }
        ($Width -ge 2560) { return "1440p" }
        ($Width -ge 1920) { return "1080p" }
        ($Width -ge 1280) { return "720p" }
        ($Width -ge 854) { return "480p" }
        ($Width -ge 640) { return "360p" }
        ($Width -ge 426) { return "240p" }
        default { return "unknown" }
    }
}
function Get-CPUModel {
    if ($Platform -eq 'Docker') {
        $cpuInfo = cat /proc/cpuinfo | Out-String
        $cpuModelLine = $cpuInfo -split "`n" | Where-Object { $_ -like "model name*" }
        $cpuModel = $cpuModelLine -replace "model name\s*:\s*", ""
        $cpuModel = $cpuModel[0]
    }
    Elseif ($Platform -eq 'Windows') {
        $cpuModel = (Get-CimInstance win32_processor).name
    }
    Elseif ($Platform -eq 'Linux') {
        $cpuInfo = lscpu | Out-String
        $cpuInfoLines = $cpuInfo -split "`n"
        $cpuModel = ($cpuInfoLines | Where-Object { $_ -like "Model name*" }) -replace "Model name\s*:\s*", ""
    }
    Elseif ($Platform -eq 'macOS') {
        $cpuModel = system_profiler SPHardwareDataType | grep "Processor Name" | awk -F': ' '{print $2}' | xargs
    }
    Else {
        $cpuModel = 'Unknown'
    }
    return $cpuModel
}
function GetHash {
    param ([byte[]]$imageBytes)

    # Create a hash algorithm instance (SHA256)
    $hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()

    # Compute the hash from the byte array
    $hashBytes = $hashAlgorithm.ComputeHash($imageBytes)

    # Convert the hash bytes to a readable hex string
    $hashString = [BitConverter]::ToString($hashBytes) -replace "-", ""
    return $hashString
}
function Set-OSTypeAndScriptRoot {
    if ($env:POWERSHELL_DISTRIBUTION_CHANNEL -like 'PSDocker*') {
        $global:OSType = "Docker"
        $currentuser = whoami
        if ($currentuser -eq 'posterizarr' -or $currentuser -eq 'abc' -or $env:VIRTUAL_ENV -eq '/lsiopy' -or $env:POSTERIZARR_NON_ROOT -eq 'TRUE') {
            $global:ScriptRoot = "/config"
        }
        Else {
            $global:ScriptRoot = "./config"
        }
    }
    elseif ($env:APP_DATA) {
        $global:ScriptRoot = $env:APP_DATA
    }
    Else {
        $global:ScriptRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName
        $global:OSType = [System.Environment]::OSVersion.Platform
    }
}
function Write-Entry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $false)]
        [string]$Message,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Info', 'Warning', 'Error', 'Optional', 'Debug', 'Trace', 'Success')]
        [string]$log,

        [Parameter(Mandatory = $true)]
        [ValidateSet('White', 'Yellow', 'Red', 'Blue', 'DarkMagenta', 'Cyan', 'Green')]
        [string]$Color,

        [string]$Subtext = $null
    )
    switch ($log) {
        'Info' { $theLog = 2 }
        'Warning' { $theLog = 1 }
        'Error' { $theLog = 1 }
        'Debug' { $theLog = 3 }
        'Optional' { $theLog = 3 }
    }
    if (!(Test-Path -path $path)) {
        New-Item -Path $Path -Force | out-null
    }
    # ASCII art header
    if (-not $global:HeaderWritten) {
        # Retrieve CPU model
        $cpuModel = Get-CPUModel
        # Retrieve RAM Info
        if ($Platform -eq 'Docker' -or $Platform -eq 'Linux') {
            # Check Memory Usage (Total and Free)
            $memoryUsage = free -m | Out-String
            $memoryUsageLines = $memoryUsage -split "`n"
            $memValues = $memoryUsageLines[1] -split "\s+"

            $totalMemory = [int]$memValues[1]
            $usedMemory = [int]$memValues[2]
            $freeMemory = [int]$memValues[3]
            $sharedMemory = [int]$memValues[4]
            $buffersCache = [int]$memValues[5]
            $availableMemory = [int]$memValues[6]
            if (Test-Path /etc/os-release) {
                $OSVersion = (Get-Content /etc/os-release | Select-String -Pattern "^PRETTY_NAME=").ToString().Split('=')[1].Trim('"')
            }
            $Header = @"
======================================================
  _____          _            _
 |  __ \        | |          (_)
 | |__) |__  ___| |_ ___ _ __ _ ______ _ _ __ _ __
 |  ___/ _ \/ __| __/ _ \ '__| |_  / _``` | '__| '__|
 | |  | (_) \__ \ ||  __/ |  | |/ / (_| | |  | |
 |_|   \___/|___/\__\___|_|  |_/___\__,_|_|  |_|

 Current Version: $CurrentScriptVersion
 Latest Version: $LatestScriptVersion
 Platform: $Platform
 OS Version: $OSVersion
 Branch: $Branch

 CPU Model: $cpuModel

 Total Memory: $totalMemory MB
 Used Memory: $usedMemory MB
 Free Memory: $freeMemory MB
 Shared Memory: $sharedMemory MB
 Buffers/Cache: $buffersCache MB
 Available: $availableMemory MB
 ======================================================
"@
        }
        Elseif ($Platform -eq 'Windows') {
            # Retrieve memory information in GB or MB
            $memoryInfo = Get-CimInstance Win32_OperatingSystem | Select-Object @{Name = "FreePhysicalMemory"; Expression = {
                    if ($_.FreePhysicalMemory -ge 1GB) {
                        "$([math]::Round($_.FreePhysicalMemory / 1GB, 2)) MB"
                    }
                    elseif ($_.FreePhysicalMemory -ge 1MB) {
                        "$([math]::Round($_.FreePhysicalMemory / 1MB, 2)) GB"
                    }
                    else {
                        "$($_.FreePhysicalMemory)"
                    } }
            },
            @{Name = "TotalVisibleMemorySize"; Expression = {
                    if ($_.TotalVisibleMemorySize -ge 1GB) {
                        "$([math]::Round($_.TotalVisibleMemorySize / 1GB, 2)) MB"
                    }
                    elseif ($_.TotalVisibleMemorySize -ge 1MB) {
                        "$([math]::Round($_.TotalVisibleMemorySize / 1MB, 2)) GB"
                    }
                    else {
                        "$($_.TotalVisibleMemorySize)"
                    }
                }
            },
            @{Name = "UsedMemory"; Expression = {
                    $totalMemory = $_.TotalVisibleMemorySize
                    $freeMemory = $_.FreePhysicalMemory
                    $usedMemory = $totalMemory - $freeMemory

                    if ($usedMemory -ge 1GB) {
                        "$([math]::Round($usedMemory / 1GB, 2)) MB"
                    }
                    elseif ($usedMemory -ge 1MB) {
                        "$([math]::Round($usedMemory / 1MB, 2)) GB"
                    }
                    else {
                        $usedMemory
                    }
                }
            }
            $totalMemory = $memoryInfo.TotalVisibleMemorySize
            $usedMemory = $memoryInfo.UsedMemory
            $freeMemory = $memoryInfo.FreePhysicalMemory
            $OSVersion = (Get-CimInstance -class Win32_OperatingSystem).Caption
            $Header = @"
======================================================
  _____          _            _
 |  __ \        | |          (_)
 | |__) |__  ___| |_ ___ _ __ _ ______ _ _ __ _ __
 |  ___/ _ \/ __| __/ _ \ '__| |_  / _``` | '__| '__|
 | |  | (_) \__ \ ||  __/ |  | |/ / (_| | |  | |
 |_|   \___/|___/\__\___|_|  |_/___\__,_|_|  |_|

 Current Version: $CurrentScriptVersion
 Latest Version: $LatestScriptVersion
 Platform: $Platform
 OS Version: $OSVersion
 Branch: $Branch

 CPU Model: $cpuModel

 Total Memory: $totalMemory
 Used Memory: $usedMemory
 Free Memory: $freeMemory
 ======================================================
"@
        }
        Else {
            $Header = @"
======================================================
  _____          _            _
 |  __ \        | |          (_)
 | |__) |__  ___| |_ ___ _ __ _ ______ _ _ __ _ __
 |  ___/ _ \/ __| __/ _ \ '__| |_  / _``` | '__| '__|
 | |  | (_) \__ \ ||  __/ |  | |/ / (_| | |  | |
 |_|   \___/|___/\__\___|_|  |_/___\__,_|_|  |_|

 Current Version: $CurrentScriptVersion
 Latest Version: $LatestScriptVersion
 Platform: $Platform
 Branch: $Branch
 CPU Model: $cpuModel
 ======================================================
"@
        }
        Write-Host $Header
        $mutex = New-Object System.Threading.Mutex($false, "Global\PosterizarrLogMutex")
        try {
            $mutex.WaitOne() | Out-Null
            $Header | Out-File $Path -Append
        } finally {
            $mutex.ReleaseMutex()
            $mutex.Dispose()
        }
        $global:HeaderWritten = $true
    }
    if ($theLog -le $global:logLevel) {
        $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $PaddedType = "[" + $log + "]"
        $PaddedType = $PaddedType.PadRight(10)

        $ThreadId = [System.Threading.Thread]::CurrentThread.ManagedThreadId.ToString().PadLeft(2, '0')
        $ThreadTag = "[T$ThreadId]".PadRight(7)

        $ScriptName = ""
        if ($MyInvocation.ScriptName) {
            $ScriptName = [System.IO.Path]::GetFileName($MyInvocation.ScriptName) + ":"
        }
        $Linenumber = $ScriptName + "L." + "$($MyInvocation.ScriptLineNumber)"
        $Linenumber = $Linenumber.PadRight(28)
        $TypeFormatted = "[{0}] {1} {2}|{3}" -f $Timestamp, $PaddedType.ToUpper(), $ThreadTag, $Linenumber

        if ($Message) {
            $FormattedLine1 = "{0}| {1}" -f ($TypeFormatted, $Message)
            $FormattedLineWritehost = "{0}| " -f ($TypeFormatted)
        }

        if ($Subtext) {
            $FormattedLine = "{0}|      {1}" -f ($TypeFormatted, $Subtext)
            $FormattedLineWritehost = "{0}|      " -f ($TypeFormatted)
            $lineToWrite = $FormattedLine
        }
        else {
            $FormattedLineWritehost = "{0}| " -f ($TypeFormatted)
            $lineToWrite = $FormattedLine1
        }

        $mutex = New-Object System.Threading.Mutex($false, "Global\PosterizarrLogMutex")
        try {
            $mutex.WaitOne() | Out-Null

            if ($Subtext) {
                Write-Host $FormattedLineWritehost -NoNewline
                Write-Host $Subtext -ForegroundColor $Color
            }
            else {
                Write-Host $FormattedLineWritehost -NoNewline
                Write-Host $Message -ForegroundColor $Color
            }

            $lineToWrite | Out-File $Path -Append
        } finally {
            $mutex.ReleaseMutex()
            $mutex.Dispose()
        }
    }
}
function AddTrailingSlash($path) {
    $path = $path.TrimEnd()
    if (-not ($path -match '[\\/]$')) {
        $path += if ($path -match '\\') { '\' } else { '/' }
    }
    return $path
}
function RemoveTrailingSlash($path) {
    if ($path -match '[\\/]$') {
        $path = $path.TrimEnd('\', '/')
    }
    return $path
}
function CheckJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$jsonExampleUrl,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [object]$jsonFilePath
    )
    try {
        $AttributeChanged = $null
        # Download the default configuration JSON file from the URL
        $defaultConfig = Invoke-RestMethod -Uri $jsonExampleUrl -Method Get -ErrorAction Stop

        # Read the existing configuration file if it exists
        if (Test-Path $jsonFilePath) {
            try {
                $config = Get-Content -Path $jsonFilePath -Raw | ConvertFrom-Json
            }
            catch {
                Write-Entry -Message "Failed to read the existing configuration file: $jsonFilePath. Please ensure it is valid JSON. Aborting..." -Path $global:configLogging -Color Red -log Error
                # Clear Running File
                HandleScriptExit -Message "Failed to read the existing configuration file."
            }
        }
        else {
            $config = @{}
        }

        # Remove keys from config that are no longer in the default config
        foreach ($existingKey in $config.PSObject.Properties.Name) {
            if (-not $defaultConfig.PSObject.Properties.Name.Contains($existingKey)) {
                Write-Entry -Message "Removing obsolete Main Attribute from your Config file: $existingKey." -Path $global:configLogging -Color Yellow -log Warning
                $config.PSObject.Properties.Remove($existingKey)
                $AttributeChanged = $True
            }
        }

        # Remove sub-attributes no longer in the default config
        foreach ($partKey in $config.PSObject.Properties.Name) {
            if ($defaultConfig.PSObject.Properties.Name.Contains($partKey)) {
                # Check each sub-attribute in the part
                foreach ($existingSubKey in $config.$partKey.PSObject.Properties.Name) {
                    if (-not $defaultConfig.$partKey.PSObject.Properties.Name.Contains($existingSubKey)) {
                        Write-Entry -Message "Removing obsolete Sub-Attribute from your Config file: $partKey.$existingSubKey." -Path $global:configLogging -Color Yellow -log Warning
                        $config.$partKey.PSObject.Properties.Remove($existingSubKey)
                        $AttributeChanged = $True
                    }
                }
            }
        }

        # Check and add missing keys from the default configuration
        foreach ($partKey in $defaultConfig.PSObject.Properties.Name) {
            # Check if the part exists in the current configuration
            if (-not $config.PSObject.Properties.Name.Contains($partKey)) {
                if (-not $config.PSObject.Properties.Name.tolower().Contains($partKey.tolower())) {
                    # Add "SeasonPosterOverlayPart" if it's missing in $config
                    if (-not $config.PSObject.Properties.Name.tolower().Contains("seasonposteroverlaypart")) {
                        $config | Add-Member -MemberType NoteProperty -Name "SeasonPosterOverlayPart" -Value $defaultConfig.PosterOverlayPart
                        Write-Entry -Message "Missing Main Attribute in your Config file: $partKey." -Path $global:configLogging -Color Yellow -log Warning
                        Write-Entry -Subtext "I will copy all settings from 'PosterOverlayPart'..." -Path $global:configLogging -Color White -log Info
                        Write-Entry -Subtext "Adding it for you... In GH Readme, look for $partKey - if you want to see what changed..." -Path $global:configLogging -Color White -log Info
                        Write-Entry -Subtext "GH Readme -> https://fscorrupt.github.io/posterizarr/configuration" -Path $global:configLogging -Color White -log Info
                        # Convert the updated configuration object back to JSON and save it, then reload it
                        $configJson = $config | ConvertTo-Json -Depth 10
                        $configJson | Set-Content -Path $jsonFilePath -Force
                        $config = Get-Content -Path $jsonFilePath -Raw | ConvertFrom-Json
                    }
                    Else {
                        Write-Entry -Message "Missing Main Attribute in your Config file: $partKey." -Path $global:configLogging -Color Yellow -log Warning
                        Write-Entry -Subtext "Adding it for you... In GH Readme, look for $partKey - if you want to see what changed..." -Path $global:configLogging -Color White -log Info
                        Write-Entry -Subtext "GH Readme -> https://fscorrupt.github.io/posterizarr/configuration" -Path $global:configLogging -Color White -log Info
                        $config | Add-Member -MemberType NoteProperty -Name $partKey -Value $defaultConfig.$partKey
                        $AttributeChanged = $True
                    }
                }
                else {
                    # Inform user about the case issue
                    Write-Entry -Message "The Main Attribute '$partKey' in your configuration file has a different casing than the expected property." -Path $global:configLogging -Color Red -log Error
                    Write-Entry -Subtext "Please correct the casing of the property in your configuration file to '$partKey'." -Path $global:configLogging -Color Yellow -log Info
                    # Clear Running File
                    HandleScriptExit -Message "Wrong Main Attribute casing in config file"
                }
            }
            else {
                # Check each key in the part
                foreach ($propertyKey in $defaultConfig.$partKey.PSObject.Properties.Name) {
                    # Show user that a sub-attribute is missing
                    if (-not $config.$partKey.PSObject.Properties.Name.Contains($propertyKey)) {
                        if (-not $config.$partKey.PSObject.Properties.Name.tolower().Contains($propertyKey.tolower())) {
                            Write-Entry -Message "Missing Sub-Attribute in your Config file: $partKey.$propertyKey" -Path $global:configLogging -Color Yellow -log Warning
                            Write-Entry -Subtext "Adding it for you... In GH Readme, look for $partKey.$propertyKey - if you want to see what changed..." -Path $global:configLogging -Color White -log Info
                            Write-Entry -Subtext "GH Readme -> https://fscorrupt.github.io/posterizarr/configuration" -Path $global:configLogging -Color White -log Info
                            # Add the property using the expected casing
                            $config.$partKey | Add-Member -MemberType NoteProperty -Name $propertyKey -Value $defaultConfig.$partKey.$propertyKey -Force
                            $AttributeChanged = $True
                        }
                        else {
                            # Inform user about the case issue
                            Write-Entry -Message "The Sub-Attribute '$partKey.$propertyKey' in your configuration file has a different casing than the expected property." -Path $global:configLogging -Color Red -log Error
                            Write-Entry -Subtext "Please correct the casing of the Sub-Attribute in your configuration file to '$partKey.$propertyKey'." -Path $global:configLogging -Color Yellow -log Info
                            # Clear Running File
                            HandleScriptExit -Message "Wrong Sub Attribute casing in config file"
                        }
                    }
                }
            }
        }

        # Check and add missing granular asset overrides to existing LibraryLanguageOverrides
        if ($config.PSObject.Properties.Name.Contains("ApiPart") -and $config.ApiPart.PSObject.Properties.Name.Contains("LibraryLanguageOverrides")) {
            $overrides = $config.ApiPart.LibraryLanguageOverrides
            if ($overrides -is [System.Management.Automation.PSCustomObject]) {
                foreach ($libName in $overrides.PSObject.Properties.Name) {
                    $libConfig = $overrides.$libName
                    if ($libConfig -is [System.Management.Automation.PSCustomObject]) {
                        $modifiedLib = $false
                        if (-not $libConfig.PSObject.Properties.Name.Contains("ApplyToPoster")) {
                            $libConfig | Add-Member -MemberType NoteProperty -Name "ApplyToPoster" -Value $true
                            $modifiedLib = $true
                        }
                        if (-not $libConfig.PSObject.Properties.Name.Contains("ApplyToSeason")) {
                            $libConfig | Add-Member -MemberType NoteProperty -Name "ApplyToSeason" -Value $true
                            $modifiedLib = $true
                        }
                        if (-not $libConfig.PSObject.Properties.Name.Contains("ApplyToBackground")) {
                            $libConfig | Add-Member -MemberType NoteProperty -Name "ApplyToBackground" -Value $true
                            $modifiedLib = $true
                        }
                        if (-not $libConfig.PSObject.Properties.Name.Contains("ApplyToLogo")) {
                            $libConfig | Add-Member -MemberType NoteProperty -Name "ApplyToLogo" -Value $true
                            $modifiedLib = $true
                        }
                        if ($modifiedLib) {
                            Write-Entry -Message "Adding missing Granular Asset overrides to Library '$libName'" -Path $global:configLogging -Color Yellow -log Warning
                            $AttributeChanged = $True
                        }
                    }
                }
            }
        }

        if ($AttributeChanged -eq 'true') {
            # Convert the updated configuration object back to JSON and save it
            $configJson = $config | ConvertTo-Json -Depth 10
            $configJson | Set-Content -Path $jsonFilePath -Force

            Write-Entry -Subtext "Configuration file updated successfully." -Path $global:configLogging -Color Green -log Info
        }
    }
    catch [System.Net.WebException] {
        Write-Entry -Message "Failed to download the default configuration JSON file from the URL. Config check skipped." -Path $global:configLogging -Color Yellow -log Warning
    }
    catch {
        Write-Entry -Message "An unexpected error occurred during config check: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        Write-Entry -Subtext "Proceeding with existing configuration..." -Path $global:configLogging -Color Yellow -log Info
    }
}
function CheckJsonPaths {
    param (
        [string]$font,
        [string]$RTLfont,
        [string]$backgroundfont,
        [string]$titlecardfont,
        [string]$Posteroverlay,
        [string]$ShowPosteroverlay,
        [string]$Collectionoverlay,
        [string]$titlecardoverlay,
        [string]$Seasonoverlay,
        [string]$Backgroundoverlay,
        [string]$ShowBackgroundoverlay,
        [string]$Posteroverlay4k,
        [string]$Posteroverlay1080p,
        [string]$Backgroundoverlay4k,
        [string]$Backgroundoverlay1080p,
        [string]$TCoverlay4k,
        [string]$TCoverlay1080p,
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

    $paths = @(
        $font, $RTLfont, $backgroundfont, $titlecardfont, $Posteroverlay, $ShowPosteroverlay,
        $Collectionoverlay, $Backgroundoverlay, $ShowBackgroundoverlay, $titlecardoverlay, $Seasonoverlay,
        $Posteroverlay4k, $Posteroverlay1080p, $Backgroundoverlay4k,
        $Backgroundoverlay1080p, $TCoverlay4k, $TCoverlay1080p, $Posteroverlay4KDoVi, $Posteroverlay4KHDR10, $Posteroverlay4KDoViHDR10,
        $Backgroundoverlay4KDoVi, $Backgroundoverlay4KHDR10, $Backgroundoverlay4KDoViHDR10,
        $TCoverlay4KDoVi, $TCoverlay4KHDR10, $TCoverlay4KDoViHDR10
    )

    $localMissingCount = 0
    foreach ($path in $paths) {
        # Only check the path if it's not null or empty.
        # This allows optional overlays (set to null in config) to pass.
        if ((-not [string]::IsNullOrEmpty($path)) -and (-not (Test-Path -LiteralPath $path.TrimEnd()))) {
            Write-Entry -Message "Could not find file in: $path" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Check config for typos and make sure that the file is present in scriptroot." -Path $global:configLogging -Color Yellow -log Warning
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $localMissingCount++
        }
    }

    if ($localMissingCount -ge 1) {
        # Clear Running File
        HandleScriptExit -Message "File missing"
    }
}
function Get-Platform {
    if ($global:OSType -eq 'Docker') {
        return 'Docker'
    }
    elseif ($global:OSType -eq 'Unix' -and $env:POWERSHELL_DISTRIBUTION_CHANNEL -notlike 'PSDocker*') {
        # Check if it is a Mac
        $unameOutput = & uname
        if ($unameOutput -like "*Darwin*") {
            return 'macOS'
        }
        Else {
            return 'Linux'
        }
    }
    elseif ($global:OSType -eq 'Win32NT') {
        return 'Windows'
    }
    else {
        return 'Unknown'
    }
}
function Get-LatestScriptVersion {
    try {
        return Invoke-RestMethod -Uri "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Release.txt" -Method Get -ErrorAction Stop
    }
    catch {
        Write-Entry -Subtext "Could not query latest script version, Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        return $null
    }
}
function RotateLogs {
    param (
        [string]$ScriptRoot
    )

    $logFolder = Join-Path $ScriptRoot "Logs"
    $global:RotationFolderName = "RotatedLogs"
    $rotationFolder = Join-Path $ScriptRoot $global:RotationFolderName

    if (Test-Path -Path $logFolder -PathType Container) {
        $filesToMove = Get-ChildItem -Path $logFolder

        if ($filesToMove.Count -gt 0) {
            if (!(Test-Path -Path $rotationFolder)) {
                New-Item -ItemType Directory -Path $rotationFolder -Force | Out-Null
            }

            $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
            $destinationPath = Join-Path $rotationFolder "Logs_$timestamp"
            New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null

            try {
                $filesToMove | Move-Item -Destination $destinationPath -ErrorAction Stop
            }
            catch {
                Write-Host "Log Rotation partial or failed: $($_.Exception.Message)"
            }
        }
    }
}
function CheckConfigFile {
    param (
        [string]$ScriptRoot
    )

    if (!(Test-Path (Join-Path $ScriptRoot 'config.json'))) {
        Write-Entry -Message "Config File missing, downloading it for you..." -Path $global:configLogging -Color White -log Info
        Invoke-WebRequest -Uri "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/config.example.json" -OutFile "$ScriptRoot\config.json"
        Write-Entry -Subtext "Config File downloaded here: '$ScriptRoot\config.json'" -Path $global:configLogging -Color White -log Info
        Write-Entry -Subtext "Please configure the config file according to GitHub, Exit script now..." -Path $global:configLogging -Color Yellow -log Warning
        # Clear Running File
        HandleScriptExit -Message "Configure config file"
    }
}
function Test-And-Download {
    param(
        [string]$url,
        [string]$destination
    )

    if (!(Test-Path $destination)) {
        Invoke-WebRequest -Uri $url -OutFile $destination
    }
}
function RedactMediaServerUrl {
    param(
        [string]$url
    )

    # Match Plex URLs containing X-Plex-Token
    $plexMatch = $url -match "(https?://)([^:/]+)(:\d+)?(/[^?]+)(\?X-Plex-Token=)([^&]+)(.*)"

    # Match Jellyfin/Emby URLs containing api_key
    $otherMatch = $url -match "(https?://)([^:/]+)(:\d+)?(/[^?]+)(\?api_key=)([^&]+)(.*)"

    if ($plexMatch -or $otherMatch) {
        $protocol = $Matches[1]
        $hostname = $Matches[2]
        $port = $Matches[3]
        $path = $Matches[4]
        $prefix = $Matches[5]   # Either "?X-Plex-Token=" or "?api_key="
        $token = $Matches[6]
        $suffix = $Matches[7]

        # Redact IP address or hostname
        $redactedHostname = $hostname -replace "(?<=.{3}).", "*"

        # Redact API Token
        $redactedToken = $($token[0..7] -join '') + "*******"

        # Construct the redacted URL
        $redactedUrl = $protocol + $redactedHostname + $port + $path + $prefix + $redactedToken + $suffix

        return $redactedUrl
    }
    else {
        return $url  # Return original if no match found
    }
}
function CheckCharLimit {
    # Attempt to get the registry key
    try {
        $regKey = Get-Item -ErrorAction Stop -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem"

        # Get the value of LongPathsEnabled
        $longPathsEnabled = $regKey.GetValue("LongPathsEnabled")

        if ($longPathsEnabled -eq 1) {
            return $true
        }
        Else {
            return $false
        }
    }
    catch {
        # Handle any errors accessing the registry key
        Write-Entry -Subtext "$($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        return $false
    }
}