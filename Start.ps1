function Test-PosterizarrUiAvailability {
    param(
        [Parameter(Mandatory)]
        [string]$WebsiteUrl,
        [int]$RetryIntervalSeconds = 5,
        [int]$MaxWaitSeconds = 360
    )

    $startTime = Get-Date
    $isOnline = $false

    while (((Get-Date) - $startTime).TotalSeconds -lt $MaxWaitSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $WebsiteUrl -UseBasicParsing -TimeoutSec $RetryIntervalSeconds -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $isOnline = $true
                break
            }
        }
        catch {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
                $isOnline = $true
                break
            }
        }
        Start-Sleep -Seconds $RetryIntervalSeconds
    }

    $elapsed = (Get-Date) - $startTime
    $totalSeconds = [math]::Round($elapsed.TotalSeconds)
    $formattedTime = "{0}m {1}s" -f [math]::Floor($totalSeconds / 60), ($totalSeconds % 60)

    [PSCustomObject]@{
        IsOnline = $isOnline
        FormattedTime = $formattedTime
        MaxWaitSeconds = $MaxWaitSeconds
    }
}

function Get-NextScheduledRun {
    param(
        [Parameter(Mandatory)]
        [string[]]$RunTimes
    )

    $scheduledRuns = foreach ($runTime in $RunTimes) {
        if (-not $runTime) {
            continue
        }

        $parts = $runTime.Split(':')
        if ($parts.Count -lt 2) {
            continue
        }

        $nextTrigger = Get-Date -Hour $parts[0] -Minute $parts[1]
        $currentTime = Get-Date
        if ($nextTrigger -lt $currentTime) {
            $nextTrigger = $nextTrigger.AddDays(1)
        }

        [PSCustomObject]@{
            RunTime = $runTime
            Offset = ($nextTrigger - $currentTime).TotalSeconds
        }
    }

    $scheduledRuns | Sort-Object -Property Offset | Select-Object -First 1
}

function Get-PosterizarrTriggerArguments {
    param(
        [Parameter(Mandatory)]
        [string[]]$TriggerLines,
        [switch]$IsArr,
        [string]$BaseName
    )

    $scriptArgs = @()
    if ($IsArr) {
        $scriptArgs += '-ArrTrigger'

        if ($BaseName -match 'recently_added_(\d+)') {
            $timestamp = $matches[1].Substring(0, 14)
            $fileTime = [datetime]::ParseExact($timestamp, 'yyyyMMddHHmmss', $null)
            $customWait = 300
            if ($env:ARR_WAIT_TIME -as [int]) {
                $customWait = [int]$env:ARR_WAIT_TIME
                Write-Host "User defined wait time: $customWait seconds."
            }

            $waitTime = [Math]::Max(0, $customWait - ((Get-Date) - $fileTime).TotalSeconds)
            if ($waitTime -gt 0) {
                Write-Host "Waiting $([math]::Round($waitTime)) seconds for media server..."
                Start-Sleep -Seconds $waitTime
            }
        }
    }
    else {
        $scriptArgs += '-Tautulli'
    }

    foreach ($line in $TriggerLines) {
        if ($line -match '^\[(.+)\]: (.+)$') {
            $scriptArgs += "-$($matches[1])"
            $scriptArgs += $matches[2]
        }
    }

    $scriptArgs
}

function Wait-ForPosterizarrIdle {
    while (Get-Process pwsh -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*Posterizarr.ps1*" }) {
        Write-Warning "Posterizarr is already running. Waiting 20 seconds..."
        Start-Sleep -Seconds 20
    }
}

