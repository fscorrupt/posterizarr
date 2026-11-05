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
    $attempt = 0
    while ($true) {
        try {
            return Invoke-RestMethod -Uri $uri -Headers $requestHeaders -Method Get -MaximumRedirection 0 -TimeoutSec 45 -ErrorAction Stop
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            # Reads are idempotent, so rate-limited requests can be retried safely
            if ($status -eq 429 -and $attempt -lt 5) {
                $attempt++
                $retryAfter = $_.Exception.Response.Headers.RetryAfter.Delta.TotalSeconds
                $delay = if ($retryAfter -gt 0) { [Math]::Min([int][Math]::Ceiling($retryAfter), 60) } else { 2 * $attempt }
                Write-Entry -Subtext "Silo rate limit hit at $Path. Retrying in ${delay}s... (Attempt $attempt/5)" -Path $global:configLogging -Color Yellow -log Warning
                Start-Sleep -Seconds $delay
                continue
            }
            throw "Silo API read failed at $Path ($($_.Exception.Response.StatusCode)); verify access and server availability."
        }
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
    $resolved = if ($Reference.StartsWith('/api/v2/')) { [uri]($OtherMediaServerUrl.TrimEnd('/') + $Reference) } else { [uri]::new($base, $Reference) }
    if ($resolved.Authority -ne $base.Authority -or $resolved.Scheme -ne $base.Scheme -or $resolved.UserInfo) {
        Write-Entry -Subtext "Ignoring Silo artwork reference that is not served by the configured server (host: $($resolved.Authority))." -Path $global:configLogging -Color Yellow -log Warning
        return $null
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
                ImageTags = @{ Primary = (Resolve-SiloArtworkUrl $detail.poster_url); Logo = (Resolve-SiloArtworkUrl $detail.logo_url) }
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

function Get-SiloArrEntries {
    param([hashtable]$Trigger)
    $isShow = $Trigger['arr_platform'] -eq 'Sonarr'
    if ($Trigger['arr_platform'] -notin @('Sonarr', 'Radarr')) { throw 'Unsupported Silo Arr platform.' }
    $title = if ($isShow) { $Trigger['arr_series_title'] } else { $Trigger['arr_movie_title'] }
    $year = if ($isShow) { $Trigger['arr_sonarr_series_year'] } else { $Trigger['arr_movie_year'] }
    $arrPath = if ($isShow) { $Trigger['arr_series_path'] } else { $Trigger['arr_movie_path'] }
    $nativeType = if ($isShow) { 'Series' } else { 'Movie' }
    $items = @($global:SiloItems.Values | Where-Object {
        $_.Type -eq $nativeType -and $_.Name -eq $title -and $_.SiloLibraryName -notin $LibstoExclude -and
        ((-not $year) -or $_.ProductionYear -eq $year)
    })
    if ($arrPath) {
        $folder = (($arrPath -replace '\\', '/').TrimEnd('/') -split '/')[-1]
        $pathMatches = @($items | Where-Object {
            $itemPath = ($_.Path -replace '\\', '/').TrimEnd('/')
            $itemFolder = if ($isShow) { ($itemPath -split '/')[-1] } else { (($itemPath -replace '/[^/]+$', '') -split '/')[-1] }
            $itemFolder -eq $folder
        })
        if ($pathMatches.Count) { $items = $pathMatches }
    }
    if (-not $items.Count) { throw "Silo Arr item '$title' was not found in included libraries." }
    if (@($items.Id | Select-Object -Unique).Count -gt 1) { throw "Silo Arr item '$title' is ambiguous; check title, year and media paths." }
    foreach ($item in $items) {
        $path = ($item.Path -replace '\\', '/').TrimEnd('/')
        $root = if ($isShow) { ($path -split '/')[-1] } else { (($path -replace '/[^/]+$', '') -split '/')[-1] }
        $seasons = @($global:SiloSeasons.GetEnumerator() | Where-Object { $_.Key.StartsWith("$($item.Id):") } | ForEach-Object Value | Sort-Object season_number)
        if ($isShow -and $null -ne $Trigger['arr_episode_season']) {
            $seasons = @($seasons | Where-Object { $_.season_number -eq $Trigger['arr_episode_season'] })
        }
        [pscustomobject]@{
            'Library Name' = $item.SiloLibraryName; 'Library Type' = $item.Type; 'Library Language' = 'en'
            Id = $item.Id; title = $item.Name; originalTitle = $item.OriginalTitle; year = $item.ProductionYear
            imdbid = $item.ProviderIds.Imdb; tmdbid = $item.ProviderIds.Tmdb; tvdbid = $item.ProviderIds.Tvdb
            Path = $item.SiloLibraryRoot; RootFoldername = $root; extraFolder = $null; Labels = ''
            OtherMediaServerPosterUrl = $item.ImageTags.Primary
            OtherMediaServerBackgroundUrl = ($item.BackdropImageTags -join ',')
            SeasonRatingKeys = ($seasons.content_id -join ','); seasonNumbers = ($seasons.season_number -join ',')
            OtherMediaServerSeasonUrls = (($seasons | ForEach-Object { Resolve-SiloArtworkUrl $_.poster_url }) -join ',')
        }
    }
}

function Get-SiloArtworkEntries {
    foreach ($item in $global:SiloItems.Values) {
        if ($item.Type -notin @('Movie', 'Series') -or $item.SiloLibraryName -in $LibstoExclude) { continue }
        $selectedLibrary = if ($RestoreLibrary) { $RestoreLibrary } else { $LibraryName }
        if ($selectedLibrary -and $selectedLibrary -ne 'all' -and $item.SiloLibraryName -ne $selectedLibrary) { continue }
        $path = ($item.Path -replace '\\', '/').TrimEnd('/')
        $folder = if ($item.Type -eq 'Series') { ($path -split '/')[-1] } else { (($path -replace '/[^/]+$', '') -split '/')[-1] }
        if (-not $folder -or $folder -in @('.', '..') -or $item.SiloLibraryName -match '[/\\:]') { throw 'Invalid Silo artwork backup folder.' }
        if ($RestoreItem -and $RestoreItem -notin @($item.Name, $item.OriginalTitle, $folder)) { continue }
        $directory = if ($LibraryFolders -eq 'true') { Join-Path (Join-Path $BackupPath $item.SiloLibraryName) $folder } else { $BackupPath }
        $backupRoot = [IO.Path]::GetFullPath($BackupPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $resolvedDirectory = [IO.Path]::GetFullPath($directory)
        if ($resolvedDirectory -ne $backupRoot -and -not $resolvedDirectory.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Silo artwork backup path is outside the configured backup folder.'
        }
        $slots = @(
            @{ Type = 'poster'; ImageType = 'Primary'; Name = 'poster.jpg'; FlatName = "$folder.jpg"; Url = $item.ImageTags.Primary },
            @{ Type = 'background'; ImageType = 'Backdrop'; Name = 'background.jpg'; FlatName = "$($folder)_background.jpg"; Url = @($item.BackdropImageTags)[0] },
            @{ Type = 'logo'; ImageType = 'Logo'; Name = 'logo.png'; FlatName = "$($folder)_logo.png"; Url = $item.ImageTags.Logo }
        )
        foreach ($slot in $slots) {
            [pscustomobject]@{ Id = $item.Id; MediaType = $item.Type; Type = $slot.Type; ImageType = $slot.ImageType
                Url = $slot.Url; Path = (Join-Path $directory $(if ($LibraryFolders -eq 'true') { $slot.Name } else { $slot.FlatName })) }
        }
        if ($item.Type -eq 'Series') {
            foreach ($season in ($global:SiloSeasons.GetEnumerator() | Where-Object { $_.Key.StartsWith("$($item.Id):") } | ForEach-Object Value)) {
                $number = '{0:D2}' -f [int]$season.season_number
                $filename = if ($LibraryFolders -eq 'true') { "Season$number.jpg" } else { "$($folder)_season$number.jpg" }
                [pscustomobject]@{ Id = $season.content_id; MediaType = 'Season'; Type = 'season'; ImageType = 'Primary'
                    Url = (Resolve-SiloArtworkUrl $season.poster_url); Path = (Join-Path $directory $filename) }
            }
        }
    }
    foreach ($collection in (Get-SiloCollection -Path '/admin/collections' -Query @{ limit = 200 })) {
        $libraryIds = @($collection.library_id) + @($collection.library_ids)
        $libraries = @($global:SiloLibraries | Where-Object { $_.ItemId -in $libraryIds -and $_.Name -notin $LibstoExclude })
        foreach ($library in $libraries) {
            $selectedLibrary = if ($RestoreLibrary) { $RestoreLibrary } else { $LibraryName }
            if ($selectedLibrary -and $selectedLibrary -ne 'all' -and $selectedLibrary -ne $library.Name) { continue }
            $folder = ([string]$collection.title -replace '[\\/:*?"<>|]', '_').Trim()
            if (-not $folder -or $folder -in @('.', '..') -or $library.Name -in @('.', '..') -or $library.Name -match '[/\\:]') { throw 'Invalid Silo collection backup folder.' }
            if ($RestoreItem -and $RestoreItem -notin @($collection.title, $folder)) { continue }
            $directory = if ($LibraryFolders -eq 'true') { Join-Path (Join-Path (Join-Path $BackupPath $library.Name) 'Collections') $folder } else { Join-Path $BackupPath 'Collections' }
            foreach ($slot in @(@{ Type = 'poster'; ImageType = 'Primary'; Name = 'poster.jpg'; FlatName = "$folder.jpg"; Url = $collection.poster_url },
                                 @{ Type = 'background'; ImageType = 'Backdrop'; Name = 'background.jpg'; FlatName = "$($folder)_background.jpg"; Url = $collection.backdrop_url })) {
                [pscustomobject]@{ Id = $collection.id; MediaType = 'Collection'; Type = $slot.Type; ImageType = $slot.ImageType
                    Url = (Resolve-SiloArtworkUrl $slot.Url); Path = (Join-Path $directory $(if ($LibraryFolders -eq 'true') { $slot.Name } else { $slot.FlatName })) }
            }
        }
    }
}

function Invoke-SiloArtworkBackup {
    $global:Mode = 'backup'
    foreach ($entry in Get-SiloArtworkEntries) {
        if (-not $entry.Url -or (Test-Path -LiteralPath $entry.Path)) { continue }
        $safeUrl = Resolve-SiloArtworkUrl $entry.Url
        if (-not $safeUrl) { continue }
        $parent = Split-Path $entry.Path -Parent
        [void](New-Item -ItemType Directory -Path $parent -Force)
        $temporary = "$($entry.Path).$([guid]::NewGuid().ToString('N')).tmp"
        try {
            Invoke-WebRequest -Uri $safeUrl -OutFile $temporary -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop
            Move-Item -LiteralPath $temporary -Destination $entry.Path -ErrorAction Stop
            $global:posterCount = Increment-GlobalStat 'posterCount'
        } finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        }
    }
}

function Invoke-SiloArtworkRestore {
    $global:Mode = 'restore'
    foreach ($entry in Get-SiloArtworkEntries) {
        if ($RestoreType -and $RestoreType -ne $entry.Type) { continue }
        if (Test-Path -LiteralPath $entry.Path -PathType Leaf) {
            if ($entry.MediaType -eq 'Collection') {
                $slot = if ($entry.ImageType -eq 'Backdrop') { 'backdrop' } else { 'poster' }
                Send-SiloCollectionArtwork -CollectionId $entry.Id -ImagePath $entry.Path -Type $slot
            } else {
                Send-SiloArtwork -ItemId $entry.Id -ImageType $entry.ImageType -ImagePath $entry.Path
            }
        }
    }
}

function Reset-SiloArtwork {
    param([string]$ItemId, [ValidateSet('poster', 'backdrop', 'logo')][string]$Type = 'poster')
    $item = $global:SiloItems.Values | Where-Object Id -eq $ItemId | Select-Object -First 1
    $knownSeason = $global:SiloSeasons.Values | Where-Object { [string]$_.content_id -eq $ItemId } | Select-Object -First 1
    if ($item.Type -notin @('Movie', 'Series') -and -not $knownSeason) { throw 'Silo reset requires a known movie, show or season; episodes are excluded.' }
    $encodedId = [uri]::EscapeDataString($ItemId)
    $candidates = @(Get-SiloCollection -Path "/admin/items/$encodedId/images" -Query @{ limit = 200 })
    $candidate = $candidates | Where-Object {
        $_.type -eq $Type -and $_.original_url -and $_.original_url -notmatch '^(upload|file)://' -and $_.provider_id
    } | Select-Object -First 1
    if (-not $candidate) { throw "Silo has no provider $Type candidate for $ItemId; current artwork was not changed." }
    $body = @{ type = $Type; original_url = $candidate.original_url; provider_id = $candidate.provider_id } | ConvertTo-Json -Compress
    $null = Invoke-RestMethod -Uri "$($OtherMediaServerUrl.TrimEnd('/'))/api/v2/admin/items/$encodedId/images/apply" -Method Post `
        -Headers @{ Authorization = "Bearer $OtherMediaServerApiKey" } -ContentType 'application/json' -Body $body `
        -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop
}

function Invoke-SiloPlexMirror {
    if ($UseSilo -ne 'true' -or -not $PlexUrl -or -not $PlexToken) { throw 'Plex-to-Silo sync requires Silo enabled and Plex URL/token configured.' }
    $global:Mode = 'syncsilo'
    $sourceItems = [System.Collections.Generic.List[object]]::new()
    [xml]$sourceLibraries = CheckPlexAccess -PlexUrl $PlexUrl
    foreach ($library in $sourceLibraries.MediaContainer.Directory) {
        if ($library.title -in $config.PlexPart.LibstoExclude -or $library.type -notin @('movie', 'show')) { continue }
        $start = 0
        do {
            [xml]$page = (Invoke-PlexWebRequest -Uri "$PlexUrl/library/sections/$($library.key)/all?includeGuids=1&X-Plex-Container-Start=$start&X-Plex-Container-Size=1000" -Headers @{ 'X-Plex-Token' = $PlexToken }).Content
            $nodes = @($page.MediaContainer.ChildNodes | Where-Object { $_.type -in @('movie', 'show') })
            foreach ($node in $nodes) { $sourceItems.Add($node) }
            $start += $nodes.Count
        } while ($nodes.Count -gt 0 -and $start -lt [int]$page.MediaContainer.totalSize)
    }
    foreach ($item in $global:SiloItems.Values) {
        if ($item.Type -notin @('Movie', 'Series') -or $item.SiloLibraryName -in $LibstoExclude) { continue }
        $identifiers = @(
            if ($item.ProviderIds.Imdb) { "imdb://$($item.ProviderIds.Imdb)" }
            if ($item.ProviderIds.Tmdb) { "tmdb://$($item.ProviderIds.Tmdb)" }
            if ($item.ProviderIds.Tvdb) { "tvdb://$($item.ProviderIds.Tvdb)" }
        )
        if (-not $identifiers.Count) { continue }
        $nativeType = if ($item.Type -eq 'Series') { 'show' } else { 'movie' }
        $matches = @($sourceItems | Where-Object {
            $_.type -eq $nativeType -and @($_.Guid | Where-Object { $_.id -in $identifiers }).Count -gt 0
        })
        if ($matches.Count -ne 1) {
            Write-Entry -Message "Silo mirror skipped '$($item.Name)': no unique Plex external-ID match." -Path $global:configLogging -Color Yellow -log Warning
            continue
        }
        $source = $matches[0]
        $targets = [System.Collections.Generic.List[object]]::new()
        $targets.Add(@{ Id = $item.Id; Source = $source; Current = @{ Primary = $item.ImageTags.Primary; Backdrop = @($item.BackdropImageTags)[0]; Logo = $item.ImageTags.Logo } })
        if ($item.Type -eq 'Series') {
            [xml]$children = (Invoke-PlexWebRequest -Uri "$PlexUrl/library/metadata/$($source.ratingKey)/children" -Headers @{ 'X-Plex-Token' = $PlexToken }).Content
            foreach ($season in $children.MediaContainer.Directory) {
                $nativeSeason = $global:SiloSeasons["$($item.Id):$($season.index)"]
                if ($nativeSeason) {
                    $targets.Add(@{ Id = $nativeSeason.content_id; Source = $season; Current = @{ Primary = (Resolve-SiloArtworkUrl $nativeSeason.poster_url); Backdrop = (Resolve-SiloArtworkUrl $nativeSeason.backdrop_url) } })
                }
            }
        }
        foreach ($target in $targets) {
            foreach ($slot in @(@{ Type = 'Primary'; Field = 'thumb' }, @{ Type = 'Backdrop'; Field = 'art' }, @{ Type = 'Logo'; Field = 'clearLogo' })) {
                if ($slot.Type -eq 'Logo' -and $target.Source.type -eq 'season') { continue }
                $sourcePath = [string]$target.Source.($slot.Field)
                if (-not $sourcePath.StartsWith('/') -or $sourcePath.Contains('..') -or $sourcePath.StartsWith('//')) { continue }
                $response = Invoke-WebRequest -Uri "$($PlexUrl.TrimEnd('/'))$sourcePath" -Headers @{ 'X-Plex-Token' = $PlexToken } -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop
                $content = [byte[]]$response.Content
                if ($target.Current[$slot.Type]) {
                    $currentUrl = Resolve-SiloArtworkUrl $target.Current[$slot.Type]
                    if ($currentUrl) {
                        $current = Invoke-WebRequest -Uri $currentUrl -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop
                        if ([Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData([byte[]]$current.Content)) -eq [Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData($content))) { continue }
                    }
                }
                $temporary = Join-Path ([IO.Path]::GetTempPath()) "silo-mirror-$([guid]::NewGuid().ToString('N')).jpg"
                try {
                    [IO.File]::WriteAllBytes($temporary, $content)
                    Send-SiloArtwork -ItemId $target.Id -ImageType $slot.Type -ImagePath $temporary
                } finally {
                    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
                }
            }
        }
    }
    Complete-SiloRun
}

function Complete-SiloRun {
    Sync-GlobalStats
    if ($CurrentlyRunning -and (Test-Path -LiteralPath $CurrentlyRunning)) {
        Remove-Item -LiteralPath $CurrentlyRunning -ErrorAction Stop
    }
}

function Send-SiloArtwork {
    param([string]$ItemId, [string]$ImageType, [string]$ImagePath)
    $item = $global:SiloItems.Values | Where-Object Id -eq $ItemId | Select-Object -First 1
    if ($item.Type -eq 'Episode' -or $ItemId -match '^episode[-:]') {
        Write-Entry -Message 'Silo episode artwork uploads are unsupported; keeping the local titlecard only.' -Path $global:configLogging -Color Yellow -log Warning
        return
    }
    $knownSeason = $global:SiloSeasons.Values | Where-Object { [string]$_.content_id -eq $ItemId } | Select-Object -First 1
    if ($item.Type -notin @('Movie', 'Series') -and -not $knownSeason) { throw 'Silo artwork target is not a known movie, show or season.' }
    if ($knownSeason -and $ImageType -notin @('Primary', 'Backdrop')) { throw 'Silo seasons support poster and backdrop only.' }
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

function Send-SiloCollectionArtwork {
    param([string]$CollectionId, [string]$ImagePath, [ValidateSet('poster', 'backdrop')][string]$Type = 'poster')
    $image = Get-Item -LiteralPath $ImagePath -ErrorAction Stop
    if ($image.Length -le 0 -or $image.Length -gt 10MB) { throw 'Silo collection artwork must contain between 1 byte and 10 MiB.' }
    $encodedId = [uri]::EscapeDataString($CollectionId)
    $null = Invoke-RestMethod -Uri "$($OtherMediaServerUrl.TrimEnd('/'))/api/v2/admin/collections/$encodedId/$Type" -Method Put `
        -Headers @{ Authorization = "Bearer $OtherMediaServerApiKey" } -Form @{ image = $image } `
        -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop
    $global:UploadCount = Increment-GlobalStat 'UploadCount'
}