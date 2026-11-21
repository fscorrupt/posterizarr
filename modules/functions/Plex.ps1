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

function Resolve-PlexItemByFolder {
    <#
    .SYNOPSIS
        Finds the Plex movie/show in a library whose on-disk folder name equals FolderName. Returns the item node or $null.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$LibraryName,
        [Parameter(Mandatory = $true)][string]$FolderName
    )

    $leaf = { param($p) (($p -replace '\\', '/').TrimEnd('/') -split '/')[-1] }

    [xml]$sectionsXml = (Invoke-PlexWebRequest -Uri "$PlexUrl/library/sections" -Headers $extraPlexHeaders).content
    $section = $sectionsXml.MediaContainer.Directory | Where-Object { $_.title -eq $LibraryName } | Select-Object -First 1
    if (-not $section) {
        Write-Entry -Subtext "Plex library '$LibraryName' not found." -Path $global:configLogging -Color Yellow -log Warning
        return $null
    }

    $reqHeaders = if ($extraPlexHeaders) { $extraPlexHeaders.Clone() } else { @{} }
    $reqHeaders['X-Plex-Container-Size'] = '2000'
    $start = 0
    $sectionItems = [System.Collections.Generic.List[object]]::new()
    do {
        $reqHeaders['X-Plex-Container-Start'] = [string]$start
        [xml]$sectionXml = (Invoke-PlexWebRequest -Uri "$PlexUrl/library/sections/$($section.key)/all?includeGuids=1" -Headers $reqHeaders).content
        $page = if ($section.type -eq 'movie') { @($sectionXml.MediaContainer.Video) } else { @($sectionXml.MediaContainer.Directory) }
        $page | Where-Object { $_ } | ForEach-Object { $sectionItems.Add($_) }
        $start += 2000
    } while ($page.Count -gt 0 -and $start -lt [int]$sectionXml.MediaContainer.totalSize)

    if ($section.type -eq 'movie') {
        $hits = @($sectionItems | Where-Object {
                @($_.Media.Part.file) | Where-Object { $_ -and (& $leaf (($_ -replace '\\', '/') -replace '/[^/]*$', '')) -eq $FolderName }
            })
    }
    else {
        # Section listings omit Location for shows, so narrow candidates by external ID, title, year or search, then verify via item metadata
        $shows = @($sectionItems)
        $verify = {
            param($items)
            @($items | Sort-Object ratingKey -Unique | Where-Object {
                    [xml]$meta = (Invoke-PlexWebRequest -Uri "$PlexUrl/library/metadata/$($_.ratingKey)" -Headers $extraPlexHeaders).content
                    @($meta.MediaContainer.Directory.Location.path) | Where-Object { $_ -and (& $leaf $_) -eq $FolderName }
                })
        }
        $normalize = { param($s) ($s -replace '[^\p{L}\p{N}]', '').ToLowerInvariant() }
        $folderYear = if ($FolderName -match '\((\d{4})\)') { $Matches[1] } else { $null }
        $folderTitle = (($FolderName -replace '\s*\(\d{4}\).*$', '') -replace '\s*[\{\[][^\}\]]*[\}\]]', '').Trim()
        $folderBase = & $normalize $folderTitle

        $hits = @()
        $guids = [regex]::Matches($FolderName, '[\{\[](tvdb|tmdb|imdb)(?:id)?-(tt\d+|\d+)[\}\]]', 'IgnoreCase') | ForEach-Object { "$($_.Groups[1].Value.ToLower())://$($_.Groups[2].Value)" }
        if ($guids) {
            $hits = & $verify ($shows | Where-Object { $ids = @($_.Guid.id); $guids | Where-Object { $ids -contains $_ } })
        }
        if (-not $hits) {
            $hits = & $verify ($shows | Where-Object {
                    $t = & $normalize $_.title
                    $o = & $normalize $_.originalTitle
                    ($t -and $t -eq $folderBase) -or ($o -and $o -eq $folderBase) -or
                    ($t.Length -ge 3 -and ($folderBase.StartsWith($t) -or $t.StartsWith($folderBase)) -and (-not $folderYear -or $_.year -eq $folderYear))
                })
        }
        if (-not $hits -and $folderYear) {
            $byYear = @($shows | Where-Object { $_.year -eq $folderYear })
            if ($byYear.Count -le 50) { $hits = & $verify $byYear }
        }
        if (-not $hits -and $folderTitle) {
            [xml]$searchXml = (Invoke-PlexWebRequest -Uri "$PlexUrl/search?query=$([uri]::EscapeDataString($folderTitle))" -Headers $extraPlexHeaders).content
            $hits = & $verify ($searchXml.MediaContainer.Directory | Where-Object { $_.type -eq 'show' -and $_.librarySectionTitle -eq $LibraryName })
        }
    }

    $hits = @($hits)
    if ($hits.Count -eq 1) {
        Write-Entry -Subtext "Plex item resolved by folder path: $($hits[0].title) (RatingKey: $($hits[0].ratingKey))" -Path $global:configLogging -Color Cyan -log Debug
        return $hits[0]
    }
    Write-Entry -Subtext "Plex folder path match returned $($hits.Count) items for '$FolderName'." -Path $global:configLogging -Color Yellow -log Info
    return $null
}

