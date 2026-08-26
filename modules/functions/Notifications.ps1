function SendMessage {
    param(
        [string]$type,
        [string]$title,
        [string]$Lib,
        [string]$DLSource,
        [string]$lang,
        [string]$favurl,
        [string]$fallback,
        [string]$truncated
    )
    function Build-DiscordPayload {

        # Create a list for the fields
        $fieldList = [System.Collections.Generic.List[object]]::new()

        # Add all common fields
        $fieldList.Add([PSCustomObject]@{ name = "__ZWSP__"; value = ":bar_chart:"; inline = $false })
        $fieldList.Add([PSCustomObject]@{ name = "Type"; value = $type; inline = $false })
        $fieldList.Add([PSCustomObject]@{ name = "Fallback"; value = $fallback; inline = $true })
        $fieldList.Add([PSCustomObject]@{ name = "Language"; value = $lang; inline = $true })
        $fieldList.Add([PSCustomObject]@{ name = "Truncated"; value = $truncated; inline = $true })

        # Removed conditional fields for Tautulli/Arr modes

        # Add remaining fields
        $fieldList.Add([PSCustomObject]@{ name = "__ZWSP__"; value = ":frame_photo:"; inline = $false })

        # Add the title. ConvertTo-Json will handle any special characters in $title
        $fieldList.Add([PSCustomObject]@{ name = "Title"; value = $title; inline = $false })

        $fieldList.Add([PSCustomObject]@{ name = "Library"; value = $Lib; inline = $true })

        $providerName = "Local / Plex"
        if (-not [string]::IsNullOrWhiteSpace($DLSource) -and $DLSource -ne 'false') {
            if ($DLSource -match 'tmdb\.org') { $providerName = "TMDB" }
            elseif ($DLSource -match 'thetvdb\.com') { $providerName = "TVDB" }
            elseif ($DLSource -match 'fanart\.tv') { $providerName = "Fanart" }
            elseif ($DLSource -match 'theposterdb\.com') { $providerName = "TPDb" }
            elseif ($DLSource -match 'mediux\.pro') { $providerName = "MediUX" }
            elseif ($DLSource -match 'imdb\.com') { $providerName = "IMDb" }
        }
        $fieldList.Add([PSCustomObject]@{ name = "Provider Source"; value = $providerName; inline = $true })

        # Add the URL. ConvertTo-Json will handle any special characters in $favurl
        $fieldList.Add([PSCustomObject]@{ name = "Fav Url"; value = $favurl; inline = $true })

        $isLocalUrl = $true
        if ($DLSource -match 'tmdb\.org|thetvdb\.com|fanart\.tv|theposterdb\.com|mediux\.pro|imdb\.com') {
            $isLocalUrl = $false
        }

        $embed = [PSCustomObject]@{
            author      = @{
                name = "Posterizarr @Github"
                url  = "https://github.com/fscorrupt/posterizarr"
            }
            description = "Recently Added`n`n"
            timestamp   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            color       = $(if ($errorCount -ge '1') { 16711680 } Elseif ($global:IsFallback -eq 'true' -or $global:IsTruncated -eq 'true') { 15120384 } Else { 5763719 })
            fields      = $fieldList
            footer      = @{
                text = "$Platform  | vCurr: $CurrentScriptVersion | vNext: $LatestScriptVersion | IM vCurr: $global:CurrentImagemagickversion | IM vNext: $global:LatestImagemagickversion"
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($DLSource) -and -not $isLocalUrl) {
            $embed | Add-Member -MemberType NoteProperty -Name "thumbnail" -Value @{ url = $DLSource }
        }

        # Build the final payload object
        $payloadObject = [PSCustomObject]@{
            username   = $(if ([string]::IsNullOrWhiteSpace($global:DiscordUserName)) { "Posterizarr" } else { $global:DiscordUserName })
            avatar_url = "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/docs/images/webhook.png"
            # content    = ""
            embeds     = @($embed)
        }

        # Convert the entire object to a JSON string safely
        # -Depth 6 is needed to make sure it nests everything (payload->embeds->fields)
        return ($payloadObject | ConvertTo-Json -Depth 6) -replace '__ZWSP__', '\u200b'
    }

    if ($global:NotifyUrl -and $global:SendNotification -eq 'true') {

        # Handle Discord notifications
        if ($global:NotifyUrl -like '*discord*') {
            $jsonPayload = Build-DiscordPayload
            $webhookUrl = $global:NotifyUrl -replace '(?i)^discord://(?:[^@/]+@)?(.*)$', 'https://discord.com/api/webhooks/$1'
            Push-ObjectToDiscord -strDiscordWebhook $webhookUrl -objPayload $jsonPayload
        }

        # Handle Apprise notifications
        Elseif ($env:POWERSHELL_DISTRIBUTION_CHANNEL -like 'PSDocker*') {
            if ($errorCount -ge '1') {
                apprise --notification-type="failure" --title="Posterizarr" --body="Run took: $FormattedTimespawn`nIt Created '$posterCount' Images`n`nDuring execution '$errorCount' Errors occurred, please check log for detailed description." "$global:NotifyUrl"
            }
            Else {
                apprise --notification-type="success" --title="Posterizarr" --body="Run took: $FormattedTimespawn`nIt Created '$posterCount' Images" "$global:NotifyUrl"
            }
        }
    }
}
function Push-ObjectToDiscord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$strDiscordWebhook,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$objPayload
    )

    try {
        $response = Invoke-RestMethod -Method Post -Uri $strDiscordWebhook -Body $objPayload -ContentType 'Application/Json' -ResponseHeadersVariable "resHeaders"

        Write-Entry -Subtext "Discord webhook sent successfully." -Path $global:configLogging -Color Green -log Info

        # Smart Rate Limiting: Discord returns 'x-ratelimit-reset-after' in seconds
        if ($resHeaders.'x-ratelimit-remaining' -eq 0) {
            $waitTime = $resHeaders.'x-ratelimit-reset-after'
            Write-Verbose "Rate limit reached. Sleeping for $waitTime seconds."
            Start-Sleep -Seconds [math]::Ceiling($waitTime)
        }
        else {
            # Default safety gap
            Start-Sleep -Milliseconds 500
        }
    }
    catch {
        $errorMessage = "Unable to send to Discord."
        $discordErrorBody = "N/A"
        $statusCode = "N/A"

        # Check if we have a response object
        if ($_.Exception.Response) {
            $response = $_.Exception.Response
            $statusCode = $response.StatusCode

            if ($statusCode -eq 'NotFound') {
                $errorMessage = "Unable to send to Discord. Status: $statusCode. Reason: Wrong Webhook Url"
            }
            else {
                # Handle PowerShell 7+ (HttpResponseMessage)
                if ($_.ErrorDetails) {
                    $discordErrorBody = $_.ErrorDetails.Message
                }
                elseif ($response.GetType().Name -eq 'HttpResponseMessage') {
                    try {
                        $task = $response.Content.ReadAsStringAsync()
                        $discordErrorBody = $task.Result
                    } catch {
                        $discordErrorBody = "Could not read disposed response"
                    }
                }
                # Handle Windows PowerShell 5.1 (HttpWebResponse)
                elseif ($response.GetResponseStream) {
                    $stream = $response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($stream)
                    $discordErrorBody = $reader.ReadToEnd()
                    $reader.Close()
                }
                $errorMessage = "Unable to send to Discord. Status: $statusCode. Reason: $discordErrorBody"
            }
        }
        else {
            $errorMessage = "Network/DNS Error: $($_.Exception.Message)"
        }

        # Logging to Posterizarr globals
        Write-Entry -Message $errorMessage -Path $global:configLogging -Color Red -log Error
        Write-Entry -Message "Failing Payload: $objPayload" -Path $global:configLogging -Color Red -log Error
    }
}
function Send-PosterizarrTelemetry {
    # Immediately return/exit if the config's telemetry toggle is set to false.
    if ($config.PrerequisitePart.telemetry -eq $false -or $config.PrerequisitePart.telemetry -eq 'false') {
        return
    }

    $cacheFile = Join-Path $global:ScriptRoot 'Cache\telemetry.cache.json'
    try {
        $cacheDir = Split-Path -Parent $cacheFile
        if ($cacheDir -and -not (Test-Path -LiteralPath $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
    }
    catch {}
    $cache = $null
    if (Test-Path $cacheFile) {
        try {
            $cache = Get-Content $cacheFile -Raw | ConvertFrom-Json
        }
        catch {}
    }

    $instanceId = $null
    if ($cache -and $cache.InstanceId) {
        $instanceId = $cache.InstanceId
    }
    else {
        $instanceId = [guid]::NewGuid().ToString()
    }

    $cachedVersion = $null
    if ($cache -and $cache.AppVersion) {
        $cachedVersion = $cache.AppVersion
    }

    if ($cachedVersion -eq $CurrentScriptVersion) {
        return
    }

    $osName = $Platform

    if ($config.PlexPart.UsePlex -eq 'true' -or $config.PlexPart.UsePlex -eq $true) {
        $target = "Plex"
    } elseif ($config.JellyfinPart.UseJellyfin -eq 'true' -or $config.JellyfinPart.UseJellyfin -eq $true) {
        $target = "Jellyfin"
    } elseif ($config.EmbyPart.UseEmby -eq 'true' -or $config.EmbyPart.UseEmby -eq $true) {
        $target = "Emby"
    }

    $payload = @{
        InstanceId = $instanceId
        os         = $osName
        target     = $target
        appVersion = $CurrentScriptVersion
    }

    try {
        Invoke-RestMethod -Uri "https://telemetry.posterizarr-stats.workers.dev/" -Method Post -Body ($payload | ConvertTo-Json -Compress) -ContentType "application/json" -ErrorAction Stop | Out-Null

        $newCache = @{
            InstanceId = $instanceId
            AppVersion = $CurrentScriptVersion
        }
        $newCache | ConvertTo-Json -Compress | Set-Content $cacheFile -Force
    }
    catch {
        Write-Verbose "Telemetry failed silently: $($_.Exception.Message)"
    }
}
function Send-UptimeKumaWebhook {
    param (
        [string]$status,
        [string]$msg = "OK",
        [int]$ping = 0
    )

    $uri = $global:UptimeKumaUrl + "?status=$status&msg=$msg&ping=$ping"
    try {
        $null = Invoke-RestMethod -Uri $uri
        Write-Entry -Message "Uptime Kuma webhook sent: Status=$status, Msg=$msg, Ping=$ping" -Path $global:configLogging -Color White -log Info
    }
    catch {
        Write-Entry -Message "Failed to send Uptime Kuma webhook: $_" -Path $global:configLogging -Color Red -log Error
    }
}
function Send-SummaryNotification {
    param (
        [string]$ScriptMode,
        [string]$FormattedTimespawn,
        [int]$ErrorCount,
        [int]$FallbackCount,
        [int]$TextlessCount,
        [int]$TruncatedCount,
        [int]$PosterUnknownCount,
        [int]$SkipTBACount,
        [int]$SkipJapTitleCount,
        [int]$PosterCount,
        [int]$BackgroundCount,
        [int]$SeasonCount,
        [int]$EpisodeCount,
        [int]$ImagesCleared,
        [int]$PathsCleared,
        [string]$SavedSizeString,
        [int]$UploadCount,
        [int]$MatchedCount,
        [string]$LibName
    )

    if (-not ($global:NotifyUrl -and $global:SendNotification -eq 'true')) {
        return # Do nothing if notifications are off
    }

    # 1. Handle Apprise (Docker)
    if ($global:NotifyUrl -notlike '*discord*' -and $env:POWERSHELL_DISTRIBUTION_CHANNEL -like 'PSDocker*') {
        $body = "Run took: $FormattedTimespawn`nIt Created '$PosterCount' Images"

        if ($ScriptMode -eq 'backup') {
            $body = "Run took: $FormattedTimespawn`nIt Downloaded '$PosterCount' Images"
        }
        if ($ScriptMode -eq 'syncjelly' -or $ScriptMode -eq 'syncemby') {
            $body = "Run took: $FormattedTimespawn`nIt Synced '$UploadCount' Images"
        }
        if ($ScriptMode -eq 'logoupdater') {
            $body = "Run took: $FormattedTimespawn`nIt Matched '$MatchedCount' and Updated '$UploadCount' Logos"
        }

        if ($ErrorCount -ge '1') {
            apprise --notification-type="failure" --title="Posterizarr" --body="$body`n`nDuring execution '$ErrorCount' Errors occurred, please check log." "$global:NotifyUrl"
        }
        else {
            apprise --notification-type="success" --title="Posterizarr" --body="$body" "$global:NotifyUrl"
        }
        return
    }

    # 2. Handle Discord
    if ($global:NotifyUrl -like '*discord*') {

        $desc = "Run took: $FormattedTimespawn"
        if ($ScriptMode -eq 'backup') {
            $desc = "Backup Run took: $FormattedTimespawn"
        }
        if ($ScriptMode -eq 'syncjelly' -or $ScriptMode -eq 'syncemby') {
            $desc = "Sync Run took: $FormattedTimespawn"
        }
        if ($ScriptMode -eq 'testing') {
            $desc = "Test run took: $FormattedTimespawn"
        }
        if ($ScriptMode -eq 'tautulli' -or $ScriptMode -eq 'arr') {
            $desc = "Recently added Run took: $FormattedTimespawn"
        }
        if ($ScriptMode -eq 'logoupdater') {
            $desc = "Logo Updater Run took: $FormattedTimespawn`nOn Lib - $LibName"
        }

        if ($ErrorCount -ge '1') {
            $desc += "`nDuring execution Errors occurred, please check log."
        }

        # Build Fields
        $fieldList = [System.Collections.Generic.List[object]]::new()

        # Stats Section
        $fieldList.Add([PSCustomObject]@{ name = "__ZWSP__"; value = ":bar_chart:"; inline = $false })
        if ($ScriptMode -eq 'testing') {
            $fieldList.Add([PSCustomObject]@{ name = "Truncated"; value = $TruncatedCount; inline = $false })
        }
        else {
            if ($ScriptMode -eq 'logoupdater') {
                $fieldList.Add([PSCustomObject]@{ name = "Errors"; value = $ErrorCount; inline = $false })
            }
            Else {
                $fieldList.Add([PSCustomObject]@{ name = "Errors"; value = $ErrorCount; inline = $false })
                $fieldList.Add([PSCustomObject]@{ name = "Fallbacks"; value = $FallbackCount; inline = $true })
                $fieldList.Add([PSCustomObject]@{ name = "Textless"; value = $TextlessCount; inline = $true })
                $fieldList.Add([PSCustomObject]@{ name = "Truncated"; value = $TruncatedCount; inline = $true })
                $fieldList.Add([PSCustomObject]@{ name = "Unknown"; value = $PosterUnknownCount; inline = $true })
                if (($SkipTBA -eq 'true' -or $SkipJapTitle -eq 'true') -and $ScriptMode -notin @('tautulli', 'arr')) {
                    $fieldList.Add([PSCustomObject]@{ name = "TBA Skipped"; value = $SkipTBACount; inline = $true })
                    $fieldList.Add([PSCustomObject]@{ name = "Jap/Chinese Skipped"; value = $SkipJapTitleCount; inline = $true })
                }
            }
        }

        # Images / Logos Section
        $fieldList.Add([PSCustomObject]@{ name = "__ZWSP__"; value = ":frame_photo:"; inline = $false })
        if ($ScriptMode -eq 'backup') {
            $fieldList.Add([PSCustomObject]@{ name = "Posters Downloaded"; value = ($PosterCount - $SeasonCount - $BackgroundCount - $EpisodeCount); inline = $false })
            $fieldList.Add([PSCustomObject]@{ name = "Backgrounds Downloaded"; value = $BackgroundCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "Seasons Downloaded"; value = $SeasonCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "TitleCards Downloaded"; value = $EpisodeCount; inline = $true })
        }
        elseif ($ScriptMode -eq 'syncjelly' -or $ScriptMode -eq 'syncemby') {
            $fieldList.Add([PSCustomObject]@{ name = "Posters Uploaded"; value = ($UploadCount - $SeasonCount - $BackgroundCount - $EpisodeCount); inline = $false })
            $fieldList.Add([PSCustomObject]@{ name = "Backgrounds Uploaded"; value = $BackgroundCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "Seasons Uploaded"; value = $SeasonCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "TitleCards Uploaded"; value = $EpisodeCount; inline = $true })
        }
        elseif ($ScriptMode -eq 'logoupdater') {
            $fieldList.Add([PSCustomObject]@{ name = "Logos Matched"; value = $MatchedCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "Logos Updated"; value = $UploadCount; inline = $true })
        }
        else {
            if ($ScriptMode -eq 'testing') {
                $fieldList.Add([PSCustomObject]@{ name = "Posters"; value = $posterscount; inline = $false })
            }
            else {
                # For Normal/Arr/Tautulli, $PosterCount IS the total, so subtraction is correct.
                $fieldList.Add([PSCustomObject]@{ name = "Posters"; value = ($PosterCount - $SeasonCount - $BackgroundCount - $EpisodeCount); inline = $false })
            }
            $fieldList.Add([PSCustomObject]@{ name = "Backgrounds"; value = $BackgroundCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "Seasons"; value = $SeasonCount; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "TitleCards"; value = $EpisodeCount; inline = $true })
        }

        # Cleanup Section
        if ($AssetCleanup -eq 'true' -and $ScriptMode -ne 'testing' -and $ScriptMode -ne 'backup' -and $ScriptMode -ne 'syncjelly' -and $ScriptMode -ne 'syncemby' -and $ScriptMode -ne 'logoupdater') {
            $fieldList.Add([PSCustomObject]@{ name = "__ZWSP__"; value = ":recycle:"; inline = $false })
            $fieldList.Add([PSCustomObject]@{ name = "Images cleared"; value = $ImagesCleared; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "Folders Cleared"; value = $PathsCleared; inline = $true })
            $fieldList.Add([PSCustomObject]@{ name = "Space saved"; value = $SavedSizeString; inline = $true })
        }

        # Build final payload
        $payloadObject = [PSCustomObject]@{
            username   = $(if ([string]::IsNullOrWhiteSpace($global:DiscordUserName)) { "Posterizarr" } else { $global:DiscordUserName })
            avatar_url = "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/docs/images/webhook.png"
            content    = ""
            embeds     = @(
                [PSCustomObject]@{
                    author      = @{
                        name = "Posterizarr @Github"
                        url  = "https://github.com/fscorrupt/posterizarr"
                    }
                    description = $desc
                    timestamp   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    color       = $(if ($ErrorCount -ge '1') { 16711680 } Elseif ($Testing) { 8388736 } Elseif ($FallbackCount -gt '1' -or $PosterUnknownCount -ge '1' -or $TruncatedCount -gt '1') { 15120384 } Else { 5763719 })
                    fields      = $fieldList
                    thumbnail   = @{
                        url = "https://github.com/fscorrupt/posterizarr/raw/$($Branch)/docs/images/webhook.png"
                    }
                    footer      = @{
                        text = "$Platform  | vCurr: $CurrentScriptVersion | vNext: $LatestScriptVersion | IM vCurr: $global:CurrentImagemagickversion | IM vNext: $global:LatestImagemagickversion"
                    }
                }
            )
        }

        $jsonPayload = ($payloadObject | ConvertTo-Json -Depth 6) -replace '__ZWSP__', '\u200b'
        $webhookUrl = $global:NotifyUrl -replace '(?i)^discord://(?:[^@/]+@)?(.*)$', 'https://discord.com/api/webhooks/$1'
        Push-ObjectToDiscord -strDiscordWebhook $webhookUrl -objPayload $jsonPayload
    }
}

function Send-AgregarrTrigger {
    param (
        [Parameter(Mandatory = $true)][string]$RatingKey,
        [Parameter(Mandatory = $true)][ValidateSet('movie', 'show')][string]$MediaType,
        [string]$Title,
        [Nullable[int]]$SeasonNumber,
        [Nullable[int]]$EpisodeNumber
    )

    if ($global:AgregarrTriggerEnabled -ne 'true') { return }

    if ([string]::IsNullOrWhiteSpace($global:AgregarrUrl) -or [string]::IsNullOrWhiteSpace($global:AgregarrApiKey)) {
        Write-Entry -Message "Agregarr trigger is enabled, but Url or ApiKey is missing." -Path $global:configLogging -Color Yellow -log Warning
        return
    }

    $triggerUrl = "$($global:AgregarrUrl)/api/v1/posterizarr/trigger"
    $headers = @{ 'X-Api-Key' = $global:AgregarrApiKey }
    $bodyObject = @{
        ratingKey = $RatingKey
        mediaType = $MediaType
        title = $Title
    }
    if ($null -ne $SeasonNumber) { $bodyObject['seasonNumber'] = $SeasonNumber }
    if ($null -ne $EpisodeNumber) { $bodyObject['episodeNumber'] = $EpisodeNumber }
    $body = $bodyObject | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod -Method Post -Uri $triggerUrl -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 15 -ErrorAction Stop
        Write-Entry -Message "Agregarr trigger accepted for '$Title' (Plex rating key $RatingKey)." -Path $global:configLogging -Color Green -log Info
        Write-Entry -Subtext "Queued: $($response.queued) | Deduplicated: $($response.deduplicated)" -Path $global:configLogging -Color Cyan -log Debug
    }
    catch {
        # Artwork creation already succeeded. A downstream automation outage must
        # be visible, but it must not turn the Posterizarr run into a failure.
        Write-Entry -Message "Agregarr trigger failed for '$Title': $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
    }
}