function ScriptSchedule {
    # Posterizarr File Watcher for Tautulli Recently Added Files
    $inputDir = "$env:APP_DATA/watcher"
    $Directory = Get-ChildItem -Name $inputDir

    if (!$env:RUN_TIME) {
        $env:RUN_TIME = "disabled" # Set default value if not provided
    }
    if (!$env:APP_PORT) {
        $env:APP_PORT = "8000" # Set default value if not provided
    }

    # get Runtime Values
    $NextScriptRun = $env:RUN_TIME -split ',' | Sort-Object

    # Check if UI is disabled
    $disableUiValue = "$($env:DISABLE_UI)"
    if ($disableUiValue -eq "true") {
        Write-Host "UI is disabled, skipping UI availability check."
    }
    Else {
        Write-Host "UI is being initialized. This can take a minute or two..."
        $websiteUrl = "http://localhost:$($env:APP_PORT)/"
        $uiStatus = Test-PosterizarrUiAvailability -WebsiteUrl $websiteUrl

        if ($uiStatus.IsOnline) {
            Write-Host "UI & Cache are now built and online after $($uiStatus.FormattedTime)." -ForegroundColor Green
            Write-Host "    You can access it by going to: http://localhost:$($env:APP_PORT)/"
        }
        else {
            Write-Host "UI did not become available within $($uiStatus.MaxWaitSeconds) seconds." -ForegroundColor Red
            Write-Host "    Total time waited: $($uiStatus.FormattedTime)."
        }
    }

    Write-Host "File Watcher Started..."
    # Next Run
    while ($true) {
        $elapsedTime = $(get-date) - $StartTime
        $totalTime = $elapsedTime.Days.ToString() + ' Days ' + $elapsedTime.Hours.ToString() + ' Hours ' + $elapsedTime.Minutes.ToString() + ' Min ' + $elapsedTime.Seconds.ToString() + ' Sec'
        $env:RUN_TIME = $env:RUN_TIME.ToLower()

        if ($env:RUN_TIME -ne "disabled") {
            $NextScriptRun = Get-NextScheduledRun -RunTimes ($env:RUN_TIME -split ',')

            # Use the nearest scheduled run time
            $NextScriptRunTime = $NextScriptRun.RunTime
            $NextScriptRunOffset = $NextScriptRun.Offset
            if (!$alreadydisplayed) {
                write-host ""
                write-host "Container is running since: " -NoNewline
                write-host "$totalTime" -ForegroundColor Cyan
                CompareScriptVersion
                write-host ""
                Write-Host "Next Script Run is at: $NextScriptRunTime"
                $alreadydisplayed = $true
            }
            if ($NextScriptRunOffset -le '60') {
                $alreadydisplayed = $null
                Start-Sleep $NextScriptRunOffset
                $scriptArgs = @("-ContainerSchedule")
                if (Get-Process pwsh -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*Posterizarr.ps1*" }) {
                    Write-Warning "There is currently running another Process of Posterizarr, skipping this run."
                }
                Else {
                    pwsh -File "$env:APP_ROOT/Posterizarr.ps1" @scriptArgs
                }
            }
        }
        If ($Directory) {
            $Triggers = Get-ChildItem $inputDir -Recurse | Where-Object -FilterScript {
                $_.Extension -match 'posterizarr'
            }

            foreach ($item in $Triggers) {
                write-host "Found .posterizarr file..."

                # Get trigger Values
                $triggerargs = Get-Content $item.FullName
                $isArrTrigger = $triggerargs -like '*arr_*'
                $scriptArgs = Get-PosterizarrTriggerArguments -TriggerLines $triggerargs -IsArr:$isArrTrigger -BaseName $item.BaseName

                write-host "Building trigger args..."
                Wait-ForPosterizarrIdle
                Write-Host "Calling Posterizarr with these args: $($scriptArgs -join ' ')"
                pwsh -File "$env:APP_ROOT/Posterizarr.ps1" @scriptArgs


                write-host ""
                if ($triggerargs -like '*arr_*') {
                    write-host "Arr Recently added finished, removing trigger file: $($item.Name)"
                }
                else {
                    write-host "Tautulli Recently added finished, removing trigger file: $($item.Name)"
                }

                # Check temp dir if there is a Currently running file present
                $CurrentlyRunning = "$env:APP_DATA/temp/Posterizarr.Running"

                # Clear Running File
                if (Test-Path $CurrentlyRunning) {
                    Remove-Item -LiteralPath $CurrentlyRunning | out-null
                }

                write-host ""
                write-host "Container is running since: " -NoNewline
                write-host "$totalTime" -ForegroundColor Cyan
                CompareScriptVersion
                write-host ""
                if ($env:RUN_TIME -ne "disabled") {
                    Write-Host "Next Script Run is at: $NextScriptRunTime"
                }
                Remove-Item "$inputDir/$($item.Name)" -Force -Confirm:$false
            }

            $Directory = Get-ChildItem -Name $inputDir
        }
        if (!$Directory) {
            Start-Sleep -Seconds 30
            $Directory = Get-ChildItem -Name $inputDir
        }
    }
}
function GetLatestScriptVersion {
    try {
        return Invoke-RestMethod -Uri "https://github.com/fscorrupt/posterizarr/raw/main/Release.txt" -Method Get -ErrorAction Stop
    }
    catch {
        Write-Host "Could not query latest script version, Error: $($_.Exception.Message)"
        return $null
    }
}
function CompareScriptVersion {
    try {
        $posterizarrPath = "$env:APP_ROOT/Posterizarr.ps1"
        if (Test-Path $posterizarrPath) {
            $lineContainingVersion = Select-String -Path $posterizarrPath -Pattern '^\$CurrentScriptVersion\s*=\s*"([^"]+)"' | Select-Object -ExpandProperty Line
            $LatestScriptVersion = GetLatestScriptVersion

            if ($lineContainingVersion) {
                # Extract the version from the line
                Write-Host ""
                $version = $lineContainingVersion -replace '^\$CurrentScriptVersion\s*=\s*"([^"]+)".*', '$1'

                # Check if local version is greater than remote (development version)
                $displayVersion = $version
                $statusColor = 'Green'
                $statusSuffix = ''
                if ($version -and $LatestScriptVersion) {
                    try {
                        $localParts = $version.Split('.') | ForEach-Object { [int]$_ }
                        $remoteParts = $LatestScriptVersion.Split('.') | ForEach-Object { [int]$_ }

                        # Compare versions (major.minor.patch)
                        $isGreater = $false
                        for ($i = 0; $i -lt [Math]::Min($localParts.Count, $remoteParts.Count); $i++) {
                            if ($localParts[$i] -gt $remoteParts[$i]) {
                                $isGreater = $true
                                break
                            }
                            elseif ($localParts[$i] -lt $remoteParts[$i]) {
                                break
                            }
                        }

                        if ($isGreater) {
                            $displayVersion = "$version-dev"
                            $global:IsDev = 'true'
                            $statusColor = 'Yellow'
                            $statusSuffix = ' (Development version ahead of release)'
                        }
                    }
                    catch {
                    }
                }

                Write-Host "Current Script Version: $displayVersion | Latest Script Version: $LatestScriptVersion$statusSuffix" -ForegroundColor $statusColor
            }
        }
        else {
            Write-Host "Warning: Could not find Posterizarr.ps1 at $posterizarrPath" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "Error checking script version: $($_.Exception.Message)" -ForegroundColor Red
    }
}
function CopyAssetFiles {
    $overlayDir = "$env:APP_DATA/Overlayfiles"
    if (-not (Test-Path $overlayDir)) {
        $null = New-Item -Path $overlayDir -ItemType Directory -ErrorAction SilentlyContinue
    }

    # Migrate .png, .ttf, .otf files from APP_DATA to Overlayfiles
    $migrateFiles = Get-ChildItem -Path $env:APP_DATA -Include "*.png", "*.ttf", "*.otf" -File
    $migratedCount = 0
    foreach ($file in $migrateFiles) {
        $dest = Join-Path -Path $overlayDir -ChildPath $file.Name
        try {
            Move-Item -LiteralPath $file.FullName -Destination $dest -Force
            $migratedCount++
            Write-Host "Migrated $($file.Name) to $overlayDir" -ForegroundColor Cyan
        }
        catch {
            Write-Host "Failed to migrate $($file.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    if ($migratedCount -gt 0) {
        Write-Host "Migrated $migratedCount files from APP_DATA to Overlayfiles." -ForegroundColor Green
    }

    # Get all asset files from APP_ROOT
    $assetFiles = Get-ChildItem -Path "$env:APP_ROOT/Overlayfiles/*" -Include "*.png", "*.ttf", "*.otf", "config.example.json" -File
    $fileCount = $assetFiles.Count

    if ($fileCount -eq 0) {
        Write-Host "No asset files found in $env:APP_ROOT/Overlayfiles/" -ForegroundColor Yellow
    }
    else {
        $copiedCount = 0
        $skippedCount = 0
        $errorCount = 0

        $assetFiles | ForEach-Object {
            try {
                if ($_.Name -eq "config.example.json") {
                    $configJsonPath = Join-Path -Path $env:APP_DATA -ChildPath "config.json"
                    $destinationPath = Join-Path -Path $env:APP_DATA -ChildPath $_.Name

                    if (-Not (Test-Path -Path $configJsonPath)) {
                        if (-Not (Test-Path -Path $destinationPath)) {
                            Copy-Item -Path $_.FullName -Destination $destinationPath -Force
                            $copiedCount++
                        }
                        else {
                            $skippedCount++
                        }
                    }
                    else {
                        $skippedCount++
                    }
                }
                else {
                    $destinationPath = Join-Path -Path $overlayDir -ChildPath $_.Name
                    if (-Not (Test-Path -Path $destinationPath)) {
                        Copy-Item -Path $_.FullName -Destination $destinationPath -Force
                        $copiedCount++
                    }
                    else {
                        $skippedCount++
                    }
                }
            }
            catch {
                $errorCount++
                Write-Host "Failed to copy $($_.Name): $($_.Exception.Message)" -ForegroundColor Red
            }
        }

        # Summary
        Write-Host "Copied $copiedCount new asset files" -ForegroundColor Cyan
        Write-Host "Skipped $skippedCount files (already exist or not needed)" -ForegroundColor Gray

        if ($errorCount -gt 0) {
            Write-Host "Failed to copy $errorCount files" -ForegroundColor Yellow
        }
    }
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
                Write-Host "Failed to read the existing configuration file: $jsonFilePath. Please ensure it is valid JSON. Aborting..." -ForegroundColor Red
                Exit
            }
        }
        else {
            $config = @{}
        }

        # Remove keys from config that are no longer in the default config
        foreach ($existingKey in $config.PSObject.Properties.Name) {
            if (-not $defaultConfig.PSObject.Properties.Name.Contains($existingKey)) {
                Write-Host "Removing obsolete Main Attribute from your Config file: $existingKey." -ForegroundColor Yellow
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
                        Write-Host "Removing obsolete Sub-Attribute from your Config file: $partKey.$existingSubKey." -ForegroundColor Yellow
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
                        Write-Host "Missing Main Attribute in your Config file: $partKey." -ForegroundColor Yellow
                        Write-Host "    I will copy all settings from 'PosterOverlayPart'..." -ForegroundColor White
                        Write-Host "    Adding it for you... In GH Readme, look for $partKey - if you want to see what changed..." -ForegroundColor White
                        Write-Host "    GH Readme -> https://fscorrupt.github.io/posterizarr/configuration" -ForegroundColor White
                        # Convert the updated configuration object back to JSON and save it, then reload it
                        $configJson = $config | ConvertTo-Json -Depth 10
                        $configJson | Set-Content -Path $jsonFilePath -Force
                        $config = Get-Content -Path $jsonFilePath -Raw | ConvertFrom-Json
                    }
                    Else {
                        Write-Host "Missing Main Attribute in your Config file: $partKey." -ForegroundColor Yellow
                        Write-Host "    Adding it for you... In GH Readme, look for $partKey - if you want to see what changed..." -ForegroundColor White
                        Write-Host "    GH Readme -> https://fscorrupt.github.io/posterizarr/configuration" -ForegroundColor White
                        $config | Add-Member -MemberType NoteProperty -Name $partKey -Value $defaultConfig.$partKey
                        $AttributeChanged = $True
                    }
                }
                else {
                    # Inform user about the case issue
                    Write-Host "The Main Attribute '$partKey' in your configuration file has a different casing than the expected property." -ForegroundColor Red
                    Write-Host "Please correct the casing of the property in your configuration file to '$partKey'." -ForegroundColor Yellow
                    Exit  # Abort the script
                }
            }
            else {
                # Check each key in the part
                foreach ($propertyKey in $defaultConfig.$partKey.PSObject.Properties.Name) {
                    # Show user that a sub-attribute is missing
                    if (-not $config.$partKey.PSObject.Properties.Name.Contains($propertyKey)) {
                        if (-not $config.$partKey.PSObject.Properties.Name.tolower().Contains($propertyKey.tolower())) {
                            Write-Host "Missing Sub-Attribute in your Config file: $partKey.$propertyKey" -ForegroundColor Yellow
                            Write-Host "    Adding it for you... In GH Readme, look for $partKey.$propertyKey - if you want to see what changed..." -ForegroundColor White
                            Write-Host "    GH Readme -> https://fscorrupt.github.io/posterizarr/configuration" -ForegroundColor White
                            # Add the property using the expected casing
                            $config.$partKey | Add-Member -MemberType NoteProperty -Name $propertyKey -Value $defaultConfig.$partKey.$propertyKey -Force
                            $AttributeChanged = $True
                        }
                        else {
                            # Inform user about the case issue
                            Write-Host "The Sub-Attribute '$partKey.$propertyKey' in your configuration file has a different casing than the expected property." -ForegroundColor Red
                            Write-Host "Please correct the casing of the Sub-Attribute in your configuration file to '$partKey.$propertyKey'." -ForegroundColor Yellow
                            Exit  # Abort the script
                        }
                    }
                }
            }
        }

        if ($AttributeChanged -eq 'true') {
            # Convert the updated configuration object back to JSON and save it
            $configJson = $config | ConvertTo-Json -Depth 10
            $configJson | Set-Content -Path $jsonFilePath -Force

            Write-Host "Configuration file updated successfully." -ForegroundColor Green
        }
    }
    catch [System.Net.WebException] {
        Write-Host "Failed to download the default configuration JSON file from the URL. Config check skipped." -ForegroundColor Yellow
        # We don't exit here because the container might still work with the existing config if offline
    }
    catch {
        Write-Host "An unexpected error occurred during config check: $($_.Exception.Message)" -ForegroundColor Red
        Exit
    }
}
function Ensure-WebUIConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$jsonFilePath
    )

    try {
        # Define the default WebUI configuration object
        $defaultWebUI = [PSCustomObject]@{
            basicAuthEnabled = $false
            basicAuthUsername = "admin"
            basicAuthPassword = "posterizarr"
        }

        # Read the existing configuration file
        $config = Get-Content -Path $jsonFilePath -Raw | ConvertFrom-Json

        $configChanged = $false

        # Ensure the 'WebUI' top-level attribute exists
        if (-not $config.PSObject.Properties.Name.Contains('WebUI')) {
            $config | Add-Member -MemberType NoteProperty -Name 'WebUI' -Value $defaultWebUI
            $configChanged = $true
        }
        # If 'WebUI' exists, ensure all its sub-attributes are present
        else {
            foreach ($key in $defaultWebUI.PSObject.Properties.Name) {
                if (-not $config.WebUI.PSObject.Properties.Name.Contains($key)) {
                    # Add the specific missing sub-attribute and its default value
                    $config.WebUI | Add-Member -MemberType NoteProperty -Name $key -Value $defaultWebUI.$key
                    $configChanged = $true
                }
            }
        }

        # If changes were made, convert the object back to JSON and save it
        if ($configChanged) {
            $config | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonFilePath -Force
        }
    }
    catch {
        Write-Error "An unexpected error occurred while processing '$jsonFilePath': $($_.Exception.Message)"
    }
}

