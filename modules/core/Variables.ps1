#region Variables
# Set Branch
if ($dev -or $env:APP_VERSION -match '-dev') {
    $Branch = 'dev'
}
Else {
    $Branch = 'main'
}

# Set some global vars
Set-OSTypeAndScriptRoot
# Get platform
$Platform = Get-Platform
# Set Log Path

$LogsPath = Join-Path $global:ScriptRoot 'Logs'
$global:configLogging = Join-Path $LogsPath 'Scriptlog.log'

if ($Manual) {
    $global:configLogging = Join-Path $LogsPath 'Manuallog.log'
}
if ($Testing) {
    $global:configLogging = Join-Path $LogsPath 'Testinglog.log'
}
# Set ImageMagick Log Path
$magickLog = Join-Path $LogsPath 'ImageMagickCommands.log'

if ($GatherLogs) {
    # Check if Python is present
    if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
        Write-Host "[Posterizarr] Error: Python is not installed or not found in PATH." -ForegroundColor Red
        Write-Host "[Posterizarr] Python is required to sanitize the database for the support zip." -ForegroundColor Red
        exit 1
    }

    # Run the function
    try {
        Write-Host "[Posterizarr] Gathering logs and creating support zip..."
        $zip = New-PosterizarrSupportZip -BasePath $global:ScriptRoot
        Write-Host "[Posterizarr] Support zip created:" -ForegroundColor Green
        Write-Host "  $zip" -ForegroundColor Green
        exit 0
    }
    catch {
        Write-Host "[Posterizarr] Failed to create support zip: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

if ($arrTriggers) {
    if ($null -ne $arrTriggers['ArrTrigger']) { $ArrTrigger = $arrTriggers['ArrTrigger'] }
    if ($null -ne $arrTriggers['LogoUpdater']) { $LogoUpdater = $arrTriggers['LogoUpdater'] }
    if ($null -ne $arrTriggers['LogoRevert']) { $LogoRevert = $arrTriggers['LogoRevert'] }
    if ($null -ne $arrTriggers['UISchedule']) { $UISchedule = $arrTriggers['UISchedule'] }
    if ($null -ne $arrTriggers['ContainerSchedule']) { $ContainerSchedule = $arrTriggers['ContainerSchedule'] }
    if ($null -ne $arrTriggers['Manual']) { $Manual = $arrTriggers['Manual'] }
    if ($null -ne $arrTriggers['Testing']) { $Testing = $arrTriggers['Testing'] }
    if ($null -ne $arrTriggers['Backup']) { $Backup = $arrTriggers['Backup'] }
    if ($null -ne $arrTriggers['SyncJelly']) { $SyncJelly = $arrTriggers['SyncJelly'] }
    if ($null -ne $arrTriggers['SyncEmby']) { $SyncEmby = $arrTriggers['SyncEmby'] }
    if ($null -ne $arrTriggers['PosterReset']) { $PosterReset = $arrTriggers['PosterReset'] }
    if ($null -ne $arrTriggers['Tautulli']) { $Tautulli = $arrTriggers['Tautulli'] }
    if ($null -ne $arrTriggers['LibraryName']) { $LibraryName = $arrTriggers['LibraryName'] }
    if ($null -ne $arrTriggers['ForceReplace']) { $ForceReplace = $arrTriggers['ForceReplace'] }
}

# Check if the environment variable exists and is not empty, otherwise use the default
if (-not [string]::IsNullOrEmpty($env:FONTCONFIG_CACHE_DIR)) {
    $IM_Font_Cache = $env:FONTCONFIG_CACHE_DIR
}
else {
    $IM_Font_Cache = "/var/cache/fontconfig"
}

$Font_Cache = "/usr/share/fonts/custom/"
# Rotate logs before doing anything!
$folderPattern = "Logs_*"
$global:RotationFolderName = $null
$global:logLevel = 2
RotateLogs -ScriptRoot $global:ScriptRoot
$TempPath = Join-Path $global:ScriptRoot 'temp'
$TestPath = Join-Path $global:ScriptRoot 'test'
$WatcherPath = Join-Path $global:ScriptRoot 'watcher'
$CurrentlyRunning = Join-Path $TempPath 'Posterizarr.Running'

# Get Latest Script Version
$LatestScriptVersion = (Get-LatestScriptVersion -split "`r?`n" | Select-Object -First 1).Trim()

##### START #####
$startTime = Get-Date

# Check for PWSH
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Entry -Message "This script requires PowerShell 7 (Core) or newer." -Path $global:configLogging -Color Red -log Error
    Write-Entry -Subtext "You are currently running version $($PSVersionTable.PSVersion.tostring()). Please upgrade and try again." -Path $global:configLogging -Color Red -log Error
    return
}

