
function UploadOtherMediaServerArtwork {
    param (
        [string]$itemId,
        [string]$imageType,
        [string]$imagePath,
        [switch]$SkipExifCheck # Added optional parameter
    )

    $userAssetType = $imageType
    if ($imageType -eq 'Backdrop') {
        $userAssetType = "Background"
    }
    elseif ($imageType -eq 'Primary') {
        $filename = [System.IO.Path]::GetFileName($imagePath)
        if ($filename -match 'S\d{2}E\d{2}') {
            $userAssetType = "TitleCard"
        }
        elseif ($filename -match '(?i)season\d{2}') {
            $userAssetType = "Season Poster"
        }
        else {
            $userAssetType = "Poster"
        }
    }

    # Check if current image already has exif data
    $Imageinfo = Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/items/$itemId/images/" -Headers $global:OtherMediaServerHeaders
    $Imageinfotemp = $Imageinfo | Where-Object imagetype -eq $imageType | Select-Object Height, Width, Path
    if ($Imageinfotemp) {
        $Imageinfotemp = $imageinfotemp[0]
    }
    # Clear value to ensure no old data causes a false skip
    $value = $null

    # Only run the EXIF check if the switch was NOT provided
    if (-not $SkipExifCheck) {
        # Set the API endpoint URL for magick exif check
        if (($imageinfotemp.Height) -and ($imageinfotemp.width)) {
            try {
                $ImageUrl = "$OtherMediaServerUrl/items/$itemId/images/$imageType/?width=$($imageinfotemp.width)&height=$($imageinfotemp.Height)"
                $guid = [guid]::NewGuid().ToString()
                $tempFile = Join-Path -Path $global:ScriptRoot -ChildPath "temp\hashcompare_$guid.jpg"

                # Try to download the image
                $response = Invoke-WebRequest -Uri $ImageUrl -OutFile $tempFile -TimeoutSec 30 -ErrorAction Stop

                $magickcommand = "& `"$magick`" identify -verbose `"$tempFile`""
                $magickcommand | Write-MagickLog
                $value = Invoke-Expression $magickcommand | Select-String -Pattern 'overlay|titlecard|created with ppm|created with posterizarr'

                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue -WarningAction SilentlyContinue | out-null
            }
            catch {
                # Log as a warning (not error) so we know why the check failed, but don't stop the script
                Write-Entry -Subtext "Exif check skipped (Image 404 or missing). Proceeding to upload. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning

                # Ensure temp file cleanup happens if the download partially succeeded or failed
                if (Test-Path $tempFile) {
                    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue -WarningAction SilentlyContinue | out-null
                }
            }
        }
    }

    if ($value -and $DisableHashValidation -eq 'false') {
        $ExifFound = $True
        Write-Entry -Subtext "Artwork has exif data from posterizarr/kometa/tcm, skip upload..." -Path $global:configLogging -Color Yellow -log Warning
    }
    Else {
        if ($DisableHashValidation -eq 'false') {
            Write-Entry -Subtext "No posterizarr/kometa/tcm exif data found, starting upload..." -Path $global:configLogging -Color Green -log Info
        }
        # Read the image file as binary
        $imageData = [System.IO.File]::ReadAllBytes($imagePath)

        # Convert the image to a base64 string
        $imageBase64 = [Convert]::ToBase64String($imageData)

        # Determine the content type based on the file extension
        switch ([System.IO.Path]::GetExtension($imagePath).ToLower()) {
            ".jpg" { $contentType = "image/jpeg" }
            ".jpeg" { $contentType = "image/jpeg" }
            ".png" { $contentType = "image/png" }
            ".gif" { $contentType = "image/gif" }
            ".bmp" { $contentType = "image/bmp" }
            ".tiff" { $contentType = "image/tiff" }
            default {
                Write-Entry -Subtext "Unsupported image format." -Path $global:configLogging -Color Red -log Error
                # Clear Running File
                HandleScriptExit -Message "Unsupported image format"
            }
        }

        # Set the API endpoint URL
        $apiUrl = "$OtherMediaServerUrl/items/$itemId/images/$imageType/"

        if ($imageType -eq "Backdrop") {
            $deleteUrl = "$OtherMediaServerUrl/items/$itemId/images/$imageType/0"
            # Make the API request to delete the backdrop image
            try {
                # Delete the existing image first
                $response = Invoke-RestMethod -Uri $deleteUrl -Method Delete -ErrorAction Stop -Headers $global:OtherMediaServerHeaders
                Write-Entry -Subtext "Image successfully deleted..." -Path $global:configLogging -Color Green -log Info
                $global:UploadCount = Increment-GlobalStat 'UploadCount'
            }
            catch {
                if ($_.Exception.Response -is [System.Net.Http.HttpResponseMessage] -and $_.Exception.Response.Content) {
                    try {
                        $response = $_.Exception.Response.Content.ReadAsStringAsync().Result
                    }
                    catch {
                        $response = "Unable to read server response (content may be disposed)."
                    }
                    Write-Entry -Subtext "Failed to delete image. Server response: $response" -Path $global:configLogging -Color Red -log Error
                }
                else {
                    Write-Entry -Subtext "Failed to delete image. Error: $_" -Path $global:configLogging -Color Red -log Error
                }
            }
            if ($global:ReplaceThumbwithBackdrop -eq 'true') {
                # Make the API request to upload the Thumb image
                $thumbapiUrl = "$OtherMediaServerUrl/items/$itemId/images/Thumb/"
                try {
                    $response = Invoke-RestMethod -Uri $thumbapiUrl -Method Post -Body $imageBase64 -ContentType $contentType -ErrorAction Stop -Headers $global:OtherMediaServerHeaders

                    $logTitle = if ($Titletext) { "$Titletext " } else { "" }
                    Write-Entry -Subtext "$($logTitle)Thumb successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                    $global:UploadCount = Increment-GlobalStat 'UploadCount'
                }
                catch {
                    if ($_.Exception.Response -is [System.Net.Http.HttpResponseMessage] -and $_.Exception.Response.Content) {
                        try {
                            $response = $_.Exception.Response.Content.ReadAsStringAsync().Result
                        }
                        catch {
                            $response = "Unable to read server response (content may be disposed)."
                        }
                        Write-Entry -Subtext "Failed to upload Thumb image. Server response: $response" -Path $global:configLogging -Color Red -log Error
                    }
                    else {
                        Write-Entry -Subtext "Failed to upload Thumb image. Error: $_" -Path $global:configLogging -Color Red -log Error
                    }
                }
            }
        }
        # Make the API request to upload the image
        $maxRetries = 3
        $retryCount = 0
        $success = $false

        while (-not $success -and $retryCount -lt $maxRetries) {
            try {
                $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Body $imageBase64 -ContentType $contentType -ErrorAction Stop -Headers $global:OtherMediaServerHeaders
                $success = $true
                $logTitle = if ($Titletext) { "$Titletext " } else { "" }
                Write-Entry -Subtext "$($logTitle)$userAssetType successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                $global:UploadCount = Increment-GlobalStat 'UploadCount'
            }
            catch {
                $retryCount++
                if ($retryCount -ge $maxRetries) {
                    if ($_.Exception.Response -is [System.Net.Http.HttpResponseMessage] -and $_.Exception.Response.Content) {
                        try {
                            $responseMsg = $_.Exception.Response.Content.ReadAsStringAsync().Result
                        }
                        catch {
                            $responseMsg = "Unable to read server response (content may be disposed)."
                        }
                        Write-Entry -Subtext "Failed to upload image after $maxRetries attempts. Server response: $responseMsg" -Path $global:configLogging -Color Red -log Error
                    }
                    else {
                        Write-Entry -Subtext "Failed to upload image after $maxRetries attempts. Error: $_" -Path $global:configLogging -Color Red -log Error
                    }
                } else {
                    Write-Entry -Subtext "Upload failed, retrying ($retryCount/$maxRetries)..." -Path $global:configLogging -Color Yellow -log Warning
                    Start-Sleep -Seconds (Get-Random -Minimum 1 -Maximum 4)
                }
            }
        }
    }
}
function Push-PlexAsset {
    param (
        [string]$RatingKey,
        [string]$AssetPath,
        [string]$Type # 'posters' or 'arts'
    )
    if (Test-Path -LiteralPath $AssetPath) {
        Write-Entry -Subtext "Restoring $Type for $RatingKey from $AssetPath" -Path $global:configLogging -Color Cyan -log Info
        $uri = "$PlexUrl/library/metadata/$RatingKey/$Type"
        try {
            Invoke-RestMethod -Uri $uri -Method Post -InFile $AssetPath -ContentType "image/jpeg" -Headers $PlexHeaders
            Write-Entry -Subtext "$Type successfully restored for $RatingKey..." -Path $global:configLogging -Color Green -log Info
            return $true
        } catch {
            Write-Entry -Subtext "Failed to restore $Type for $RatingKey. Error: $_" -Path $global:configLogging -Color Red -log Error
            return $false
        }
    }
    return $false
}
function Push-EmbyAsset {
    param (
        [string]$ItemId,
        [string]$AssetPath,
        [string]$Type # 'Primary' (poster), 'Backdrop' (background), 'Thumb' (titlecard)
    )
    if (Test-Path -LiteralPath $AssetPath) {
        Write-Entry -Subtext "Restoring $Type for $ItemId from $AssetPath" -Path $global:configLogging -Color Cyan -log Info
        $bytes = [System.IO.File]::ReadAllBytes($AssetPath)
        $imageBase64 = [Convert]::ToBase64String($bytes)

        $uri = "$OtherMediaServerUrl/Items/$ItemId/Images/$Type/"
        try {
            Invoke-RestMethod -Uri $uri -Method Post -Body $imageBase64 -ContentType "image/jpeg" -Headers $global:OtherMediaServerHeaders
            Write-Entry -Subtext "$Type successfully restored for $ItemId..." -Path $global:configLogging -Color Green -log Info
            return $true
        } catch {
            Write-Entry -Subtext "Failed to restore $Type for $ItemId. Error: $_" -Path $global:configLogging -Color Red -log Error
            return $false
        }
    }
    return $false
}