$Header = @"
----------------------------------------------------
Ideas for the container were taken from:
DapperDrivers, Onedr0p and PJGitHub9 (effect toolkit inspiration)
----------------------------------------------------
======================================================
  _____          _            _
 |  __ \        | |          (_)
 | |__) |__  ___| |_ ___ _ __ _ ______ _ _ __ _ __
 |  ___/ _ \/ __| __/ _ \ '__| |_  / _``` | '__| '__|
 | |  | (_) \__ \ ||  __/ |  | |/ / (_| | |  | |
 |_|   \___/|___/\__\___|_|  |_/___\__,_|_|  |_|
 ======================================================
 To support the projects visit:
 https://github.com/fscorrupt/posterizarr
----------------------------------------------------
"@

Write-Host $Header

if (!$env:APP_ROOT) {
    $env:APP_ROOT = "/app"
}

if (!$env:APP_DATA) {
    $env:APP_DATA = "/config"
}

$ProgressPreference = 'Continue'

# Permission & User Check
$CurrentUID = sh -c "id -u" 2>$null

# User tried to use PUID/PGID (Unsupported - EXIT)
if ($env:PUID -or $env:PGID) {
    Write-Host "------------------------------------------------------------" -ForegroundColor Red
    Write-Host "ERROR: PUID/PGID DETECTED" -ForegroundColor Red
    Write-Host "Posterizarr does not support PUID/PGID environment variables." -ForegroundColor Yellow
    Write-Host "To set permissions, you MUST use the 'user:' directive in your" -ForegroundColor White
    Write-Host "docker-compose.yml or docker run command." -ForegroundColor White
    Write-Host ""
    Write-Host "Example: user: `"1000:1000`"" -ForegroundColor Cyan
    Write-Host "------------------------------------------------------------" -ForegroundColor Red
    exit 1
}

# Running as root without PUID/PGID (WARNING ONLY)
if ($CurrentUID -eq "0") {
    Write-Host "------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "WARNING: RUNNING AS ROOT" -ForegroundColor Red
    Write-Host "The container is running as root. This is generally discouraged." -ForegroundColor White
    Write-Host "If this was not intentional, please use the 'user:' directive." -ForegroundColor White
    Write-Host ""
    Write-Host "Example: user: `"1000:1000`"" -ForegroundColor Cyan
    Write-Host "------------------------------------------------------------" -ForegroundColor Yellow
}

# Check script version
CompareScriptVersion

# Creating Folder structure
$folders = @("$env:APP_DATA/Logs", "$env:APP_DATA/temp", "$env:APP_DATA/watcher", "$env:APP_DATA/test", "$env:APP_DATA/Overlayfiles")
$createdFolders = @()
$allPresent = $true

foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        try {
            $null = New-Item -Path $folder -ItemType Directory -ErrorAction Stop
            $createdFolders += $folder
            $allPresent = $false
        }
        catch {
            $ErrorMessage = $_.Exception.Message
            Write-Host "------------------------------------------------------------" -ForegroundColor Red
            if ($ErrorMessage -match "Access to the path|Permission denied") {
                Write-Host "CRITICAL ERROR: PERMISSION DENIED" -ForegroundColor Red
                Write-Host "The current user (UID: $CurrentUID) does not have write access" -ForegroundColor White
                Write-Host "to the volume mounted at $env:APP_DATA." -ForegroundColor White
            }
            else {
                Write-Host "CRITICAL ERROR: SYSTEM ERROR" -ForegroundColor Red
                Write-Host "An unexpected error occurred: $ErrorMessage" -ForegroundColor White
            }
            Write-Host "Failed to create folder: $folder" -ForegroundColor Yellow
            Write-Host "------------------------------------------------------------" -ForegroundColor Red
            exit 1
        }
    }
}

