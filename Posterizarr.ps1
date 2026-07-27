param (
    [switch]$GatherLogs, # Required for Gather Logs trigger
    [switch]$Manual, # Required for Manual trigger
    [switch]$Testing, # Required for Testing trigger
    [switch]$Tautulli, # Required for Tautulli trigger
    [switch]$Backup, # Required for Backup trigger
    [switch]$Restore, # Required for Restore trigger
    [switch]$dev, # Required for trigger dev branch
    [switch]$SyncJelly, # Required for Jellyfin Sync trigger
    [switch]$SyncEmby, # Required for Emby Sync trigger
    [switch]$PosterReset, # Required for Poster Reset trigger
    [switch]$SeasonPoster, # Required for Manual Trigger
    [switch]$TitleCard, # Required for Manual Trigger
    [switch]$CollectionCard, # Required for Manual Trigger
    [switch]$MoviePosterCard, # Required for Manual Trigger
    [switch]$ShowPosterCard, # Required for Manual Trigger
    [switch]$BackgroundCard, # Required for Manual Trigger
    [switch]$LogoUpdater, # Required for LogoUpdater Mode
    [switch]$LogoRevert, # Required for LogoRevert Mode
    [switch]$ForceReplace, # Force replace existing logos
    [switch]$UISchedule, # Required for UI Schedule trigger
    [switch]$ContainerSchedule, # Required for Container Schedule trigger
    [switch]$PosterWithText, # Indicates if the poster has text
    [string]$PicturePath, # Required for Manual Trigger
    [string]$Titletext, # Required for Manual Trigger
    [string]$FolderName, # Required for Manual Trigger
    [string]$LibraryName, # Required for Manual Trigger
    [string]$RestoreLibrary, # Optional for Restore Mode
    [string]$RestoreItem, # Optional for Restore Mode
    [string]$RestoreType, # Optional for Restore Mode
    [string]$SeasonPosterName, # Required for Manual Trigger
    [string]$EPTitleName, # Required for Manual Trigger
    [string]$EpisodeNumber, # Required for Manual Trigger
    [string]$RatingKey, # Required for Tautulli Trigger
    [string]$parentratingkey, # Required for Tautulli Trigger
    [string]$grandparentratingkey, # Required for Tautulli Trigger
    [string]$mediatype, # Required for Tautulli Trigger
    [string]$LibraryToReset, # Required for Poster Reset Trigger
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs # Required for Arrtrigger
)

$global:ExitRequested = $false
$MainPSBoundParameters = $PSBoundParameters

if ($PosterWithText) {
    $global:PosterWithText = $true
} else {
    $global:PosterWithText = $false
}

# Parse ExtraArgs into a hashtable
$arrTriggers = @{}
for ($i = 0; $i -lt $ExtraArgs.Count; $i++) {
    $current = $ExtraArgs[$i]

    if ($current -like '-*') {
        $key = $current.TrimStart('-')

        # If next item is missing OR also starts with "-", treat as a switch
        if ($i + 1 -ge $ExtraArgs.Count -or $ExtraArgs[$i + 1] -like '-*') {
            $arrTriggers[$key] = $true
        }
        else {
            $arrTriggers[$key] = $ExtraArgs[$i + 1]
            $i++ # skip value since it was consumed
        }
    }
}

$CurrentScriptVersion = "3.1.5"
$global:HeaderWritten = $false
$ProgressPreference = 'SilentlyContinue'

#################
# What you need #
#####################################################################################################################
# TMDB API Read Access Token      -> https://www.themoviedb.org/settings/api (Free)
# FANART API                      -> https://fanart.tv/get-an-api-key (Free)
# TVDB Project API Key            -> https://thetvdb.com/api-information/signup (Free)
#                                    (Free for personal use. Consider subscribing to support their work)
# ImageMagick                     -> https://imagemagick.org/archive/binaries/ImageMagick-7.1.1-27-Q16-HDRI-x64-dll.exe
# FanartTv API Powershell Wrapper -> https://github.com/Celerium/Celerium.FanartTV
#####################################################################################################################

#### FUNCTION START ####

# Auto-Bootstrapper for baremetal updates
if (-not (Test-Path -Path "$PSScriptRoot\modules\core\Variables.ps1")) {
    Write-Host "Modular structure not found! Bootstrapping modules from GitHub..." -ForegroundColor Cyan
    $branch = if ($dev) { "dev" } else { "main" }
    $zipUrl = "https://github.com/fscorrupt/posterizarr/archive/refs/tags/$CurrentScriptVersion.zip"
    $zipPath = Join-Path $PSScriptRoot "posterizarr_update.zip"
    $tempExtractPath = Join-Path $PSScriptRoot "posterizarr_temp_update"

    try {
        Write-Host "Downloading latest $branch modules..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -ErrorAction Stop

        Write-Host "Extracting..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $tempExtractPath -Force -ErrorAction Stop

        $extractedFolder = Get-ChildItem -Path $tempExtractPath -Directory | Select-Object -First 1
        $modulesPath = Join-Path -Path $extractedFolder.FullName -ChildPath "modules"

        if (Test-Path $modulesPath) {
            Move-Item -Path $modulesPath -Destination "$PSScriptRoot\modules" -Force -ErrorAction Stop
            Write-Host "Modules successfully installed!" -ForegroundColor Green
        } else {
            throw "Could not locate 'modules' directory in the downloaded zip."
        }
    } catch {
        Write-Host "Failed to automatically bootstrap modules!" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please download the full release ZIP manually from GitHub and extract it." -ForegroundColor Yellow
        exit 1
    } finally {
        if (Test-Path $tempExtractPath) { Remove-Item -Path $tempExtractPath -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue }
    }
}

# Dynamically dot-source all separated functions
$functionFiles = Get-ChildItem -Path "$PSScriptRoot/modules/functions" -Filter "*.ps1"
foreach ($funcFile in $functionFiles) {
    . $funcFile.FullName
}

# Dot-source Core Variables and Prerequisites
. "$PSScriptRoot\modules\core\Variables.ps1"
if ($global:ExitRequested) { exit }
. "$PSScriptRoot\modules\core\PrerequisitesCheck.ps1"
if ($global:ExitRequested) { exit }

$global:AppRoot = $PSScriptRoot

#### MAIN SCRIPT START ####
if ($Manual) {
    . "$PSScriptRoot\modules\modes\ManualMode.ps1"
}
elseif ($Testing) {
    . "$PSScriptRoot\modules\modes\TestingMode.ps1"
}
elseif ($Tautulli) {
    . "$PSScriptRoot\modules\modes\TautulliMode.ps1"
}
elseif ($ArrTrigger) {
    . "$PSScriptRoot\modules\modes\ArrMode.ps1"
}
elseif ($Backup) {
    . "$PSScriptRoot\modules\modes\BackupMode.ps1"
}
elseif ($Restore) {
    . "$PSScriptRoot\modules\modes\RestoreMode.ps1"
}
elseif ($SyncJelly -or $SyncEmby) {
    . "$PSScriptRoot\modules\modes\SyncMode.ps1"
}
elseif ($OtherMediaServerUrl -and $OtherMediaServerApiKey -and $UseOtherMediaServer -eq 'true') {
    . "$PSScriptRoot\modules\modes\EmbyJellyMode.ps1"
}
elseif ($PosterReset) {
    . "$PSScriptRoot\modules\modes\PosterresetMode.ps1"
}
elseif ($LogoUpdater -or $LogoRevert) {
    . "$PSScriptRoot\modules\modes\LogoUpdaterMode.ps1"
}
else {
    . "$PSScriptRoot\modules\modes\NormalMode.ps1"
}

