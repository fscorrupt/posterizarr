#region Prerequisites Check
$fileExtensions = @(".otf", ".ttf", ".otc", ".ttc", ".png")

# Initialize Other Variables
$SeasonsTemp = $null
$SeasonNames = $null
$SeasonNumbers = $null
$SeasonRatingkeys = $null
$ApplyTextInsteadOfLogo = $null

# Define cross-platform paths
$LogsPath = Join-Path $global:ScriptRoot 'Logs'
$TempPath = Join-Path $global:ScriptRoot 'temp'
$TestPath = Join-Path $global:ScriptRoot 'test'
$global:OverlayPath = Join-Path $global:ScriptRoot 'Overlayfiles'

# Invoke ImageMagick Checks
InvokeIMChecks

# Create directories if they don't exist

if (!(Test-Path $AssetPath)) {
    if ($global:OSType -ne "Win32NT" -and $AssetPath -eq 'P:\assets') {
        Write-Entry -Message 'Please change default asset Path...' -Path $global:configLogging -Color Red -log Error
        # Clear Running File
        HandleScriptExit -Message "Default asset path"
    }
    New-Item -ItemType Directory -Path $AssetPath -Force | Out-Null
}

# Check directory perms
Test-PathPermissions -PathToTest $AssetPath
Test-PathPermissions -PathToTest $BackupPath
Test-PathPermissions -PathToTest $ManualAssetPath

if ($ForceRunningDeletion -eq 'true') {
    if (Test-Path $CurrentlyRunning) {
        try {
            Remove-Item -LiteralPath $CurrentlyRunning -ErrorAction Stop | Out-Null
        }
        catch {
            Write-Entry -Message "Failed to delete '$CurrentlyRunning'." -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Reason: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
        }
    }
}

if (Test-Path $CurrentlyRunning) {
    Write-Entry -Message "Another Posterizarr instance already running, exiting now..." -Path $global:configLogging -Color Yellow -log Warning
    Write-Entry -Subtext "If its a false positive message you can manually delete the 'Posterizarr.Running' file in temp dir..." -Path $global:configLogging -Color Cyan -log Warning
    if ($global:UptimeKumaUrl) {
        Send-UptimeKumaWebhook -status "down" -msg "Another instance running"
    }
    $global:ExitRequested = $true
    Exit
}
Else {
    $RunMode = "Normal"

    if ($Tautulli) {
        $RunMode = "Tautulli"
        Write-Entry -Message "Tautulli Recently Added running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($ArrTrigger) {
        $RunMode = "arr"
        Write-Entry -Message "Arr Recently Added running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($Testing) {
        $RunMode = "Testing"
        Write-Entry -Message "Testing running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($Manual) {
        $RunMode = "Manual"
        Write-Entry -Message "Manual running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($SyncJelly) {
        $RunMode = "SyncJelly"
        Write-Entry -Message "SyncJelly running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($SyncEmby) {
        $RunMode = "SyncEmby"
        Write-Entry -Message "SyncEmby running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($Backup) {
        $RunMode = "Backup"
        Write-Entry -Message "Backup running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($PosterReset) {
        $RunMode = "Reset"
        Write-Entry -Message "Reset running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($Restore) {
        $RunMode = "Restore"
        Write-Entry -Message "Restore running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($LogoUpdater) {
        $RunMode = "LogoUpdater"
        Write-Entry -Message "LogoUpdater running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($LogoRevert) {
        $RunMode = "LogoRevert"
        Write-Entry -Message "LogoRevert running file created..." -Path $global:configLogging -Color White -log Info
    }
    Elseif ($GatherLogs) {
        $RunMode = "GatherLogs"
        Write-Entry -Message "GatherLogs running file created..." -Path $global:configLogging -Color White -log Info
    }
    Else {
        Write-Entry -Message "Posterizarr running file created..." -Path $global:configLogging -Color White -log Info
    }

    New-Item -Path $CurrentlyRunning -Force -Value $RunMode | Out-Null
}
# Delete all files and subfolders within the temp directory, excluding running file and overlay files
if (Test-Path $TempPath) {
    $excludes = @('Posterizarr.Running', 'font_preview*')
    if (Test-Path -LiteralPath $global:OverlayPath) {
        $overlayFiles = Get-ChildItem -Path $global:OverlayPath -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
        if ($null -ne $overlayFiles) {
            $excludes += $overlayFiles
        }
    }
    Get-ChildItem -Path (Join-Path $TempPath '*') -Recurse -Exclude $excludes | Remove-Item -Force
    Write-Entry -Message "Deleting temp folder: $TempPath" -Path $global:configLogging -Color White -log Info
}
if ($Testing) {
    if ((Test-Path $TestPath)) {
        Remove-Item -Path (Join-Path $TestPath '*') -Recurse -Force
        Write-Entry -Message "Deleting test folder: $TestPath" -Path $global:configLogging -Color White -log Info
    }
}

