function Invoke-PlexWebRequest {
    <#
    .SYNOPSIS
        Executes a web request to Plex with built-in retry logic, timeout, and rich error reporting for PowerShell 7+.
    .DESCRIPTION
        Retries on transient network errors (such as SSL drops, connection resets, timeouts, 5xx/429) with exponential backoff.
        Extracts inner exception messages to provide clear diagnostics. Automatically bypasses certificate validation issues in PS 7.
        Does not retry permanent client errors (400, 401, 403, 404).
    #>
    param (
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [hashtable]$Headers = $null,
        [int]$MaxRetries = 3,
        [int]$RetryDelaySeconds = 2,
        [string]$Method = 'GET',
        [int]$TimeoutSec = 45,
        [string]$OutFile = $null,
        [bool]$SkipCertificateCheck = $true
    )

    $attempt = 0
    while ($attempt -le $MaxRetries) {
        try {
            $splat = @{
                Uri                  = $Uri
                Method               = $Method
                TimeoutSec           = $TimeoutSec
                ErrorAction          = 'Stop'
                SkipCertificateCheck = $SkipCertificateCheck
            }
            if ($Headers) { $splat['Headers'] = $Headers }
            if ($OutFile) { $splat['OutFile'] = $OutFile }

            return (Invoke-WebRequest @splat)
        }
        catch {
            $attempt++
            $exMsg = $_.Exception.Message
            $innerMsg = if ($_.Exception.InnerException) { " (Inner: $($_.Exception.InnerException.Message))" } else { "" }
            $fullErr = "$exMsg$innerMsg"

            # Do not retry permanent HTTP client errors (400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found)
            $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            if ($statusCode -in @(400, 401, 403, 404) -or $attempt -gt $MaxRetries) {
                throw [System.InvalidOperationException]::new($fullErr, $_.Exception)
            }

            $redacted = if (Get-Command 'RedactMediaServerUrl' -ErrorAction SilentlyContinue) {
                RedactMediaServerUrl -url $Uri
            } else {
                $Uri
            }
            $delay = $RetryDelaySeconds * $attempt
            Write-Entry -Subtext "Plex request failed: $fullErr. Retrying in ${delay}s... (Attempt $attempt/$MaxRetries) | Uri: $redacted" -Path $global:configLogging -Color Yellow -log Warning
            Start-Sleep -Seconds $delay
        }
    }
}

function CheckPlexAccess {
    param (
        [string]$PlexUrl
    )
    Write-Entry -Message "Checking Plex access now..." -Path $global:configLogging -Color White -log Info
    try {
        $result = Invoke-PlexWebRequest -Uri "$PlexUrl/library/sections" -Headers $extraPlexHeaders -MaxRetries 3 -RetryDelaySeconds 3
        if ($result.StatusCode -eq 200) {
            Write-Entry -Subtext "Plex access is working..." -Path $global:configLogging -Color Green -log Info
            # Check if libs are available
            [XML]$Libs = $result.Content
            # Plex Debug info
            $plexdebuginfo = Invoke-PlexWebRequest -Uri "$PlexUrl" -Headers $extraPlexHeaders -MaxRetries 2
            [XML]$plexdebuginfo = $plexdebuginfo.Content
            Write-Entry -Subtext "Plex Server Version: $($plexdebuginfo.MediaContainer.version)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "My Plex Server: $($plexdebuginfo.MediaContainer.myPlex)"-Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "Plex Server Signin State: $($plexdebuginfo.MediaContainer.myPlexSigninState)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "Plex Server allow Deletion: $($plexdebuginfo.MediaContainer.allowMediaDeletion)" -Path $global:configLogging -Color Cyan -log Debug
            if ($Libs.MediaContainer.size -ge 1) {
                Write-Entry -Subtext "Found libs on Plex..." -Path $global:configLogging -Color White -log Info
                return $Libs
            }
            else {
                Write-Entry -Subtext "No libs on Plex, abort script now..." -Path $global:configLogging -Color Red -log Error
                HandleScriptExit -Message "No libs on plex"
            }
        }
    }
    catch {
        $exMsg = $_.Exception.Message
        if ($_.Exception.InnerException) {
            $exMsg += " (Inner: $($_.Exception.InnerException.Message))"
        }
        Write-Entry -Subtext "Error occurred while accessing Plex server: $exMsg" -Path $global:configLogging -Color Red -log Error
        Write-Entry -Subtext "Please check access and settings in Plex..." -Path $global:configLogging -Color Yellow -log Warning
        Write-Entry -Message "To be able to connect to Plex without authentication" -Path $global:configLogging -Color White -log Info
        Write-Entry -Message "You have to enter your IP range in 'Settings -> Network -> List of IP addresses and networks that are allowed without auth: '192.168.1.0/255.255.255.0''" -Path $global:configLogging -Color White -log Info
        # Clear Running File
        HandleScriptExit -Message "Could not access plex"
    }
}
function GetPlexArtworkUrl {
    param(
        [string]$ArtUrl,
        [string]$TempImage
    )

    Write-Entry -Subtext "Fast-scanning Plex URL for EXIF data..." -Path $global:configLogging -Color Cyan -log Info

    $ExifFound = $false

    try {
        # Perform a partial download (64KB) to check for EXIF markers in memory
        $client = New-Object System.Net.Http.HttpClient
        $client.DefaultRequestHeaders.Range = New-Object System.Net.Http.Headers.RangeHeaderValue(0, 65536)

        # Add Plex Headers
        foreach ($key in $extraPlexHeaders.Keys) {
            $client.DefaultRequestHeaders.TryAddWithoutValidation($key, $extraPlexHeaders[$key])
        }

        $task = $client.GetByteArrayAsync($ArtUrl)
        $buffer = $task.GetAwaiter().GetResult()
        $client.Dispose()

        $content = [System.Text.Encoding]::UTF8.GetString($buffer)

        if ($content -match 'overlay|titlecard|created with ppm|created with posterizarr') {
            $ExifFound = $true
        }
    }
    catch {
        Write-Entry -Subtext "Fast-scan failed, falling back to full download. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning

        try {
            Invoke-WebRequest -Uri $ArtUrl -OutFile $TempImage -Headers $requestHeaders
            $magickcommand = "& `"$magick`" identify -verbose `"$TempImage`""
            if (Invoke-Expression $magickcommand | Select-String -Pattern 'overlay|titlecard|created with ppm|created with posterizarr') {
                $ExifFound = $true
            }
        }
        catch {
            Write-Entry -Subtext "Could not download Artwork from plex: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; return
        }
    }

    if ($ExifFound) {
        Write-Entry -Subtext "Artwork has exif data from posterizarr/kometa/tcm, using URL..." -Path $global:configLogging -Color Green -log Info
        $global:posterurl = $ArtUrl
    }
    else {
        Write-Entry -Subtext "No posterizarr/kometa/tcm exif data found, using URL..." -Path $global:configLogging -Color Yellow -log Warning
        $global:posterurl = $ArtUrl
    }
}