# Set Text Size Cache Path
if (-not $Global:TextSizeCachePath) {
    $Global:TextSizeCachePath = Join-Path $global:ScriptRoot 'Cache\text_size_cache.json'
}
try {
    $cacheDir = Split-Path -Parent $Global:TextSizeCachePath
    if ($cacheDir -and -not (Test-Path -LiteralPath $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
}
catch {}

$global:tsHitsBag = [System.Collections.Concurrent.ConcurrentBag[int]]::new()
$global:tsMissMsBag = [System.Collections.Concurrent.ConcurrentBag[long]]::new()

$global:runspaceStats = [hashtable]::Synchronized(@{
    errorCount = 0
    posterCount = 0
    FallbackCount = 0
    PosterUnknownCount = 0
    TruncatedCount = 0
    BackgroundFallbackCount = 0
    TextlessImageCount = 0
})

Write-Entry -Message "Starting..." -Path $global:configLogging -Color Green -log Info
# Create directories if they don't exist
foreach ($path in $LogsPath, $TempPath, $TestPath, $WatcherPath) {
    if (!(Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Entry -Message "Created missing directory: $path" -Path $global:configLogging -Color White -log Info
    }
}
# Check if Config file is present
CheckConfigFile -ScriptRoot $global:ScriptRoot
# Test Json if something is missing
CheckJson -jsonExampleUrl "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/config.example.json" -jsonFilePath $(Join-Path $global:ScriptRoot 'config.json')

# Check if Script is Latest
if ($CurrentScriptVersion -eq $LatestScriptVersion) {
    Write-Entry -Message "You are Running Version - v$CurrentScriptVersion" -Path $global:configLogging -Color Green -log Info
}
Else {
    Write-Entry -Message "You are Running Version: v$CurrentScriptVersion - Latest Version is: v$LatestScriptVersion" -Path $global:configLogging -Color Yellow -log Warning
}
# load config file
if ($global:ConfigOverride -and (Test-Path $global:ConfigOverride)) {
    Write-Entry -Message "Loading blueprint config override: $($global:ConfigOverride)" -Path $global:configLogging -Color Cyan -log Info
    $config = Get-Content -Raw -Path $global:ConfigOverride | ConvertFrom-Json
    if ($config.ActiveBlueprintName) {
        Write-Entry -Message "Applied Blueprint: $($config.ActiveBlueprintName)" -Path $global:configLogging -Color DarkMagenta -log Info
    }
} else {
    $config = Get-Content -Raw -Path $(Join-Path $global:ScriptRoot 'config.json') | ConvertFrom-Json
}

# Replace Script with Latest
if ($Platform -ne 'Docker' -and "$($config.PrerequisitePart.AutoUpdatePosterizarr)".ToLower() -eq 'true' -and $CurrentScriptVersion -ne $LatestScriptVersion) {
    Write-Entry -Subtext "Posterizarr version upgrade started..." -Path $global:configLogging -Color White -log Info
    $CurrentScriptPath = $MyInvocation.MyCommand.Path

    # Backup the current script
    Write-Entry -Subtext "Backup current Script to: $CurrentScriptPath.bak" -Path $global:configLogging -Color White -log Info
    Copy-Item -Path $CurrentScriptPath -Destination "$CurrentScriptPath.bak" -Force
    try {
        Invoke-WebRequest -Uri "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/Posterizarr.ps1" -OutFile $CurrentScriptPath -ErrorAction Stop
        Write-Entry -Subtext "Posterizarr script updated to v$LatestScriptVersion, please restart script..." -Path $global:configLogging -Color Green -log Info
    }
    catch {
        Write-Entry -Subtext "Failed to download the latest script, Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    }
    HandleScriptExit -Message "Script download failed"
}

# Now is the earliest that you can set your logLevel other than 2
# Read logLevel value from config.json
$global:logLevel = [int]$config.PrerequisitePart.logLevel
# Check if the cast was successful
if ($null -eq $global:logLevel) {
    Write-Entry -Message "Value for logLevel was null. Setting it to 1. Adjust your config.json accordingly." -Path $global:configLogging -Color Yellow -log Warning
    $global:logLevel = 1
}
# Ensure $logLevel is at least 1
if ($global:logLevel -le 0) {
    Write-Entry -Message "Value for logLevel -le 0. Setting it to 1. Adjust your config.json accordingly." -Path $global:configLogging -Color Yellow -log Warning
    $global:logLevel = 1
}# Ensure $logLevel is le 3
if ($global:logLevel -gt 3) {
    Write-Entry -Message "Value for logLevel -gt 3. Setting it to 3. Adjust your config.json accordingly." -Path $global:configLogging -Color Yellow -log Warning
    $global:logLevel = 3
}
# Read naxLogs value from config.json
$maxLogs = [int]$config.PrerequisitePart.maxLogs  # Cast to integer
# Check if the cast was successful
if ($null -eq $maxLogs) {
    Write-Entry -Message "Value for maxLogs was null. Setting it to 1. Adjust your config.json accordingly." -Path $global:configLogging -Color Yellow -log Warning
    $maxLogs = 1
}
# Ensure $maxLogs is at least 1
if ($maxLogs -le 0) {
    Write-Entry -Message "Value for maxLogs -le 0. Setting it to 1. Adjust your config.json accordingly." -Path $global:configLogging -Color Yellow -log Warning
    $maxLogs = 1
}
# Delete excess log folders
$allFolders = Get-ChildItem -Path (Join-Path $global:ScriptRoot $global:RotationFolderName) -Directory |
Where-Object { $_.Name -match $folderPattern } |
Sort-Object CreationTime -Descending

$allFolders | Select-Object -Skip $maxLogs | ForEach-Object {
    $fldrName = $_.FullName
    Remove-Item -Path $fldrName -Recurse -Force
    Write-Entry -Message "Deleting excess folder: $fldrName" -Path $global:configLogging -Color White -log Info
}

# Send anonymous telemetry if enabled
Send-PosterizarrTelemetry

# Access variables from the config file
# Notification Part
$global:SendNotification = "$($config.Notification.SendNotification)".ToLower()
$global:UseUptimeKuma = "$($config.Notification.UseUptimeKuma)".ToLower()
$global:DiscordUserName = $config.Notification.DiscordUserName
if ($global:UseUptimeKuma -eq 'true') {
    $global:UptimeKumaUrl = $config.Notification.UptimeKumaUrl
}

if ($env:POWERSHELL_DISTRIBUTION_CHANNEL -like 'PSDocker*') {
    $global:NotifyUrl = $config.Notification.AppriseUrl
    if ($global:NotifyUrl -eq 'discord://{WebhookID}/{WebhookToken}/' -and $global:SendNotification -eq 'true') {
        # Try the normal discord url
        $global:NotifyUrl = $config.Notification.Discord
        if ($global:NotifyUrl -eq 'https://discordapp.com/api/webhooks/{WebhookID}/{WebhookToken}' -and $global:SendNotification -eq 'true') {
            Write-Entry -Message "Found default Notification Url, please update url in config..." -Path $global:configLogging -Color Red -log Error
            # Clear Running File
            HandleScriptExit -Message "Default notify url in config"
        }
    }
    if (!$global:NotifyUrl -and $global:SendNotification -eq 'true') {
        $global:NotifyUrl = $config.Notification.Discord
    }
}
Else {
    $global:NotifyUrl = $config.Notification.Discord
    if ($global:NotifyUrl -eq 'https://discordapp.com/api/webhooks/{WebhookID}/{WebhookToken}' -and $global:SendNotification -eq 'true') {
        Write-Entry -Message "Found default Notification Url, please update url in config..." -Path $global:configLogging -Color Red -log Error
        # Clear Running File
        HandleScriptExit -Message "Default notify url in config"
    }
}

# API Part
$global:tvdbapi = $config.ApiPart.tvdbapi
if ($global:tvdbapi -match '#') {
    $global:tvdbpin = $global:tvdbapi.split('#')[1]
    $global:tvdbapi = $global:tvdbapi.split('#')[0]
}
$global:tmdbtoken = if ($config.ApiPart.tmdbtoken) { $config.ApiPart.tmdbtoken.Trim() } else { $null }
$FanartTvAPIKey = if ($config.ApiPart.FanartTvAPIKey) { $config.ApiPart.FanartTvAPIKey.Trim() } else { $null }
$PlexToken = if ($config.ApiPart.PlexToken) { $config.ApiPart.PlexToken.Trim() } else { $null }
$JellyfinAPIKey = if ($config.ApiPart.JellyfinAPIKey) { $config.ApiPart.JellyfinAPIKey.Trim() } else { $null }
$EmbyAPIKey = if ($config.ApiPart.EmbyAPIKey) { $config.ApiPart.EmbyAPIKey.Trim() } else { $null }
$global:WidthHeightFilter = "$($config.ApiPart.WidthHeightFilter)".ToLower()
$global:PosterMinWidth = $config.ApiPart.PosterMinWidth
$global:PosterMinHeight = $config.ApiPart.PosterMinHeight
$global:BgTcMinWidth = $config.ApiPart.BgTcMinWidth
$global:BgTcMinHeight = $config.ApiPart.BgTcMinHeight
$global:FavProvider = $config.ApiPart.FavProvider.ToUpper()
$global:OverrideProviderOrder = if ($null -ne $config.ApiPart.OverrideProviderOrder) { $config.ApiPart.OverrideProviderOrder.ToString().ToLower() -eq 'true' } else { $false }
$global:ProviderOrder = if ($null -ne $config.ApiPart.ProviderOrder) { $config.ApiPart.ProviderOrder } else { @("TMDB", "TVDB", "Fanart", "Plex") }
if ($global:ProviderOrder) {
    $global:ProviderOrder = @($global:ProviderOrder | ForEach-Object { $_.ToUpper() })
}
$global:TMDBVoteSorting = "$($config.ApiPart.tmdb_vote_sorting)".ToLower()
if (!$global:TMDBVoteSorting) {
    Write-Entry -Message "TMDB Sorting option not set in config, setting it to 'vote_average' for you" -Path $global:configLogging -Color Yellow -log Warning
    $global:TMDBVoteSorting = "vote_average"
}

# 1. Load user-configured values
$global:PreferredLanguageOrder = $config.ApiPart.PreferredLanguageOrder
$global:PreferredSeasonLanguageOrder = $config.ApiPart.PreferredSeasonLanguageOrder
$global:PreferredTCLanguageOrder = $config.ApiPart.PreferredTCLanguageOrder
$global:PreferredBackgroundLanguageOrder = $config.ApiPart.PreferredBackgroundLanguageOrder
$global:LogoLanguageOrder = $config.ApiPart.LogoLanguageOrder
$global:TmdbLanguageMappings = $config.ApiPart.TmdbLanguageMappings

# Special handling: inherit poster language if set to "PleaseFillMe"
if ($global:PreferredBackgroundLanguageOrder -eq 'PleaseFillMe') {
    $global:PreferredBackgroundLanguageOrder = $global:PreferredLanguageOrder
}
if ($global:PreferredTCLanguageOrder -eq 'PleaseFillMe') {
    $global:PreferredTCLanguageOrder = $global:PreferredLanguageOrder
}
# Initialize all settings, function will validate and set defaults if needed
Initialize-LanguageSettings -SettingName "PreferredLanguageOrder"           -Label "Poster"
Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder"     -Label "Season"
Initialize-LanguageSettings -SettingName "PreferredTCLanguageOrder"         -Label "TC"
Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background"
Initialize-LanguageSettings -SettingName "LogoLanguageOrder"                -Label "Logo"

# Library-specific language override support
$global:LibraryLanguageOverrides = $config.ApiPart.LibraryLanguageOverrides
if (-not $global:LibraryLanguageOverrides) { $global:LibraryLanguageOverrides = @{} }

$global:DefaultPreferredLanguageOrder = $global:PreferredLanguageOrder
$global:DefaultPreferredSeasonLanguageOrder = $global:PreferredSeasonLanguageOrder
$global:DefaultPreferredTCLanguageOrder = $global:PreferredTCLanguageOrder
$global:DefaultPreferredBackgroundLanguageOrder = $global:PreferredBackgroundLanguageOrder
$global:DefaultLogoLanguageOrder = $global:LogoLanguageOrder

# default to TMDB if favprovider missing
if (!$global:FavProvider) {
    Write-Entry -Message "FavProvider not set in config, setting it to 'TMDB' for you" -Path $global:configLogging -Color Yellow -log Warning
    $global:FavProvider = 'TMDB'
}

# Define the language direction hash table
$global:languageDirections = @{
    "af" = "LTR"; "am" = "LTR"; "ar" = "RTL"; "az" = "LTR"; "be" = "LTR";
    "bg" = "LTR"; "bn" = "LTR"; "bs" = "LTR"; "ca" = "LTR"; "cs" = "LTR";
    "cy" = "LTR"; "da" = "LTR"; "de" = "LTR"; "dv" = "RTL"; "el" = "LTR";
    "en" = "LTR"; "eo" = "LTR"; "es" = "LTR"; "et" = "LTR"; "eu" = "LTR";
    "fa" = "RTL"; "fi" = "LTR"; "fo" = "LTR"; "fr" = "LTR"; "ga" = "LTR";
    "gd" = "LTR"; "gl" = "LTR"; "gu" = "LTR"; "he" = "RTL"; "hi" = "LTR";
    "hr" = "LTR"; "hu" = "LTR"; "hy" = "LTR"; "id" = "LTR"; "is" = "LTR";
    "it" = "LTR"; "ja" = "LTR"; "ka" = "LTR"; "kk" = "LTR"; "km" = "LTR";
    "kn" = "LTR"; "ko" = "LTR"; "ku" = "LTR"; "ky" = "LTR"; "lo" = "LTR";
    "lt" = "LTR"; "lv" = "LTR"; "mg" = "LTR"; "mk" = "LTR"; "ml" = "LTR";
    "mn" = "LTR"; "mr" = "LTR"; "ms" = "LTR"; "mt" = "LTR"; "my" = "LTR";
    "nb" = "LTR"; "ne" = "LTR"; "nl" = "LTR"; "nn" = "LTR"; "no" = "LTR";
    "om" = "LTR"; "or" = "LTR"; "pa" = "LTR"; "pl" = "LTR"; "ps" = "RTL";
    "pt" = "LTR"; "ro" = "LTR"; "ru" = "LTR"; "sd" = "RTL"; "si" = "LTR";
    "sk" = "LTR"; "sl" = "LTR"; "sq" = "LTR"; "sr" = "LTR"; "sv" = "LTR";
    "sw" = "LTR"; "ta" = "LTR"; "te" = "LTR"; "th" = "LTR"; "tk" = "LTR";
    "tr" = "LTR"; "ug" = "RTL"; "uk" = "LTR"; "ur" = "RTL"; "uz" = "LTR";
    "vi" = "LTR"; "yo" = "LTR"; "zh" = "LTR"
}

# Plex Part
$PlexUrl = $config.PlexPart.PlexUrl
$UsePlex = "$($config.PlexPart.UsePlex)".ToLower()
if ($UsePlex -eq 'true') {
    $LibstoExclude = $config.PlexPart.LibstoExclude
    $global:UploadExistingAssets = "$($config.PlexPart.UploadExistingAssets)".ToLower()
}

# Jellyfin Part
$JellyfinUrl = $config.JellyfinPart.JellyfinUrl
$UseJellyfin = "$($config.JellyfinPart.UseJellyfin)".ToLower()
if ($UseJellyfin -eq 'true') {
    $LibstoExclude = $config.JellyfinPart.LibstoExclude
    $OtherMediaServerUrl = $JellyfinUrl
    $UseOtherMediaServer = $UseJellyfin
    $OtherMediaServerApiKey = $JellyfinAPIKey
    $global:UploadExistingAssets = "$($config.JellyfinPart.UploadExistingAssets)".ToLower()
    $global:ReplaceThumbwithBackdrop = "$($config.JellyfinPart.ReplaceThumbwithBackdrop)".tolower()
    $global:ReplaceThumbwithBackdropExclusively = if ($config.JellyfinPart.ReplaceThumbwithBackdropExclusively) { "$($config.JellyfinPart.ReplaceThumbwithBackdropExclusively)".tolower() } else { 'false' }
}

# Emby Part
$EmbyUrl = $config.EmbyPart.EmbyUrl
$UseEmby = "$($config.EmbyPart.UseEmby)".ToLower()
if ($UseEmby -eq 'true') {

    # Check and normalize Emby URL
    # Only modify if IP or localhost and missing /emby
    if ($EmbyUrl -match '^http[s]?://(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?!/emby)(/?$)') {
        # Append /emby if it's not already there
        $EmbyUrl = $EmbyUrl.TrimEnd('/') + '/emby'
        Write-Entry -Message "Your Emby URL is missing '/emby' at the end. It has been auto-corrected, but please update your config.json to avoid this message." -Path "$global:configLogging" -Color Yellow -log Warning
    }

    $LibstoExclude = $config.EmbyPart.LibstoExclude
    $OtherMediaServerUrl = $EmbyUrl
    $UseOtherMediaServer = $UseEmby
    $OtherMediaServerApiKey = $EmbyAPIKey
    $global:UploadExistingAssets = "$($config.EmbyPart.UploadExistingAssets)".ToLower()
    $global:ReplaceThumbwithBackdrop = "$($config.EmbyPart.ReplaceThumbwithBackdrop)".tolower()
    $global:ReplaceThumbwithBackdropExclusively = if ($config.EmbyPart.ReplaceThumbwithBackdropExclusively) { "$($config.EmbyPart.ReplaceThumbwithBackdropExclusively)".tolower() } else { 'false' }
}

$global:OtherMediaServerHeaders = @{}
if ($OtherMediaServerApiKey) {
    $global:OtherMediaServerHeaders["Authorization"] = "MediaBrowser Token=`"$OtherMediaServerApiKey`""
}

# Count how many media servers are enabled
$enabledServers = 0
if ($UseEmby -eq 'true') { $enabledServers++ }
if ($UseJellyfin -eq 'true') { $enabledServers++ }
if ($UsePlex -eq 'true') { $enabledServers++ }

# If more than one media server is enabled, exit with an error
if ($enabledServers -gt 1) {
    Write-Entry -Message "You have enabled more than one media server - Please use only one." -Path $global:configLogging -Color Red -log Error
    Write-Entry -Subtext "Exiting Posterizarr now..." -Path $global:configLogging -Color Red -log Error
    # Clear Running File
    HandleScriptExit -Message "Multiple media servers enabled"
}

# Prerequisites Part
$AutoUpdateIM = "$($config.PrerequisitePart.AutoUpdateIM)".ToLower()
$show_skipped = "$($config.PrerequisitePart.show_skipped)".ToLower()
$FileTestOnTrigger = "$($config.PrerequisitePart.FileTestOnTrigger)".ToLower()
$FollowSymlink = "$($config.PrerequisitePart.FollowSymlink)".ToLower()
$ForceRunningDeletion = "$($config.PrerequisitePart.ForceRunningDeletion)".ToLower()
$AssetPath = RemoveTrailingSlash $config.PrerequisitePart.AssetPath
$BackupPath = RemoveTrailingSlash $config.PrerequisitePart.BackupPath
$ManualAssetPath = RemoveTrailingSlash $config.PrerequisitePart.ManualAssetPath
$Upload2Plex = "$($config.PrerequisitePart.PlexUpload)".ToLower()
$SkipAddText = "$($config.PrerequisitePart.SkipAddText)".ToLower()
$SkipLocalPosterTextAdd = "$($config.PrerequisitePart.SkipLocalPosterTextAdd)".ToLower()
$SkipLocalBackgroundTextAdd = "$($config.PrerequisitePart.SkipLocalBackgroundTextAdd)".ToLower()
$SkipLocalSeasonTextAdd = "$($config.PrerequisitePart.SkipLocalSeasonTextAdd)".ToLower()
$SkipLocalTCTextAdd = "$($config.PrerequisitePart.SkipLocalTCTextAdd)".ToLower()
$SkipAddTextAndOverlay = "$($config.PrerequisitePart.SkipAddTextAndOverlay)".ToLower()
$SkipAddTextAndBorder = "$($config.PrerequisitePart.SkipAddTextAndBorder)".ToLower()
$DisableHashValidation = "$($config.PrerequisitePart.DisableHashValidation)".ToLower()
$global:DisableOnlineAssetFetch = "$($config.PrerequisitePart.DisableOnlineAssetFetch)".ToLower()
$global:DisableOnlineTitleCardFetch = "$($config.PrerequisitePart.DisableOnlineTitleCardFetch)".ToLower()
$global:DisableOnlinePosterFetch = "$($config.PrerequisitePart.DisableOnlinePosterFetch)".ToLower()
$global:DisableOnlineBackgroundFetch = "$($config.PrerequisitePart.DisableOnlineBackgroundFetch)".ToLower()
$global:DisableOnlineSeasonFetch = "$($config.PrerequisitePart.DisableOnlineSeasonFetch)".ToLower()
$UseLogo = "$($config.PrerequisitePart.UseLogo)".ToLower()
$ConvertLogoColor = "$($config.PrerequisitePart.ConvertLogoColor)".ToLower()
$LogoFlatColor = "$($config.PrerequisitePart.LogoFlatColor)".ToLower()
$UseOriginalTitle = "$($config.PrerequisitePart.UseOriginalTitle)".ToLower()
$UseBGLogo = "$($config.PrerequisitePart.UseBGLogo)".ToLower()
$TextFallback = "$($config.PrerequisitePart.LogoTextFallback)".ToLower()
$global:UseClearlogo = "$($config.PrerequisitePart.UseClearlogo)".ToLower()
$global:UseClearart = "$($config.PrerequisitePart.UseClearart)".ToLower()
$TextlessPosterBypass = "$($config.PrerequisitePart.TextlessPosterBypass)".ToLower()

# Check if its a Network Share
if ($AssetPath.StartsWith("\")) {
    # add \ if it only Starts with one
    if (!$AssetPath.StartsWith("\\")) {
        $AssetPath = "\" + $AssetPath
    }
}

# Check if its a Network Share
if ($ManualAssetPath.StartsWith("\")) {
    # add \ if it only Starts with one
    if (!$ManualAssetPath.StartsWith("\\")) {
        $ManualAssetPath = "\" + $ManualAssetPath
    }
}

# Check if its a Network Share
if ($BackupPath.StartsWith("\")) {
    # add \ if it only Starts with one
    if (!$BackupPath.StartsWith("\\")) {
        $BackupPath = "\" + $BackupPath
    }
}

# Construct cross-platform paths
if ($global:OSType -ne "Win32NT") {
    $joinsymbol = "/"
}
Else {
    $joinsymbol = "\"
}
$font = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.font -join $($joinsymbol))
$collectionfont = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.collectionfont -join $($joinsymbol))
$RTLFont = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.RTLFont -join $($joinsymbol))
$backgroundfont = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.backgroundfont -join $($joinsymbol))
$titlecardfont = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.titlecardfont -join $($joinsymbol))
$DefaultPosteroverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.overlayfile -join $($joinsymbol))
if (-not $config.PrerequisitePart.showoverlayfile) {
    $DefaultShowPosteroverlay = $DefaultPosteroverlay
}
Else {
    $DefaultShowPosteroverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.showoverlayfile -join $($joinsymbol))
}
$Seasonoverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.seasonoverlayfile -join $($joinsymbol))
$collectionoverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.collectionoverlayfile -join $($joinsymbol))
$DefaultBackgroundoverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.backgroundoverlayfile -join $($joinsymbol))
if (-not $config.PrerequisitePart.showbackgroundoverlayfile) {
    $DefaultShowBackgroundoverlay = $DefaultBackgroundoverlay
}
Else {
    $DefaultShowBackgroundoverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.showbackgroundoverlayfile -join $($joinsymbol))
}
$Defaulttitlecardoverlay = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.titlecardoverlayfile -join $($joinsymbol))
$testimage = Join-Path -Path $global:ScriptRoot -ChildPath ('test', 'testimage.png' -join $($joinsymbol))
$backgroundtestimage = Join-Path -Path $global:ScriptRoot -ChildPath ('test', 'backgroundtestimage.png' -join $($joinsymbol))
$LibraryFolders = "$($config.PrerequisitePart.LibraryFolders)".ToLower()
$global:SeasonPosters = "$($config.PrerequisitePart.SeasonPosters)".ToLower()
$global:Posters = "$($config.PrerequisitePart.Posters)".ToLower()
$global:BackgroundPosters = "$($config.PrerequisitePart.BackgroundPosters)".ToLower()
$global:TitleCards = "$($config.PrerequisitePart.TitleCards)".ToLower()
$SkipTBA = "$($config.PrerequisitePart.SkipTBA)".ToLower()
$SkipJapTitle = "$($config.PrerequisitePart.SkipJapTitle)".ToLower()
$AssetCleanup = "$($config.PrerequisitePart.AssetCleanup)".ToLower()
$NewLineOnSpecificSymbols = "$($config.PrerequisitePart.NewLineOnSpecificSymbols)".ToLower()
$SymbolsToKeepOnNewLine = $config.PrerequisitePart.SymbolsToKeepOnNewLine
$NewLineSymbols = $config.PrerequisitePart.NewLineSymbols
$NewLineOnSpecificWords = "$($config.PrerequisitePart.NewLineOnSpecificWords)".ToLower()
$NewLineWords = $config.PrerequisitePart.NewLineWords

# Resolution Part
$UsePosterResolutionOverlays = "$($config.PrerequisitePart.UsePosterResolutionOverlays)".ToLower()
$UseBackgroundResolutionOverlays = "$($config.PrerequisitePart.UseBackgroundResolutionOverlays)".ToLower()
$UseTCResolutionOverlays = "$($config.PrerequisitePart.UseTCResolutionOverlays)".ToLower()

$4kposter = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.poster4k -join $($joinsymbol))
$1080pPoster = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.Poster1080p -join $($joinsymbol))
$4kBackground = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.Background4k -join $($joinsymbol))
$1080pBackground = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.Background1080p -join $($joinsymbol))
$4kTC = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.TC4k -join $($joinsymbol))
$1080pTC = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.TC1080p -join $($joinsymbol))

# Optional 4k
$4KDoVi = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KDoVi' -join $($joinsymbol))
$4KHDR10 = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KHDR10' -join $($joinsymbol))
$4KDoViHDR10 = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KDoViHDR10' -join $($joinsymbol))

$4KDoViBackground = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KDoViBackground' -join $($joinsymbol))
$4KHDR10Background = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KHDR10Background' -join $($joinsymbol))
$4KDoViHDR10Background = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KDoViHDR10Background' -join $($joinsymbol))

$4KDoViTC = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KDoViTC' -join $($joinsymbol))
$4KHDR10TC = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KHDR10TC' -join $($joinsymbol))
$4KDoViHDR10TC = Join-Path -Path $global:ScriptRoot -ChildPath ('temp', $config.PrerequisitePart.'4KDoViHDR10TC' -join $($joinsymbol))

# Poster Overlay Part
$global:ImageProcessing = "$($config.OverlayPart.ImageProcessing)".ToLower()
$global:outputQuality = $config.OverlayPart.outputQuality

# Poster Overlay Part
$fontAllCaps = "$($config.PosterOverlayPart.fontAllCaps)".ToLower()
$AddBorder = "$($config.PosterOverlayPart.AddBorder)".ToLower()
$AddText = "$($config.PosterOverlayPart.AddText)".ToLower()
$AddTextStroke = "$($config.PosterOverlayPart.AddTextStroke)".ToLower()
$strokecolor = $config.PosterOverlayPart.strokecolor
$strokewidth = $config.PosterOverlayPart.strokewidth
$AddOverlay = "$($config.PosterOverlayPart.AddOverlay)".ToLower()
$fontcolor = $config.PosterOverlayPart.fontcolor
$bordercolor = $config.PosterOverlayPart.bordercolor
$minPointSize = $config.PosterOverlayPart.minPointSize
$maxPointSize = $config.PosterOverlayPart.maxPointSize
$borderwidth = $config.PosterOverlayPart.borderwidth
$MaxWidth = $config.PosterOverlayPart.MaxWidth
$MaxHeight = $config.PosterOverlayPart.MaxHeight
$text_offset = $config.PosterOverlayPart.text_offset
$lineSpacing = $config.PosterOverlayPart.lineSpacing
$textgravity = "$($config.PosterOverlayPart.TextGravity)".ToLower()
$borderwidthsecond = $borderwidth + 'x' + $borderwidth
$boxsize = $MaxWidth + 'x' + $MaxHeight

# Season Poster Overlay Part
$ShowFallback = "$($config.SeasonPosterOverlayPart.ShowFallback)".ToLower()
$SeasonfontAllCaps = "$($config.SeasonPosterOverlayPart.fontAllCaps)".ToLower()
$AddSeasonBorder = "$($config.SeasonPosterOverlayPart.AddBorder)".ToLower()
$AddSeasonText = "$($config.SeasonPosterOverlayPart.AddText)".ToLower()
$AddSeasonTextStroke = "$($config.SeasonPosterOverlayPart.AddTextStroke)".ToLower()
$Seasonstrokecolor = $config.SeasonPosterOverlayPart.strokecolor
$Seasonstrokewidth = $config.SeasonPosterOverlayPart.strokewidth
$AddSeasonOverlay = "$($config.SeasonPosterOverlayPart.AddOverlay)".ToLower()
$Seasonfontcolor = $config.SeasonPosterOverlayPart.fontcolor
$Seasonbordercolor = $config.SeasonPosterOverlayPart.bordercolor
$SeasonminPointSize = $config.SeasonPosterOverlayPart.minPointSize
$SeasonmaxPointSize = $config.SeasonPosterOverlayPart.maxPointSize
$Seasonborderwidth = $config.SeasonPosterOverlayPart.borderwidth
$SeasonMaxWidth = $config.SeasonPosterOverlayPart.MaxWidth
$SeasonMaxHeight = $config.SeasonPosterOverlayPart.MaxHeight
$Seasontext_offset = $config.SeasonPosterOverlayPart.text_offset
$SeasonlineSpacing = $config.SeasonPosterOverlayPart.lineSpacing
$Seasontextgravity = "$($config.SeasonPosterOverlayPart.TextGravity)".ToLower()
$Seasonborderwidthsecond = $borderwidth + 'x' + $borderwidth
$Seasonboxsize = $SeasonMaxWidth + 'x' + $SeasonMaxHeight
$OverrideSeasonName = $config.SeasonPosterOverlayPart.OverrideSeasonName
$SeasonOverrideText = "$($config.SeasonPosterOverlayPart.SeasonOverrideText)".ToLower()
$SpecialSeasonOverrideText = "$($config.SeasonPosterOverlayPart.SpecialSeasonOverrideText)".ToLower()

# Show Title on Season Poster Overlay Part
$ShowOnSeasonfontAllCaps = "$($config.ShowTitleOnSeasonPosterPart.fontAllCaps)".ToLower()
$AddShowTitletoSeason = "$($config.ShowTitleOnSeasonPosterPart.AddShowTitletoSeason)".ToLower()
$AddShowOnSeasonTextStroke = "$($config.ShowTitleOnSeasonPosterPart.AddTextStroke)".ToLower()
$ShowOnSeasonstrokecolor = $config.ShowTitleOnSeasonPosterPart.strokecolor
$ShowOnSeasonstrokewidth = $config.ShowTitleOnSeasonPosterPart.strokewidth
$ShowOnSeasonfontcolor = $config.ShowTitleOnSeasonPosterPart.fontcolor
$ShowOnSeasonminPointSize = $config.ShowTitleOnSeasonPosterPart.minPointSize
$ShowOnSeasonmaxPointSize = $config.ShowTitleOnSeasonPosterPart.maxPointSize
$ShowOnSeasonMaxWidth = $config.ShowTitleOnSeasonPosterPart.MaxWidth
$ShowOnSeasonMaxHeight = $config.ShowTitleOnSeasonPosterPart.MaxHeight
$ShowOnSeasontext_offset = $config.ShowTitleOnSeasonPosterPart.text_offset
$ShowOnSeasontextgravity = "$($config.ShowTitleOnSeasonPosterPart.TextGravity)".ToLower()
$ShowOnSeasonboxsize = $ShowOnSeasonMaxWidth + 'x' + $ShowOnSeasonMaxHeight
$ShowOnSeasonlineSpacing = $config.ShowTitleOnSeasonPosterPart.lineSpacing

# Collection Title on Collection Poster Overlay Part
$CollectionTitleAllCaps = "$($config.CollectionTitlePosterPart.fontAllCaps)".ToLower()
$AddCollectionTitle = "$($config.CollectionTitlePosterPart.AddCollectionTitle)".ToLower()
$CollectionTitle = "$($config.CollectionTitlePosterPart.CollectionTitle)".ToLower()
$AddCollectionTitleTextStroke = "$($config.CollectionTitlePosterPart.AddTextStroke)".ToLower()
$CollectionTitlestrokecolor = $config.CollectionTitlePosterPart.strokecolor
$CollectionTitlestrokewidth = $config.CollectionTitlePosterPart.strokewidth
$CollectionTitlefontcolor = $config.CollectionTitlePosterPart.fontcolor
$CollectionTitleminPointSize = $config.CollectionTitlePosterPart.minPointSize
$CollectionTitlemaxPointSize = $config.CollectionTitlePosterPart.maxPointSize
$CollectionTitleMaxWidth = $config.CollectionTitlePosterPart.MaxWidth
$CollectionTitleMaxHeight = $config.CollectionTitlePosterPart.MaxHeight
$CollectionTitletext_offset = $config.CollectionTitlePosterPart.text_offset
$CollectionTitletextgravity = "$($config.CollectionTitlePosterPart.TextGravity)".ToLower()
$CollectionTitleboxsize = $CollectionTitleMaxWidth + 'x' + $CollectionTitleMaxHeight
$CollectionTitlelineSpacing = $config.CollectionTitlePosterPart.lineSpacing

# Collection Poster Overlay Part
$CollectionAllCaps = "$($config.CollectionPosterOverlayPart.fontAllCaps)".ToLower()
$AddCollectionBorder = "$($config.CollectionPosterOverlayPart.AddBorder)".ToLower()
$AddCollectionText = "$($config.CollectionPosterOverlayPart.AddText)".ToLower()
$AddCollectionTextStroke = "$($config.CollectionPosterOverlayPart.AddTextStroke)".ToLower()
$Collectionstrokecolor = $config.CollectionPosterOverlayPart.strokecolor
$Collectionstrokewidth = $config.CollectionPosterOverlayPart.strokewidth
$AddCollectionOverlay = "$($config.CollectionPosterOverlayPart.AddOverlay)".ToLower()
$Collectionfontcolor = $config.CollectionPosterOverlayPart.fontcolor
$Collectionbordercolor = $config.CollectionPosterOverlayPart.bordercolor
$CollectionminPointSize = $config.CollectionPosterOverlayPart.minPointSize
$CollectionmaxPointSize = $config.CollectionPosterOverlayPart.maxPointSize
$Collectionborderwidth = $config.CollectionPosterOverlayPart.borderwidth
$CollectionMaxWidth = $config.CollectionPosterOverlayPart.MaxWidth
$CollectionMaxHeight = $config.CollectionPosterOverlayPart.MaxHeight
$Collectiontext_offset = $config.CollectionPosterOverlayPart.text_offset
$CollectionlineSpacing = $config.CollectionPosterOverlayPart.lineSpacing
$Collectiontextgravity = "$($config.CollectionPosterOverlayPart.TextGravity)".ToLower()
$Collectionborderwidthsecond = $borderwidth + 'x' + $borderwidth
$Collectionboxsize = $CollectionMaxWidth + 'x' + $CollectionMaxHeight

# Background Overlay Part
$BackgroundfontAllCaps = "$($config.BackgroundOverlayPart.fontAllCaps)".ToLower()
$AddBackgroundOverlay = "$($config.BackgroundOverlayPart.AddOverlay)".ToLower()
$AddBackgroundBorder = "$($config.BackgroundOverlayPart.AddBorder)".ToLower()
$AddBackgroundText = "$($config.BackgroundOverlayPart.AddText)".ToLower()
$AddBackgroundTextStroke = "$($config.BackgroundOverlayPart.AddTextStroke)".ToLower()
$Backgroundstrokecolor = $config.BackgroundOverlayPart.strokecolor
$Backgroundstrokewidth = $config.BackgroundOverlayPart.strokewidth
$Backgroundfontcolor = $config.BackgroundOverlayPart.fontcolor
$Backgroundbordercolor = $config.BackgroundOverlayPart.bordercolor
$BackgroundminPointSize = $config.BackgroundOverlayPart.minPointSize
$BackgroundmaxPointSize = $config.BackgroundOverlayPart.maxPointSize
$Backgroundborderwidth = $config.BackgroundOverlayPart.borderwidth
$BackgroundMaxWidth = $config.BackgroundOverlayPart.MaxWidth
$BackgroundMaxHeight = $config.BackgroundOverlayPart.MaxHeight
$Backgroundtext_offset = $config.BackgroundOverlayPart.text_offset
$BackgroundlineSpacing = $config.BackgroundOverlayPart.lineSpacing
$Backgroundtextgravity = "$($config.BackgroundOverlayPart.TextGravity)".ToLower()
$Backgroundborderwidthsecond = $Backgroundborderwidth + 'x' + $Backgroundborderwidth
$Backgroundboxsize = $BackgroundMaxWidth + 'x' + $BackgroundMaxHeight

# Title Card Overlay Part
$AddTitleCardOverlay = "$($config.TitleCardOverlayPart.AddOverlay)".ToLower()
$UseBackgroundAsTitleCard = "$($config.TitleCardOverlayPart.UseBackgroundAsTitleCard)".ToLower()
$AddTitleCardBorder = "$($config.TitleCardOverlayPart.AddBorder)".ToLower()
$TitleCardborderwidth = $config.TitleCardOverlayPart.borderwidth
$TitleCardbordercolor = $config.TitleCardOverlayPart.bordercolor
$BackgroundFallback = "$($config.TitleCardOverlayPart.BackgroundFallback)".ToLower()
$SkipWords = $config.TitleCardOverlayPart.SkipWords

# Title Card Title Text Part
$TitleCardEPTitlefontAllCaps = "$($config.TitleCardTitleTextPart.fontAllCaps)".ToLower()
$AddTitleCardEPTitleText = "$($config.TitleCardTitleTextPart.AddEPTitleText)".ToLower()
$AddTitleCardEPTitleTextStroke = "$($config.TitleCardTitleTextPart.AddTextStroke)".ToLower()
$TitleCardEPTitlestrokecolor = $config.TitleCardTitleTextPart.strokecolor
$TitleCardEPTitlestrokewidth = $config.TitleCardTitleTextPart.strokewidth
$TitleCardEPTitlefontcolor = $config.TitleCardTitleTextPart.fontcolor
$TitleCardEPTitleminPointSize = $config.TitleCardTitleTextPart.minPointSize
$TitleCardEPTitlemaxPointSize = $config.TitleCardTitleTextPart.maxPointSize
$TitleCardEPTitleMaxWidth = $config.TitleCardTitleTextPart.MaxWidth
$TitleCardEPTitleMaxHeight = $config.TitleCardTitleTextPart.MaxHeight
$TitleCardEPTitletext_offset = $config.TitleCardTitleTextPart.text_offset
$TitleCardEPTitlelineSpacing = $config.TitleCardTitleTextPart.lineSpacing
$TitleCardEPTitletextgravity = "$($config.TitleCardTitleTextPart.TextGravity)".ToLower()

# Title Card EP Text Part
$SeasonTCText = $config.TitleCardEPTextPart.SeasonTCText
$EpisodeTCText = $config.TitleCardEPTextPart.EpisodeTCText
$TitleCardEPfontAllCaps = "$($config.TitleCardEPTextPart.fontAllCaps)".ToLower()
$AddTitleCardEPText = "$($config.TitleCardEPTextPart.AddEPText)".ToLower()
$AddTitleCardTextStroke = "$($config.TitleCardEPTextPart.AddTextStroke)".ToLower()
$TitleCardstrokecolor = $config.TitleCardEPTextPart.strokecolor
$TitleCardstrokewidth = $config.TitleCardEPTextPart.strokewidth
$TitleCardEPfontcolor = $config.TitleCardEPTextPart.fontcolor
$TitleCardEPminPointSize = $config.TitleCardEPTextPart.minPointSize
$TitleCardEPmaxPointSize = $config.TitleCardEPTextPart.maxPointSize
$TitleCardEPMaxWidth = $config.TitleCardEPTextPart.MaxWidth
$TitleCardEPMaxHeight = $config.TitleCardEPTextPart.MaxHeight
$TitleCardEPtext_offset = $config.TitleCardEPTextPart.text_offset
$TitleCardEPlineSpacing = $config.TitleCardEPTextPart.lineSpacing
$TitleCardEPtextgravity = "$($config.TitleCardEPTextPart.TextGravity)".ToLower()

$TitleCardborderwidthsecond = $TitleCardborderwidth + 'x' + $TitleCardborderwidth
$TitleCardEPTitleboxsize = $TitleCardEPTitleMaxWidth + 'x' + $TitleCardEPTitleMaxHeight
$TitleCardEPboxsize = $TitleCardEPMaxWidth + 'x' + $TitleCardEPMaxHeight

$PosterSize = "2000x3000"
$BackgroundSize = "3840x2160"
$fontImagemagick = $font.replace('\', '\\')
$CollectionfontImagemagick = $collectionfont.replace('\', '\\')
$RTLfontImagemagick = $RTLFont.replace('\', '\\')
$backgroundfontImagemagick = $backgroundfont.replace('\', '\\')
$TitleCardfontImagemagick = $TitleCardfont.replace('\', '\\')
if ($global:OSType -ne "Win32NT") {
    $global:OSarch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    if ($global:OSType -eq "Docker" -or $global:OSarch -eq "Arm64") {
        $magick = 'magick'
        if ($AssetPath -match '^./') {
            Write-Entry -Message "You have set your asset path to '$AssetPath', please change it to '/assets'" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Exiting Posterizarr now..." -Path $global:configLogging -Color Red -log Error
            # Clear Running File
            HandleScriptExit -Message "Wrong asset path"
        }
        if ($BackupPath -match '^./') {
            Write-Entry -Message "You have set your backup path to '$BackupPath', please change it to '/backuppath'" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Exiting Posterizarr now..." -Path $global:configLogging -Color Red -log Error
            # Clear Running File
            HandleScriptExit -Message "Wrong backup path"
        }
        if ($ManualAssetPath -match '^./') {
            Write-Entry -Message "You have set your manualasset path to '$ManualAssetPath', please change it to '/manualassets'" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Exiting Posterizarr now..." -Path $global:configLogging -Color Red -log Error
            # Clear Running File
            HandleScriptExit -Message "Wrong manual asset path"
        }
    }
    Else {
        $magickinstalllocation = $global:ScriptRoot
        $magick = Join-Path $global:ScriptRoot 'magick'
    }
}
else {
    $raw = $config.PrerequisitePart.magickinstalllocation
    $raw = RemoveTrailingSlash $raw

    if ([string]::IsNullOrWhiteSpace($raw)) {
        $raw = '.\magick'
    }
    try {
        if ($raw.StartsWith('.')) {
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $global:ScriptRoot $raw))
        }
        else {
            $fullPath = [System.IO.Path]::GetFullPath($raw)
        }
    }
    catch {
        $fullPath = Join-Path $global:ScriptRoot 'magick'
    }
    if ($fullPath -match '(?i)\.exe$') {
        $dir = Split-Path $fullPath -Parent
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        $magickinstalllocation = $dir
        $magick = $fullPath
    }
    else {
        if (-not (Test-Path $fullPath)) {
            New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
        }
        $magickinstalllocation = (Get-Item -LiteralPath $fullPath -ErrorAction Stop).FullName
        $magick = Join-Path $magickinstalllocation 'magick.exe'
    }
}