# Test and download files if they don't exist
if ($config.PrerequisitePart.overlayfile -eq 'overlay.png' -or $config.PrerequisitePart.seasonoverlayfile -eq 'overlay.png') {
    Test-And-Download -url "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Overlayfiles/overlay.png" -destination (Join-Path $global:OverlayPath 'overlay.png')
}
if ($config.PrerequisitePart.overlayfile -eq 'overlay-innerglow.png' -or $config.PrerequisitePart.seasonoverlayfile -eq 'overlay-innerglow.png') {
    Test-And-Download -url "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Overlayfiles/overlay-innerglow.png" -destination (Join-Path $global:OverlayPath 'overlay-innerglow.png')
}
if ($config.PrerequisitePart.backgroundoverlayfile -eq 'backgroundoverlay.png' -or $config.PrerequisitePart.titlecardoverlayfile -eq 'backgroundoverlay.png') {
    Test-And-Download -url "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Overlayfiles/backgroundoverlay.png" -destination (Join-Path $global:OverlayPath 'backgroundoverlay.png')
}
if ($config.PrerequisitePart.backgroundoverlayfile -eq 'backgroundoverlay-innerglow.png' -or $config.PrerequisitePart.titlecardoverlayfile -eq 'backgroundoverlay-innerglow.png') {
    Test-And-Download -url "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Overlayfiles/backgroundoverlay-innerglow.png" -destination (Join-Path $global:OverlayPath 'backgroundoverlay-innerglow.png')
}
if ($config.PrerequisitePart.font -eq 'Rocky.ttf' -or $config.PrerequisitePart.backgroundfont -eq 'Rocky.ttf' -or $config.PrerequisitePart.titlecardfont -eq 'Rocky.ttf' -or $config.PrerequisitePart.RTLFont -eq 'Rocky.ttf') {
    Test-And-Download -url "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Overlayfiles/Rocky.ttf" -destination (Join-Path $global:OverlayPath 'Rocky.ttf')
}
if ($config.PrerequisitePart.font -eq 'Colus-Regular.ttf' -or $config.PrerequisitePart.backgroundfont -eq 'Colus-Regular.ttf' -or $config.PrerequisitePart.titlecardfont -eq 'Colus-Regular.ttf' -or $config.PrerequisitePart.RTLFont -eq 'Colus-Regular.ttf') {
    Test-And-Download -url "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Overlayfiles/Colus-Regular.ttf" -destination (Join-Path $global:OverlayPath 'Colus-Regular.ttf')
}

# Write log message
Write-Entry -Message "Old log files cleared..." -Path $global:configLogging -Color White -log Info
# Display Current Config settings:
Write-Entry -Message "Current Config settings:" -Path $global:configLogging -Color DarkMagenta -log Info
Output-ConfigJson -obj $config
# Starting main Script now...
Write-Entry -Message "Starting main Script now..." -Path $global:configLogging -Color Green -log Info