if ($allPresent) {
    Write-Host "All folders are already present. Folder creation skipped." -ForegroundColor Green
}
else {
    Write-Host "The following folders were created:" -ForegroundColor Cyan
    foreach ($createdFolder in $createdFolders) {
        Write-Host "    - $createdFolder" -ForegroundColor Yellow
    }
}

# Move assets to APP_DATA
CopyAssetFiles

# Define file paths in variables for clarity and easy maintenance
$configDir = "$env:APP_DATA"
$configFile = Join-Path -Path $configDir -ChildPath "config.json"
$exampleFile = Join-Path -Path $configDir -ChildPath "config.example.json"

# Create default config if missing completely
if (-not (Test-Path $configFile)) {
    Write-Warning "Configuration file not found at '$configFile'."
    # Check if the example file exists (copied by CopyAssetFiles)
    if (Test-Path $exampleFile) {
        Copy-Item -Path $exampleFile -Destination $configFile -Force | Out-Null
        Write-Host "    A new 'config.json' has been created from the example." -ForegroundColor Green
    }
}

# Run advanced CheckJson to fix/update keys
Write-Host "Verifying configuration file integrity..." -ForegroundColor Cyan
if ($global:IsDev -eq 'true'){
    CheckJson -jsonExampleUrl "https://github.com/fscorrupt/posterizarr/raw/dev/config.example.json" -jsonFilePath $configFile
}
Else {
    CheckJson -jsonExampleUrl "https://github.com/fscorrupt/posterizarr/raw/main/config.example.json" -jsonFilePath $configFile
}

# Ensure WebUI config
Ensure-WebUIConfig -jsonFilePath $configFile

# Rest of your script continues here
Write-Host "Config check complete. Proceeding with script..."

# Check temp dir if there is a Currently running file present
$CurrentlyRunning = "$env:APP_DATA/temp/Posterizarr.Running"

# Clear Running File
if (Test-Path $CurrentlyRunning) {
    Remove-Item -LiteralPath $CurrentlyRunning | out-null
    write-host "Cleared .running file..." -ForegroundColor Green
}

# Show integraded Scripts
$StartTime = Get-Date
write-host "Container Started..." -ForegroundColor Green
ScriptSchedule
