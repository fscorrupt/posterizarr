function SyncPlexArtwork {
    param(
        [string]$ArtUrl,
        [string]$DestUrl,
        [string]$imageType,
        [string]$title,
        [string]$artworktype
    )
    $startmessage = $null

    # Destination server calls (Jellyfin/Emby) require auth headers.
    $destHeaders = $global:OtherMediaServerHeaders
    if (-not $destHeaders) {
        $destHeaders = @{}
    }

    $requestHeaders = @{}
    if ($PlexToken) {
        $requestHeaders['X-Plex-Token'] = $PlexToken
    }

    if ($show_skipped -eq 'true') {
        Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
        $startmessage = $true
    }
    Else {
        Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Debug
        if ($global:logLevel -eq '3') {
            $startmessage = $true
        }
    }

    # Some Emby/Jellyfin failures return plain-text bodies (for example, starting with "Error").
    # Only attempt JSON parsing when the payload actually looks like JSON.
    function TryParse-JsonErrorResponse {
        param($ErrorRecord)

        if (-not $ErrorRecord -or -not $ErrorRecord.ErrorDetails -or [string]::IsNullOrWhiteSpace($ErrorRecord.ErrorDetails.Message)) {
            return $null
        }

        $rawMessage = [string]$ErrorRecord.ErrorDetails.Message
        if ($rawMessage -notmatch '^\s*[\{\[]') {
            return $null
        }

        try {
            return ($rawMessage | ConvertFrom-Json -ErrorAction Stop)
        }
        catch {
            return $null
        }
    }

    try {
        Write-Entry -Subtext "Fetching image from source: $(RedactMediaServerUrl -url $ArtUrl)" -Path $global:configLogging -Color Cyan -log Debug
        $imageResponse = Invoke-WebRequest -Uri $ArtUrl -Headers $requestHeaders -UseBasicParsing -ErrorAction Stop
    }
    catch {
        $errorResponse = TryParse-JsonErrorResponse -ErrorRecord $_

        if ($errorResponse) {
            $errorTitle = $errorResponse.title
            $errorStatus = $errorResponse.status
            if (-not $startmessage) {
                Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
            }
            Write-Entry -Subtext "Failed to retrieve source image: Status: $errorStatus, Title: $errorTitle" -Path $global:configLogging -Color Red -log Error
        }
        else {
            if (-not $startmessage) {
                Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
            }
            $rawErrorText = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            Write-Entry -Subtext "Failed to retrieve source image: $rawErrorText" -Path $global:configLogging -Color Red -log Error
        }

        return
    }


    if ($imageResponse.StatusCode -ne 200) {
        if (-not $startmessage) {
            Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
        }
        Write-Entry -Subtext "Unexpected response from source ($(RedactMediaServerUrl -url $ArtUrl)): $($imageResponse.StatusCode)" -Path $global:configLogging -Color Red -log Error
        return
    }

    $remoteImageBytes = $imageResponse.Content
    if (-not $remoteImageBytes) {
        if (-not $startmessage) {
            Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
        }
        Write-Entry -Subtext "Source image content is empty!" -Path $global:configLogging -Color Red -log Error
        return
    }

    $remoteImageContentType = $imageResponse.Headers.'Content-Type'
    if ($remoteImageContentType -is [System.Array]) {
        $remoteImageContentType = $remoteImageContentType[0]
    }

    Write-Entry -Subtext "Calculating hash for remote image..." -Path $global:configLogging -Color Cyan -log Debug
    $remoteImageHash = GetHash -imageBytes $remoteImageBytes

    try {
        Write-Entry -Subtext "Fetching existing image from destination: $(RedactMediaServerUrl -url $DestUrl)" -Path $global:configLogging -Color Cyan -log Debug
        $existingImageResponse = Invoke-WebRequest -Uri $DestUrl -Headers $destHeaders -UseBasicParsing -ErrorAction Stop
    }
    catch {
        $errorResponse = TryParse-JsonErrorResponse -ErrorRecord $_

        if ($errorResponse) {
            $errorTitle = $errorResponse.title
            $errorStatus = $errorResponse.status
            if (-not $startmessage) {
                Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
            }
            Write-Entry -Subtext "Failed to retrieve destination image: Status: $errorStatus, Title: $errorTitle" -Path $global:configLogging -Color Red -log Error
        }
        else {
            if (-not $startmessage) {
                Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
            }
            $rawErrorText = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            Write-Entry -Subtext "Failed to retrieve destination image: $rawErrorText" -Path $global:configLogging -Color Red -log Error
        }

        return
    }


    if ($existingImageResponse.StatusCode -ne 200) {
        if (-not $startmessage) {
            Write-Entry -Message "Starting SyncPlexArtwork for: $title" -Path $global:configLogging -Color White -log Info
        }
        Write-Entry -Subtext "Unexpected response from destination ($(RedactMediaServerUrl -url $DestUrl)): $($existingImageResponse.StatusCode)" -Path $global:configLogging -Color Red -log Error
        return
    }

    $existingImageBytes = $existingImageResponse.Content
    if (-not $existingImageBytes) {
        Write-Entry -Subtext "Existing image content is empty!" -Path $global:configLogging -Color Yellow -log Warning
    }

    $existingImageHash = GetHash -imageBytes $existingImageBytes
    if ($remoteImageHash -eq $existingImageHash) {
        if ($show_skipped -eq 'true') {
            Write-Entry -Subtext "Image hashes match, skipping upload for $title" -Path $global:configLogging -Color White -log Info
        }
        Else {
            Write-Entry -Subtext "Image hashes match, skipping upload for $title" -Path $global:configLogging -Color White -log Debug
        }
        if ($DisableHashValidation -eq 'true') {
            Write-Entry -Subtext "Hash validation is disabled, proceeding with upload..." -Path $global:configLogging -Color Yellow -log Warning
        }
        else {
            return
        }
    }

    Write-Entry -Subtext "Uploading new artwork to Jelly/Emby for: $title" -Path $global:configLogging -Color White -log Info

    if ($imageType -eq 'Backdrop') {
        $isExclusive = ($global:ReplaceThumbwithBackdrop -eq 'true' -and $global:ReplaceThumbwithBackdropExclusively -eq 'true')
        
        if (-not $isExclusive) {
            try {
                Write-Entry -Subtext "Deleting old artwork before upload..." -Path $global:configLogging -Color Yellow -log Info
                Invoke-RestMethod -Uri $DestUrl -Method Delete -Headers $destHeaders -ErrorAction Stop
                Write-Entry -Subtext "Successfully deleted old artwork." -Path $global:configLogging -Color Green -log Info
            }
            catch {
                $errorResponse = TryParse-JsonErrorResponse -ErrorRecord $_

                if ($errorResponse) {
                    $errorTitle = $errorResponse.title
                    $errorStatus = $errorResponse.status

                    Write-Entry -Subtext "Error deleting image: Status: $errorStatus, Title: $errorTitle" -Path $global:configLogging -Color Red -log Error
                }
                else {
                    $rawErrorText = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
                    Write-Entry -Subtext "Error deleting image: $rawErrorText" -Path $global:configLogging -Color Red -log Error
                }
            }
        }

        if ($global:ReplaceThumbwithBackdrop -eq 'true') {
            $thumbapiUrl = $DestUrl -replace '/Backdrop/?$', '/Thumb/'
            try {
                $imageBase64 = [Convert]::ToBase64String($remoteImageBytes)
                $response = Invoke-RestMethod -Uri $thumbapiUrl -Method Post -Headers $destHeaders -Body $imageBase64 -ContentType $remoteImageContentType -ErrorAction Stop
                Write-Entry -Subtext "Thumb uploaded successfully." -Path $global:configLogging -Color Green -log Info
                $global:UploadCount = Increment-GlobalStat 'UploadCount'
            }
            catch {
                $rawErrorText = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
                Write-Entry -Subtext "Error uploading Thumb image: $rawErrorText" -Path $global:configLogging -Color Red -log Error
            }
            
            if ($isExclusive) {
                Write-Entry -Subtext "Replace Thumb Exclusively is enabled. Skipping Backdrop upload." -Path $global:configLogging -Color Cyan -log Info
                $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
                return
            }
        }
    }

    try {
        $imageBase64 = [Convert]::ToBase64String($remoteImageBytes)
        $response = Invoke-RestMethod -Uri $DestUrl -Method Post -Headers $destHeaders -Body $imageBase64 -ContentType $remoteImageContentType -ErrorAction Stop
        Write-Entry -Subtext "Image uploaded successfully." -Path $global:configLogging -Color Green -log Info

        switch ($artworktype) {
            'poster' { $postercount++ }
            'tc' { $global:EpisodeCount = Increment-GlobalStat 'EpisodeCount' }
            'background' { $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount' }
            'season' { $global:SeasonCount = Increment-GlobalStat 'SeasonCount' }
        }
        $global:UploadCount = Increment-GlobalStat 'UploadCount'
    }
    catch {
        $statusCode = $null
        $message = $_.ErrorDetails.Message
        $rawExceptionMessage = $_.Exception.Message
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        # Attempt to parse structured JSON response if present.
        if ($message -match '^\s*\{.*\}\s*$') {
            $errorResponse = $message | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }

        if ($errorResponse) {
            $errorTitle = $errorResponse.title
            $errorStatus = $errorResponse.status
            Write-Entry -Subtext "Error uploading image: Status: $errorStatus, Title: $errorTitle" -Path $global:configLogging -Color Red -log Error
        }
        elseif ($statusCode) {
            if ([string]::IsNullOrWhiteSpace($message)) {
                $message = $rawExceptionMessage
            }
            Write-Entry -Subtext "Error uploading image: HTTP $statusCode - $message" -Path $global:configLogging -Color Red -log Error
        }
        else {
            if ([string]::IsNullOrWhiteSpace($message)) {
                $message = $rawExceptionMessage
            }
            Write-Entry -Subtext "Error uploading image: $message" -Path $global:configLogging -Color Red -log Error
        }
    }

}