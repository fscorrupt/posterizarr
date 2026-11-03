function Invoke-SiloApi {
    param([string]$Path, [hashtable]$Query = @{}, [switch]$Profile)
    $uri = "$($OtherMediaServerUrl.TrimEnd('/'))/api/v2$Path"
    if ($Query.Count) {
        $pairs = foreach ($key in $Query.Keys) {
            "{0}={1}" -f [uri]::EscapeDataString($key), [uri]::EscapeDataString([string]$Query[$key])
        }
        $uri += '?' + ($pairs -join '&')
    }
    $requestHeaders = @{ Authorization = "Bearer $OtherMediaServerApiKey" }
    if ($Profile) { $requestHeaders['X-Profile-Id'] = $global:SiloProfileId }
    try {
        Invoke-RestMethod -Uri $uri -Headers $requestHeaders -Method Get -MaximumRedirection 0 -TimeoutSec 45 -ErrorAction Stop
    } catch {
        throw "Silo API read failed at $Path ($($_.Exception.Response.StatusCode)); verify access and server availability."
    }
}

function Get-SiloCollection {
    param([string]$Path, [hashtable]$Query = @{}, [switch]$Profile)
    $result = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new()
    do {
        $page = Invoke-SiloApi -Path $Path -Query $Query -Profile:$Profile
        if ($null -eq $page.items) { throw 'Silo returned an invalid collection.' }
        foreach ($item in $page.items) { $result.Add($item) }
        if (-not $page.page.has_more) { break }
        $cursor = [string]$page.page.next_cursor
        if (-not $cursor -or -not $seen.Add($cursor)) { throw 'Silo returned an invalid continuation cursor.' }
        $Query['cursor'] = $cursor
    } while ($true)
    return $result.ToArray()
}

function Resolve-SiloArtworkUrl {
    param([string]$Reference)
    if (-not $Reference) { return $null }
    $base = [uri]($OtherMediaServerUrl.TrimEnd('/') + '/')
    $resolved = [uri]::new($base, $Reference)
    if ($resolved.Authority -ne $base.Authority -or $resolved.Scheme -ne $base.Scheme -or $resolved.UserInfo) {
        throw 'Silo artwork must be served by the configured server.'
    }
    return $resolved.AbsoluteUri
}