# Fix asset path based on OS (do it here so that we see what is in config.json versus what script should use)
if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
    $AssetPath = $AssetPath.Replace('\', '/')
}
else {
    $AssetPath = $AssetPath.Replace('/', '\')
}

# Fix backup path based on OS (do it here so that we see what is in config.json versus what script should use)
if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
    $BackupPath = $BackupPath.Replace('\', '/')
}
else {
    $BackupPath = $BackupPath.Replace('/', '\')
}

# Migration block: Only run this when migration is needed
$DoMigration = Get-ChildItem -Path $global:ScriptRoot -File | Where-Object { $_.Extension -in $fileExtensions } -ErrorAction SilentlyContinue
if ($DoMigration.Count -gt 0) {
    Write-Entry -Message "Migration needed: Found $($DoMigration.Count) files to migrate." -Path $global:configLogging -Color Yellow -log Info

    foreach ($file in $DoMigration) {
        try {
            Write-Entry -Subtext "Trying to migrate '$($file.Name)' from ScriptRoot to OverlayPath..." -Path $global:configLogging -Color Cyan -log Debug
            $destinationPath = Join-Path -Path $global:OverlayPath -ChildPath $file.Name

            Move-Item -LiteralPath $file.FullName -Destination $destinationPath -Force -ErrorAction Stop
            Write-Entry -Subtext "Migrated File: '$($file.Name)' from ScriptRoot to OverlayPath..." -Path $global:configLogging -Color Cyan -log Info
        }
        catch {
            Write-Entry -Subtext "Error migrating file '$($file.Name)': $_" -Path $global:configLogging -Color Red -log Error
        }
    }
}

# Copy files from OverlayPath to temp folder only if missing or modified
$copiedOverlays = 0
$copiedFonts = 0
$checkedFiles = 0

$files = Get-ChildItem -Path $global:OverlayPath -File | Where-Object { $_.Extension -in $fileExtensions } -ErrorAction SilentlyContinue
foreach ($file in $files) {
    $checkedFiles++
    try {
        $destinationPath = Join-Path -Path (Join-Path -Path $global:ScriptRoot -ChildPath 'temp') -ChildPath $file.Name
        $needsCopy = $false

        if (!(Test-Path -LiteralPath $destinationPath)) {
            $needsCopy = $true
        } else {
            $srcItem = Get-Item -LiteralPath $file.FullName
            $dstItem = Get-Item -LiteralPath $destinationPath
            if ($srcItem.LastWriteTimeUtc -gt $dstItem.LastWriteTimeUtc -or $srcItem.Length -ne $dstItem.Length) {
                $needsCopy = $true
            }
        }

        if ($needsCopy) {
            $copiedOverlays++
            Write-Entry -Subtext "Trying to copy '$($file.Name)' into temp dir..." -Path $global:configLogging -Color Cyan -log Debug
            Copy-Item -Path $file.FullName -Destination $destinationPath -Force -ErrorAction Stop
            Write-Entry -Subtext "Found/Updated File: '$($file.Name)' in OverlayPath - copying it into temp folder..." -Path $global:configLogging -Color Cyan -log Info
        }

        # Font handling...
        if ($file.Extension -match "\.(ttf|otf)$" -and $env:POSTERIZARR_NON_ROOT -eq 'TRUE') {
            $fontDestination = Join-Path -Path $Font_Cache -ChildPath $file.Name
            $needsFontCopy = $false

            if (!(Test-Path -LiteralPath $fontDestination)) {
                $needsFontCopy = $true
            } else {
                $srcItem = Get-Item -LiteralPath $file.FullName
                $dstItem = Get-Item -LiteralPath $fontDestination
                if ($srcItem.LastWriteTimeUtc -gt $dstItem.LastWriteTimeUtc -or $srcItem.Length -ne $dstItem.Length) {
                    $needsFontCopy = $true
                }
            }

            if ($needsFontCopy) {
                $copiedFonts++
                Write-Entry -Subtext "Copying font '$($file.Name)' to ImageMagick cache..." -Path $global:configLogging -Color Cyan -log Info
                Copy-Item -Path $file.FullName -Destination $fontDestination -Force -ErrorAction Stop
                if (!(Test-Path -Path $IM_Font_Cache)) {
                    New-Item -ItemType Directory -Path $IM_Font_Cache -Force | Out-Null
                }
            }
        }
    }
    catch {
        Write-Entry -Subtext "Error copying file '$($file.Name)': $_" -Path $global:configLogging -Color Red -log Error
    }
}


if ($copiedOverlays -eq 0 -and $copiedFonts -eq 0) {
    Write-Entry -Subtext "All $checkedFiles files are up to date in temp dir and no copy needed." -Path $global:configLogging -Color Green -log Info
} else {
    Write-Entry -Subtext "Copied $copiedOverlays files and $copiedFonts fonts to temp dir / cache. (Skipped $( $checkedFiles - $copiedOverlays ) files because they are up to date)." -Path $global:configLogging -Color Green -log Info
}

# Refresh font cache if any fonts were actually copied
if ($copiedFonts -gt 0 -and $env:POSTERIZARR_NON_ROOT -eq 'TRUE') {
    Write-Entry -Subtext "Updating ImageMagick font cache..." -Path $global:configLogging -Color Green -log Info
    & fc-cache -fv 1> $null 2> $null
}

CheckJsonPaths -font "$font" -RTLfont "$RTLfont" -backgroundfont "$backgroundfont" -titlecardfont "$titlecardfont" -Posteroverlay "$DefaultPosteroverlay" -ShowPosteroverlay "$DefaultShowPosteroverlay" -Backgroundoverlay "$DefaultBackgroundoverlay" -ShowBackgroundoverlay "$DefaultShowBackgroundoverlay" -titlecardoverlay "$Defaulttitlecardoverlay" -Collectionoverlay "$collectionoverlay" -Seasonoverlay "$Seasonoverlay" -Posteroverlay4k "$4kposter" -Posteroverlay1080p "$1080pPoster" -Backgroundoverlay4k "$4kBackground" -Backgroundoverlay1080p "$1080pBackground" -TCoverlay4k "$4kTC" -TCoverlay1080p "$1080pTC" -Posteroverlay4KDoVi "$4KDoVi" -Posteroverlay4KHDR10 "$4KHDR10" -Posteroverlay4KDoViHDR10 "$4KDoViHDR10" -Backgroundoverlay4KDoVi "$4KDoViBackground" -Backgroundoverlay4KHDR10 "$4KHDR10Background" -Backgroundoverlay4KDoViHDR10 "$4KDoViHDR10Background" -TCoverlay4KDoVi "$4KDoViTC" -TCoverlay4KHDR10 "$4KHDR10TC" -TCoverlay4KDoViHDR10 "$4KDoViHDR10TC"
# Plex Headers
$extraPlexHeaders = @{
    'X-Plex-Container-Size' = '1000'
}
if ($PlexToken) {
    $extraPlexHeaders['X-Plex-Token'] = $PlexToken
}
# Check Plex now:
if (!$SyncJelly -and !$SyncEmby) {
    if ($UsePlex -eq 'true') {
        [xml]$Libs = CheckPlexAccess -PlexUrl $PlexUrl
    }

    if ($UseJellyfin -eq 'true') {
        # Check Jellyfin now:
        CheckJellyfinAccess -JellyfinUrl $JellyfinUrl -JellyfinApi $JellyfinAPIKey
    }
    if ($UseEmby -eq 'true') {
        # Check Emby now:
        CheckEmbyAccess -EmbyUrl $EmbyUrl -EmbyAPI $EmbyAPIKey
    }
}
# Check overlay artwork for poster, background, and titlecard dimensions
Write-Entry -Message "Checking size of overlay files..." -Path $global:configLogging -Color White -log Info
CheckOverlayDimensions -Posteroverlay "$DefaultPosteroverlay" -ShowPosteroverlay "$DefaultShowPosteroverlay" -Backgroundoverlay "$DefaultBackgroundoverlay" -ShowBackgroundoverlay "$DefaultShowBackgroundoverlay" -titlecardoverlay "$Defaulttitlecardoverlay" -PosterSize "$PosterSize" -BackgroundSize "$BackgroundSize" -Collectionoverlay "$collectionoverlay" -Seasonoverlay "$Seasonoverlay" -Posteroverlay4k "$4kposter" -Posteroverlay1080p "$1080pPoster" -Backgroundoverlay4k "$4kBackground" -Backgroundoverlay1080p "$1080pBackground" -TCoverlay4k "$4kTC" -TCoverlay1080p "$1080pTC" -Posteroverlay4KDoVi "$4KDoVi" -Posteroverlay4KHDR10 "$4KHDR10" -Posteroverlay4KDoViHDR10 "$4KDoViHDR10" -Backgroundoverlay4KDoVi "$4KDoViBackground" -Backgroundoverlay4KHDR10 "$4KHDR10Background" -Backgroundoverlay4KDoViHDR10 "$4KDoViHDR10Background" -TCoverlay4KDoVi "$4KDoViTC" -TCoverlay4KHDR10 "$4KHDR10TC" -TCoverlay4KDoViHDR10 "$4KDoViHDR10TC"

# Check if the FanartTvAPI module is installed
$moduleName = "Celerium.FanartTV"
$module = Get-Module -ListAvailable -Name $moduleName

if (-not $module) {
    # Try to install the module
    try {
        Write-Entry -Message "$moduleName module is missing. Attempting to install it for the current user..." -Path $global:configLogging -Color Yellow -log Warning
        Install-Module -Name $moduleName -Force -SkipPublisherCheck -AllowPrerelease -Scope CurrentUser -ErrorAction Stop
        Write-Entry -Subtext "$moduleName module installed successfully. Importing it now..." -Path $global:configLogging -Color Green -log Info
        Import-Module -Name $moduleName -ErrorAction Stop
    }
    catch {
        Write-Entry -Message "Failed to install $moduleName module." -Path $global:configLogging -Color Red -log Error
        Write-Entry -Subtext "Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        Write-Entry -Subtext "Please run manually: Install-Module -Name $moduleName -Scope CurrentUser" -Path $global:configLogging -Color Yellow -log Error
        HandleScriptExit -Message "Missing required module: $moduleName"
    }
} else {
    try {
        Import-Module -Name $moduleName -ErrorAction Stop
    } catch {
        Write-Entry -Message "Failed to import $moduleName module." -Path $global:configLogging -Color Red -log Error
        Write-Entry -Subtext "Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        HandleScriptExit -Message "Failed to import required module: $moduleName"
    }
}

# Only connect if DisableOnlineAssetFetch is not set to false, and not running a mode that skips online search
if ($global:DisableOnlineAssetFetch -eq 'false' -and !$SyncJelly -and !$SyncEmby -and !$Backup -and !$Manual -and !$PosterReset -and !$Restore) {
    $checkFanart = (-not $global:UseCustomProviderOrder) -or ($global:ProviderOrder -contains 'FANART')
    $checkTMDB = (-not $global:UseCustomProviderOrder) -or ($global:ProviderOrder -contains 'TMDB')
    $checkTVDB = (-not $global:UseCustomProviderOrder) -or ($global:ProviderOrder -contains 'TVDB')

    Write-Entry -Message "Starting Provider Validation..." -Path $global:configLogging -Color White -log Info

    # Add Fanart API
    if ($checkFanart) {
        Write-Entry -Message "  Validating Fanart.tv API Key..." -Path $global:configLogging -Color Yellow -log Info
        Add-FanartTVAPIKey -ProjectKey $FanartTvAPIKey
        try {
            $fanartTestUrl = "https://webservice.fanart.tv/v3/movies/10195?api_key=$FanartTvAPIKey"
            Invoke-RestMethod -Uri $fanartTestUrl -Method Get -ErrorAction Stop | Out-Null
            Write-Entry -Subtext "Fanart.tv API Key is valid." -Path $global:configLogging -Color Green -log Info
        } catch {
            Write-Entry -Subtext "Fanart.tv API Key validation failed. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            if ($_.Exception.Message -match '\(401\)|\(403\)') {
                Write-Entry -Subtext "Please check your config file." -Path $global:configLogging -Color Red -log Error
            }
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $global:errorCount" -Path $global:configLogging -Color Red -log Error
            if ($global:FavProvider -eq 'Fanart') {
                HandleScriptExit -Message "Invalid Fanart.tv API Key"
            }
        }
    }

    # Check TMDB Token before building the Header.
    if ($checkTMDB) {
        Write-Entry -Message "  Validating TMDB Token..." -Path $global:configLogging -Color Yellow -log Info
        if ($global:tmdbtoken.Length -le '35') {
            Write-Entry -Subtext "TMDB Token is too short, you may have used the API key in your config file. Please use the 'API Read Access Token'." -Path $global:configLogging -Color Red -log Error
            # Clear Running File
            HandleScriptExit -Message "Wrong TMDB token"
        } else {
            # tmdb Header
            $global:headers = @{}
            $global:headers.Add("accept", "application/json")
            $global:headers.Add("Authorization", "Bearer $global:tmdbtoken")

            try {
                $tmdbTestUrl = "https://api.themoviedb.org/3/authentication"
                Invoke-RestMethod -Uri $tmdbTestUrl -Headers $global:headers -Method Get -ErrorAction Stop | Out-Null
                Write-Entry -Subtext "TMDB Token is valid." -Path $global:configLogging -Color Green -log Info
            } catch {
                Write-Entry -Subtext "TMDB Token validation failed. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                if ($_.Exception.Message -match '\(401\)|\(403\)') {
                    Write-Entry -Subtext "Please check your config file." -Path $global:configLogging -Color Red -log Error
                }
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $global:errorCount" -Path $global:configLogging -Color Red -log Error
                if ($global:FavProvider -eq 'TMDB') {
                    HandleScriptExit -Message "Invalid TMDB token"
                }
            }
        }
    }

    if ($checkTVDB) {
        $maxRetries = 6
        $retryCount = 0
        $success = $false
        Write-Entry -Message "  Validating TVDB API Key (Fetching Token)..." -Path $global:configLogging -Color Yellow -log Info

        while (-not $success -and $retryCount -lt $maxRetries) {
            try {
                # tvdb token Header
                $global:apiUrl = "https://api4.thetvdb.com/v4/login"
                if ($global:tvdbpin) {
                    $global:requestBody = @{
                        apikey = $global:tvdbapi
                        pin    = $global:tvdbpin
                    } | ConvertTo-Json
                }
                Else {
                    $global:requestBody = @{
                        apikey = $global:tvdbapi
                    } | ConvertTo-Json
                }
                # tvdb Header
                $global:tvdbtokenheader = @{
                    'accept'       = 'application/json'
                    'Content-Type' = 'application/json'
                }

                # Make tvdb the POST request
                $global:tvdbtoken = (Invoke-RestMethod -Uri $global:apiUrl -Headers $global:tvdbtokenheader -Method Post -Body $global:requestBody).data.token
                $global:tvdbheader = @{}
                $global:tvdbheader.Add("accept", "application/json")
                $global:tvdbheader.Add("Authorization", "Bearer $global:tvdbtoken")

                if ($global:tvdbtoken) {
                    $success = $true
                    Write-Entry -Subtext "TVDB API Key is valid (Token received)." -Path $global:configLogging -Color Green -log Info
                }

            }
            catch {
                $retryCount++

                if ($retryCount -lt $maxRetries) {
                    Start-Sleep -Seconds 10  # Wait for 10 seconds before the next retry
                }
                else {
                    if ($global:FavProvider -eq 'TVDB') {
                        Write-Entry -Subtext "Could not receive a TVDB Token - $($retryCount)/$($maxRetries). Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        if ($_.Exception.Message -match '\(401\)|\(403\)') {
                            Write-Entry -Subtext "You may have used a legacy API key in your config file. Please use a 'Project Api Key'." -Path $global:configLogging -Color Red -log Error
                        }
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $global:errorCount" -Path $global:configLogging -Color Red -log Error

                        # Clear Running File
                        HandleScriptExit -Message "Could not receive a TVDB Token"
                    }
                    Else {
                        Write-Entry -Subtext "Could not receive a TVDB Token - $($retryCount)/$($maxRetries) - you may have used an legacy API key in your config file. Please use an 'Project Api Key'" -Path $global:configLogging -Color Red -log Error
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $global:errorCount" -Path $global:configLogging -Color Red -log Error

                        break
                    }
                }
            }
        }
    }
}

#### MAIN SCRIPT START ####