function Get-PlexSectionSeasonsBulk {
    <#
    .SYNOPSIS
        Fetches all seasons for a given TV show library in bulk and groups them by parent show ratingKey.
    .DESCRIPTION
        Calls GET /library/sections/{SectionId}/all?type=3 with pagination.
        Returns a hashtable @{ [string]$parentRatingKey = [System.Collections.Generic.List[object]]::new() }.
    #>
    param (
        [Parameter(Mandatory = $true)]
        [string]$PlexUrl,
        [Parameter(Mandatory = $true)]
        [string]$SectionId,
        [hashtable]$Headers = $null
    )

    $seasonsByShow = @{}
    $searchsize = 0
    $totalContentSize = 1
    $pageSize = 2000
    $reqHeaders = if ($Headers) { $Headers.Clone() } else { @{} }

    try {
        do {
            $reqHeaders['X-Plex-Container-Start'] = $searchsize
            $reqHeaders['X-Plex-Container-Size'] = [string]$pageSize

            $uri = "$PlexUrl/library/sections/$SectionId/all?type=3"
            $resp = Invoke-PlexWebRequest -Uri $uri -Headers $reqHeaders -MaxRetries 3 -RetryDelaySeconds 2
            [xml]$xml = $resp.Content

            if ($totalContentSize -eq 1 -and $xml.MediaContainer.totalSize) {
                $totalContentSize = [int]$xml.MediaContainer.totalSize
            }

            if ($xml.MediaContainer.Directory) {
                foreach ($sNode in $xml.MediaContainer.Directory) {
                    $pKey = [string]$sNode.parentRatingKey
                    if (-not [string]::IsNullOrEmpty($pKey)) {
                        if (-not $seasonsByShow.ContainsKey($pKey)) {
                            $seasonsByShow[$pKey] = [System.Collections.Generic.List[object]]::new()
                        }
                        $seasonsByShow[$pKey].Add($sNode)
                    }
                }
            }

            $batchCount = if ($xml.MediaContainer.size) { [int]$xml.MediaContainer.size } else { 0 }
            if ($batchCount -le 0) { break }
            $searchsize += $batchCount
        } until ($searchsize -ge $totalContentSize)
    }
    catch {
        $exMsg = $_.Exception.Message
        if ($_.Exception.InnerException) { $exMsg += " (Inner: $($_.Exception.InnerException.Message))" }
        Write-Entry -Subtext "Failed to fetch bulk seasons for Library ID $SectionId : $exMsg" -Path $global:configLogging -Color Yellow -log Warning
    }

    return $seasonsByShow
}

function Get-PlexSectionEpisodesBulk {
    <#
    .SYNOPSIS
        Fetches all episodes for a given TV show library in bulk and groups them by season ratingKey (parentRatingKey).
    .DESCRIPTION
        Calls GET /library/sections/{SectionId}/all?type=4 with pagination.
        Returns a hashtable @{ [string]$seasonRatingKey = [System.Collections.Generic.List[object]]::new() }.
    #>
    param (
        [Parameter(Mandatory = $true)]
        [string]$PlexUrl,
        [Parameter(Mandatory = $true)]
        [string]$SectionId,
        [hashtable]$Headers = $null
    )

    $episodesBySeason = @{}
    $searchsize = 0
    $totalContentSize = 1
    $pageSize = 2000
    $reqHeaders = if ($Headers) { $Headers.Clone() } else { @{} }

    try {
        do {
            $reqHeaders['X-Plex-Container-Start'] = $searchsize
            $reqHeaders['X-Plex-Container-Size'] = [string]$pageSize

            $uri = "$PlexUrl/library/sections/$SectionId/all?type=4"
            $resp = Invoke-PlexWebRequest -Uri $uri -Headers $reqHeaders -MaxRetries 3 -RetryDelaySeconds 2
            [xml]$xml = $resp.Content

            if ($totalContentSize -eq 1 -and $xml.MediaContainer.totalSize) {
                $totalContentSize = [int]$xml.MediaContainer.totalSize
            }

            if ($xml.MediaContainer.Video) {
                foreach ($epNode in $xml.MediaContainer.Video) {
                    $sKey = [string]$epNode.parentRatingKey
                    if (-not [string]::IsNullOrEmpty($sKey)) {
                        if (-not $episodesBySeason.ContainsKey($sKey)) {
                            $episodesBySeason[$sKey] = [System.Collections.Generic.List[object]]::new()
                        }
                        $episodesBySeason[$sKey].Add($epNode)
                    }
                }
            }

            $batchCount = if ($xml.MediaContainer.size) { [int]$xml.MediaContainer.size } else { 0 }
            if ($batchCount -le 0) { break }
            $searchsize += $batchCount
        } until ($searchsize -ge $totalContentSize)
    }
    catch {
        $exMsg = $_.Exception.Message
        if ($_.Exception.InnerException) { $exMsg += " (Inner: $($_.Exception.InnerException.Message))" }
        Write-Entry -Subtext "Failed to fetch bulk episodes for Library ID $SectionId : $exMsg" -Path $global:configLogging -Color Yellow -log Warning
    }

    return $episodesBySeason
}