function Initialize-SiloCatalog {
    $info = Invoke-SiloApi -Path '/system/info'
    if ($info.api_major -ne 2) { throw 'Silo API v2 is required.' }
    if (-not $global:SiloProfileId) {
        $profiles = @(Get-SiloCollection -Path '/profiles')
        $primary = @($profiles | Where-Object is_primary)
        if ($primary.Count -eq 1) { $global:SiloProfileId = [string]$primary[0].id }
        elseif ($profiles.Count -eq 1) { $global:SiloProfileId = [string]$profiles[0].id }
        else { throw 'Set SiloProfileId to the primary household profile.' }
    }
    $global:SiloItems = @{}
    $global:SiloSeasons = @{}
    $libraries = [System.Collections.Generic.List[object]]::new()
    foreach ($library in (Get-SiloCollection -Path '/user/libraries')) {
        if ($library.type -notin @('movies', 'series') -or $library.name -in $LibstoExclude) { continue }
        $locations = [System.Collections.Generic.HashSet[string]]::new()
        $rows = @(Get-SiloCollection -Path '/admin/catalog/items' -Query @{ library_id = $library.id; limit = 200 })
        foreach ($row in ($rows | Where-Object type -eq 'series')) {
            $encodedId = [uri]::EscapeDataString([string]$row.content_id)
            foreach ($season in (Get-SiloCollection -Path "/catalog/series/$encodedId/seasons" -Query @{ image_size = 'original' } -Profile)) {
                $global:SiloSeasons["$($row.content_id):$($season.season_number)"] = $season
            }
        }
        foreach ($row in $rows) {
            $encodedId = [uri]::EscapeDataString([string]$row.content_id)
            $detail = Invoke-SiloApi -Path "/catalog/items/$encodedId" -Query @{ image_size = 'original' } -Profile
            $files = if ($row.type -eq 'episode') { @() } else {
                @(Get-SiloCollection -Path "/admin/items/$encodedId/files" -Query @{ limit = 200 } | Where-Object { $_.library_id -eq $library.id })
            }
            $file = $files | Select-Object -Last 1
            $version = $row.versions | Where-Object { $_.library_id -eq $library.id } | Select-Object -First 1
            $path = $file.file_path
            $root = $file.observed_root_path
            if ($row.type -eq 'series') {
                $path = @($detail.folder_paths)[0]
                $root = $path
            }
            $libraryRoot = if ($root) { ($root -replace '\\', '/') -replace '/[^/]+/?$', '' } else { '' }
            if ($libraryRoot -and $row.type -ne 'episode') { [void]$locations.Add($libraryRoot) }
            $season = $global:SiloSeasons["$($row.series_id):$($row.season_number)"]
            $height = if ($version.resolution -match '^(\d+)p$') { [int]$Matches[1] } else { 0 }
            $range = switch ($version.dynamic_range) {
                'dolby_vision' { 'DOVI' }
                'hdr10' { 'HDR10' }
                'hdr10_plus' { 'HDR10' }
                'hlg' { 'HDR' }
                default { 'None' }
            }
            $type = switch ($row.type) { 'movie' { 'Movie' } 'series' { 'Series' } 'episode' { 'Episode' } }
            $item = [pscustomobject]@{
                Id = [string]$row.content_id; Name = $row.title; OriginalTitle = $detail.original_title
                Type = $type; ProductionYear = $row.year; Path = $path; Overview = $detail.overview
                ProviderIds = @{ Imdb = $row.imdb_id; Tmdb = $row.tmdb_id; Tvdb = $row.tvdb_id }
                ImageTags = @{ Primary = (Resolve-SiloArtworkUrl $detail.poster_url) }
                BackdropImageTags = @((Resolve-SiloArtworkUrl $detail.backdrop_url))
                Width = if ($height) { [int]($height * 16 / 9) } else { 0 }; Height = $height
                MediaStreams = @([pscustomobject]@{ Type = 'Video'; VideoRangeType = $range; Width = 0; Height = $height })
                SeriesId = $row.series_id; SeasonId = $season.content_id; SeasonName = "Season $($row.season_number)"
                ParentIndexNumber = $row.season_number; IndexNumber = $row.episode_number
                SeriesPrimaryImageTag = (Resolve-SiloArtworkUrl $season.poster_url)
                SiloLibraryId = [string]$library.id; SiloLibraryName = $library.name; SiloLibraryRoot = $libraryRoot
            }
            $global:SiloItems["$($library.id):$($row.content_id)"] = $item
        }
        $libraries.Add([pscustomobject]@{
            Name = $library.name; ItemId = [string]$library.id
            CollectionType = if ($library.type -eq 'movies') { 'movies' } else { 'tvshows' }
            Locations = @($locations)
        })
    }
    $global:SiloLibraries = $libraries.ToArray()
    Write-Entry -Message "Silo $($info.server_version): $($libraries.Count) test libraries available. Episode artwork uploads are unsupported." -Path $global:configLogging -Color Cyan -log Info
}

function Send-SiloArtwork {
    param([string]$ItemId, [string]$ImageType, [string]$ImagePath)
    $item = $global:SiloItems.Values | Where-Object Id -eq $ItemId | Select-Object -First 1
    if ($item.Type -eq 'Episode' -or $ItemId -like 'episode-*') {
        Write-Entry -Message 'Silo episode artwork uploads are unsupported; keeping the local titlecard only.' -Path $global:configLogging -Color Yellow -log Warning
        return
    }
    $slot = switch ($ImageType) { 'Primary' { 'poster' } 'Backdrop' { 'backdrop' } 'Logo' { 'logo' } default { throw 'Unsupported Silo artwork slot.' } }
    $image = Get-Item -LiteralPath $ImagePath -ErrorAction Stop
    if ($image.Length -le 0 -or $image.Length -gt 10MB) { throw 'Silo artwork must contain between 1 byte and 10 MiB.' }
    $encodedId = [uri]::EscapeDataString($ItemId)
    try {
        $null = Invoke-RestMethod -Uri "$($OtherMediaServerUrl.TrimEnd('/'))/api/v2/admin/items/$encodedId/images/upload" -Method Post `
            -Headers @{ Authorization = "Bearer $OtherMediaServerApiKey" } -Form @{ type = $slot; image = $image } `
            -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop
        $global:UploadCount = Increment-GlobalStat 'UploadCount'
        Write-Entry -Message "Silo $slot uploaded for $ItemId." -Path $global:configLogging -Color Green -log Info
    } catch {
        throw "Silo artwork upload failed ($($_.Exception.Response.StatusCode)); no automatic retry because the write may have succeeded."
    }
}