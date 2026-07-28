#region Arr Mode
    $global:posterCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['posterCount'] = 0 }
    $arrplatform = $arrTriggers['arr_platform']
    $Mode = "arr"
    Write-Entry -Message "ArrTrigger Mode Started..." -Path $global:configLogging -Color White -log Info
    if ($UsePlex -eq 'true') {
        $Upload2Plex = 'true'
        Write-Entry -Subtext "Arr Mode forces direct Plex upload for generated assets." -Path $global:configLogging -Color Cyan -log Info
    }
    switch ($arrplatform) {
        'Sonarr' {
            Write-Entry -Message "Processing Sonarr trigger" -Path $global:configLogging -Color Yellow -log Info
            $seriesTitle = $arrTriggers['arr_series_title']
            $seasonIndex = $arrTriggers['arr_episode_season']
            $episodeIndex = $arrTriggers['arr_episode_numbers']
            $seriesYear = $arrTriggers['arr_sonarr_series_year']
            $ArrPath = $arrTriggers['arr_series_path']
            Write-Entry -Message "Series: '$seriesTitle' ($seriesYear) - Season $seasonIndex, Episode $episodeIndex" -Path $global:configLogging -Color Cyan -log Info

            if ($UseJellyfin -eq 'true' -or $UseEmby -eq 'true') {
                $ServerType = if ($UseJellyfin -eq 'true') { "Jellyfin" } else { "Emby" }
                Write-Entry -Message "Using $ServerType media server" -Path $global:configLogging -Color Green -log Info
                # Search for all matching series
                $seriesSearch = Invoke-RestMethod -Uri "$OtherMediaServerUrl/Items?IncludeItemTypes=Series&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&Recursive=true&SearchTerm=$seriesTitle" -Headers $global:OtherMediaServerHeaders
                $seriesMatches = $seriesSearch.Items | Where-Object { ([string]::IsNullOrWhiteSpace($seriesYear)) -or ($_.ProductionYear -eq $seriesYear) }

                if (-not $seriesMatches) {
                    Write-Entry -Message "Series '$seriesTitle' ($seriesYear) not found in $ServerType" -Path $global:configLogging -Color Red -log Error
                    HandleScriptExit -Message "Series '$seriesTitle' ($seriesYear) not found in $ServerType"
                }

                Write-Entry -Message "Found $($seriesMatches.Count) show(s) matching '$seriesTitle'" -Path $global:configLogging -Color Cyan -log Info

                $seriesItem = $null

                # Bypass regex if single match, otherwise filter by path
                if ($seriesMatches.Count -eq 1) {
                    $seriesItem = $seriesMatches[0]
                    Write-Entry -Message "Single match found. Bypassing library path validation." -Path $global:configLogging -Color Green -log Info
                }
                else {
                    # Find the library matching the Sonarr path
                    $libsResponse = Invoke-RestMethod -Uri "$($OtherMediaServerUrl.TrimEnd('/'))/Library/VirtualFolders" -Headers $global:OtherMediaServerHeaders

                    foreach ($lib in $libsResponse) {
                        foreach ($location in $lib.Locations) {
                            $escapedRoot = [regex]::Escape($location)
                            if ($ArrPath -match "^$escapedRoot") {
                                $MatchingPath = $location
                                $MatchingLib = $lib.Name
                                Write-Entry -Message "Multiple matches: Filtering to Lib [$MatchingLib]" -Path $global:configLogging -Color Cyan -log Info
                                break
                            }
                        }
                        if ($MatchingPath) { break }
                    }

                    if ($MatchingPath) {
                        $escapedRoot = [regex]::Escape($MatchingPath)
                        $seriesItem = $seriesMatches.Where({ $_.Path -match "^$escapedRoot" }, 'First')
                    }
                }

                # Validation and Retrieval of Seasons/Episodes
                if (-not $seriesItem) {
                    Write-Entry -Message "No valid show found matching criteria or path." -Path $global:configLogging -Color Red -log Error
                    HandleScriptExit -Message "No show found matching '$seriesTitle'"
                }

                $seriesId = $seriesItem.Id
                Write-Entry -Message "Proceeding with: $($seriesItem.Name) (ID: $seriesId)" -Path $global:configLogging -Color Green -log Info

                # Get Season
                $seasons = Invoke-RestMethod -Uri "$OtherMediaServerUrl/Items?ParentId=$seriesId&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&IncludeItemTypes=Season" -Headers $global:OtherMediaServerHeaders
                $seasonItem = $seasons.Items | Where-Object { $_.IndexNumber -eq $seasonIndex }

                if (-not $seasonItem) {
                    HandleScriptExit -Message "Season $seasonIndex not found for series $($seriesItem.Name)"
                }

                # Get Episode
                $seasonId = $seasonItem.Id
                $episodes = Invoke-RestMethod -Uri "$OtherMediaServerUrl/Items?ParentId=$seasonId&Recursive=true&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,Settings,Tags,Width,Height,MediaStreams&IncludeItemTypes=Episode" -Headers $global:OtherMediaServerHeaders
                $episodeItem = $episodes.Items | Where-Object { $_.IndexNumber -eq $episodeIndex }

                if (-not $episodeItem) {
                    HandleScriptExit -Message "Episode $episodeIndex not found in season $seasonIndex"
                }

                Write-Entry -Message "Found episode $($episodeIndex): $($episodeItem.Name)" -Path $global:configLogging -Color Green -log Info

                $AllShows = [PSCustomObject]@{ Items = @($seriesItem) }
                $AllEpisodes = [PSCustomObject]@{ Items = @($episodeItem) }
            }
            elseif ($UsePlex -eq 'true') {
                Write-Entry -Message "Using Plex media server" -Path $global:configLogging -Color Green -log Info
                $searchUrl = "$PlexUrl/search?query=$([uri]::EscapeDataString($seriesTitle))"
                [xml]$searchXml = (Invoke-WebRequest $searchUrl -Headers $extraPlexHeaders).content
                $shows = $searchXml.MediaContainer.directory | Where-Object { $_.type -eq 'show' }

                if ($null -eq $shows -or $shows.Count -eq 0) {
                    Write-Entry -Message "No shows found matching '$seriesTitle'" -Path $global:configLogging -Color Red -log Error
                    # Clear Running File
                    HandleScriptExit -Message "No shows found matching '$seriesTitle'"
                }

                Write-Entry -Message "Found $($shows.Count) show(s) matching '$seriesTitle'" -Path $global:configLogging -Color Cyan -log Info
                if ($shows.Count -gt 1 -and -not [string]::IsNullOrWhiteSpace($seriesYear)) {
                    $filteredShows = $shows | Where-Object { $_.year -eq $seriesYear }

                    if ($filteredShows) {
                        $shows = $filteredShows
                    }
                    else {
                        Write-Entry -Message "Year mismatch ignored: Could not find '$seriesTitle' with year $seriesYear. Defaulting to first result." -Path $global:configLogging -Color Yellow -log Warning
                    }
                }

                $matchedShow = $shows.Where({ $_.librarySectionTitle -notin $LibstoExclude }, 'First')

                if ($matchedShow) {
                    $shows = $matchedShow
                    Write-Entry -Message "Selected show: $($shows.title)" -Path $global:configLogging -Color Green -log Info

                    $contentquery = "Directory"
                    $queryKey = $shows.RatingKey
                }
                else {
                    Write-Entry -Message "No valid show found (all matches were in excluded libraries)." -Path $global:configLogging -Color Green -log Info

                    HandleScriptExit -Message "No shows found matching search criteria"
                }

                $metadataUrl = "$PlexUrl/library/metadata/$($queryKey)"
                $seasonUrl = "$PlexUrl/library/metadata/$($queryKey)/children?"
                [xml]$Metadata = (Invoke-WebRequest $metadataUrl -Headers $extraPlexHeaders).content
                if ($contentquery -eq 'Directory') {
                    [xml]$Seasondata = (Invoke-WebRequest $seasonUrl -Headers $extraPlexHeaders).content
                }
            }
        }
        'Radarr' {
            Write-Entry -Message "Processing Radarr trigger" -Path $global:configLogging -Color Yellow -log Info
            $movieTitle = $arrTriggers['arr_movie_title']
            $movieYear = $arrTriggers['arr_movie_year']
            $ArrPath = $arrTriggers['arr_movie_path']
            Write-Entry -Message "Movie: '$movieTitle' ($movieYear)" -Path $global:configLogging -Color Cyan -log Info

            if ($UseJellyfin -eq 'true' -or $UseEmby -eq 'true') {
                $ServerType = if ($UseJellyfin -eq 'true') { "Jellyfin" } else { "Emby" }
                Write-Entry -Message "Using $ServerType media server" -Path $global:configLogging -Color Green -log Info

                # 1. Search for matching movies
                $movieSearch = Invoke-RestMethod -Uri "$OtherMediaServerUrl/Items?IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds,OriginalTitle,Settings,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&SearchTerm=$movieTitle" -Headers $global:OtherMediaServerHeaders
                $movieMatches = $movieSearch.Items | Where-Object { ([string]::IsNullOrWhiteSpace($movieYear)) -or ($_.ProductionYear -eq $movieYear) }

                if (-not $movieMatches) {
                    Write-Entry -Message "Movie '$movieTitle' ($movieYear) not found in $ServerType" -Path $global:configLogging -Color Red -log Error
                    HandleScriptExit -Message "Movie '$movieTitle' ($movieYear) not found in $ServerType"
                }

                Write-Entry -Message "Found $($movieMatches.Count) movie(s) matching '$movieTitle'" -Path $global:configLogging -Color Cyan -log Info

                $movieItem = $null

                # 2. Logic: Bypass path validation if single match, otherwise filter by path
                if ($movieMatches.Count -eq 1) {
                    $movieItem = $movieMatches[0]
                    Write-Entry -Message "Single match found. Bypassing library path validation." -Path $global:configLogging -Color Green -log Info
                }
                else {
                    # Multiple results: Determine which library matches the Radarr/Arr path
                    $libsResponse = Invoke-RestMethod -Uri "$($OtherMediaServerUrl.TrimEnd('/'))/Library/VirtualFolders" -Headers $global:OtherMediaServerHeaders

                    $MatchingPath = $null
                    $MatchingLib = $null

                    foreach ($lib in $libsResponse) {
                        # Emby sometimes has Locations as a single string or array; Jellyfin is usually an array
                        foreach ($location in $lib.Locations) {
                            $escapedRoot = [regex]::Escape($location)
                            if ($ArrPath -match "^$escapedRoot") {
                                $MatchingPath = $location
                                $MatchingLib = $lib.Name
                                Write-Entry -Message "Multiple matches: Filtering to Lib [$MatchingLib]" -Path $global:configLogging -Color Cyan -log Info
                                break
                            }
                        }
                        if ($MatchingPath) { break }
                    }

                    if ($MatchingPath) {
                        $escapedRoot = [regex]::Escape($MatchingPath)
                        # Find the movie within the specific library path
                        $movieItem = $movieMatches.Where({ $_.Path -match "^$escapedRoot" }, 'First')
                    }
                }

                # 3. Final Validation
                if (-not $movieItem) {
                    Write-Entry -Message "No valid movie found matching criteria or path." -Path $global:configLogging -Color Red -log Error
                    HandleScriptExit -Message "No movie found matching '$movieTitle'"
                }

                Write-Entry -Message "Found movie: $($movieItem.Name) (Path: $($movieItem.Path))" -Path $global:configLogging -Color Green -log Info
                $AllMovies = [PSCustomObject]@{ Items = @($movieItem) }
            }
            elseif ($UsePlex -eq 'true') {
                Write-Entry -Message "Using Plex media server" -Path $global:configLogging -Color Green -log Info
                $searchUrl = "$PlexUrl/search?query=$([uri]::EscapeDataString($movieTitle))"
                [xml]$searchXml = (Invoke-WebRequest $searchUrl -Headers $extraPlexHeaders).content
                $movies = $searchXml.MediaContainer.video | Where-Object { $_.type -eq 'movie' }

                if ($null -eq $movies -or $movies.Count -eq 0) {
                    Write-Entry -Message "No movies found matching '$movieTitle'" -Path $global:configLogging -Color Red -log Error
                    # Clear Running File
                    HandleScriptExit -Message "No movies found matching '$movieTitle'"
                }

                Write-Entry -Message "Found $($movies.Count) movie(s) matching '$movieTitle'" -Path $global:configLogging -Color Cyan -log Info
                if ($movies.Count -gt 1 -and -not [string]::IsNullOrWhiteSpace($movieYear)) {
                    $filteredmovies = $movies | Where-Object { $_.year -eq $movieYear }

                    if ($filteredmovies) {
                        $movies = $filteredmovies
                    }
                    else {
                        Write-Entry -Message "Year mismatch ignored: Could not find '$movieTitle' with year $movieYear. Defaulting to first result." -Path $global:configLogging -Color Yellow -log Warning
                    }
                }
                $matchedMovie = $movies.Where({ $_.librarySectionTitle -notin $LibstoExclude }, 'First')

                if ($matchedMovie) {
                    $movies = $matchedMovie
                    Write-Entry -Message "Selected movie: $($movies.title)" -Path $global:configLogging -Color Green -log Info
                    $contentquery = "video"
                    $queryKey = $movies.RatingKey
                }
                else {
                    # This only runs if NO movies passed the filter
                    Write-Entry -Message "No valid movie found (all matches were in excluded libraries)." -Path $global:configLogging -Color Green -log Info
                    # Clear Running File
                    HandleScriptExit -Message "No movies found matching '$movieTitle'"
                }
                $metadataUrl = "$PlexUrl/library/metadata/$($queryKey)"
                [xml]$Metadata = (Invoke-WebRequest $metadataUrl -Headers $extraPlexHeaders).content
            }
        }
        default { Write-Entry -Message "Unknown platform: $arrplatform" -Path $global:configLogging -Color Red -log Error }
    }
    $Libraries = [System.Collections.Generic.List[object]]::new()
    if ($UseJellyfin -eq 'true' -or $UseEmby -eq 'true') {
        $PreferredMetadataLanguage = (Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/System/Configuration" -Headers $global:OtherMediaServerHeaders).PreferredMetadataLanguage ?? "en"
        foreach ($Movie in $AllMovies.Items) {
            $Resolution = $null
            if ($UseEmby -eq 'true') {
                $Libtemp = Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/Items/$($Movie.Id)/Ancestors" -Headers $global:OtherMediaServerHeaders
                $lib = $Libtemp | Where-Object { $_.Type -eq 'Folder' } | Select-Object Name, Path

                $libraryQuery = "$OtherMediaServerUrl/Library/VirtualFolders"
                $librarytemp = Invoke-RestMethod -Method Get -Uri $libraryQuery -Headers $global:OtherMediaServerHeaders
                $librariestemp = $librarytemp | Where-Object { $_.CollectionType -eq 'movies' } | Select-Object Name, Locations, LibraryOptions -Unique

                foreach ($singlelibrary in $librariestemp) {
                    foreach ($location in $singlelibrary.Locations) {
                        # Select correct NetworkPath
                        $LibraryOptions = $singlelibrary.LibraryOptions.PathInfos | Where-Object { $_.Path -eq $location }
                        if ($LibraryOptions.NetworkPath) {
                            $location = $LibraryOptions.NetworkPath
                        }

                        Write-Entry -Subtext "  Found location - '$($location)'" -Path $global:configLogging -Color Cyan -log Debug
                        # Compare lib.Path with each location
                        if ($Movie.Path -like "$($location)/*" -or $Movie.Path -like "$($location)\*") {
                            $SingleLibName = $singlelibrary.Name
                            Write-Entry -Subtext "  Single lib name is: '$($SingleLibName)'" -Path $global:configLogging -Color Cyan -log Debug
                            break # Exit loop after match
                        }
                    }
                }
                if ($SingleLibName -notin $LibstoExclude) {
                    Write-Entry -Subtext "Location: $($Movie.Path)" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "Libpath: $($lib.Path[1])" -Path $global:configLogging -Color Cyan -log Debug
                    $Matchedpath = AddTrailingSlash $($lib.Path[1])
                    $libpath = $Matchedpath
                    $relativePath = $Movie.Path.Substring($libpath.Length)
                    $pathSegments = $relativePath -split '[\\/]'

                    # Determine the extracted folder and the root folder path
                    if ($pathSegments.Count -gt 2) {
                        $extractedFolder = $pathSegments[-2]  # Second-to-last segment is the folder containing the file
                        $extraFolder = $pathSegments[0]  # All segments up to the extracted folder
                    }
                    else {
                        $extractedFolder = $pathSegments[0]  # Only one segment, it's the folder
                        $extraFolder = $null  # No parent structure
                    }

                    if ($Movie.Tags) {
                        $Labels = $($Movie.Tags -join ',')
                    }
                    Else {
                        $Labels = ""
                    }
                    # Determine resolution category
                    if ($movie.Width -and $movie.Height) {
                        # Get the base resolution
                        $baseResolution = Get-Resolution -Width $movie.Width

                        # Grab the primary video stream to check for HDR
                        $videoStream = $movie.MediaStreams | Where-Object Type -eq 'Video' | Select-Object -First 1
                        if ($videoStream.ExtendedVideoSubTypeDescription -and $videoStream.ExtendedVideoSubTypeDescription -ne 'None') {
                            Write-Entry -Subtext "Raw Video Description: $($videoStream.ExtendedVideoSubTypeDescription)" -Path $global:configLogging -Color Cyan -log Debug
                            if ($videoStream.ExtendedVideoSubTypeDescription -match 'Profile.*HDR10') {
                                $hdrType = 'DOVIHDR10'
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Raw Video Description: $($videoStream.ExtendedVideoType)" -Path $global:configLogging -Color Cyan -log Debug
                            $hdrType = $videoStream.ExtendedVideoType
                        }

                        # Build the final string
                        if ($baseResolution -eq "4K" -and $hdrType) {

                            switch -Regex ($hdrType) {
                                # Check for Dolby Vision combinations
                                'DOVIWithEL' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                                'DOVI.*HDR10Plus' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                                'DOVI.*HDR10' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                                '^DOVI|^DolbyVision' { $Resolution = "$baseResolution DoVi"; break }

                                # Check for standard HDR combinations
                                '^HDR10Plus' { $Resolution = "$baseResolution HDR10"; break }
                                '^HDR10' { $Resolution = "$baseResolution HDR10"; break }

                                # If it's SDR or something unrecognized, just keep it simple
                                'SDR' { $Resolution = "$baseResolution"; break }
                                default { $Resolution = "$baseResolution"; break }
                            }

                        }
                        else {
                            # For 1080p, 720p, or files without a VideoRangeType, just use the base name
                            $Resolution = $baseResolution
                        }
                    }

                    Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug
                    $temp = New-Object psobject
                    $temp | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $SingleLibName
                    $temp | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $Movie.Type
                    $temp | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $PreferredMetadataLanguage
                    $temp | Add-Member -MemberType NoteProperty -Name "Id" -Value $Movie.Id
                    $temp | Add-Member -MemberType NoteProperty -Name "title" -Value $Movie.Name
                    $temp | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $Movie.OriginalTitle
                    $temp | Add-Member -MemberType NoteProperty -Name "year" -Value $Movie.ProductionYear
                    if ($Resolution) {
                        $temp | Add-Member -MemberType NoteProperty -Name "Resolution" -Value $Resolution
                    }
                    $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $Movie.ProviderIds.Imdb
                    $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $Movie.ProviderIds.Tmdb
                    $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $Movie.ProviderIds.Tvdb
                    $temp | Add-Member -MemberType NoteProperty -Name "Path" -Value $libpath
                    $temp | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $extractedFolder
                    $temp | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $extraFolder
                    $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerPosterUrl" -Value $Movie.ImageTags.Primary
                    $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerBackgroundUrl" -Value $($Movie.BackdropImageTags -join ",")
                    $temp | Add-Member -MemberType NoteProperty -Name "Labels" -Value $Labels
                    $Libraries.Add($temp)
                    Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                }
            }
            Else {
                $Libtemp = Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/Items/$($Movie.Id)/Ancestors" -Headers $global:OtherMediaServerHeaders
                $lib = $Libtemp | Where-Object { $_.Type -eq 'Folder' } | Select-Object Name, Path

                $libraryQuery = "$OtherMediaServerUrl/Library/VirtualFolders"
                $librarytemp = Invoke-RestMethod -Method Get -Uri $libraryQuery -Headers $global:OtherMediaServerHeaders
                $librariestemp = $librarytemp | Where-Object { $_.CollectionType -eq 'movies' } | Select-Object Name, Locations -Unique

                foreach ($singlelibrary in $librariestemp) {
                    # Loop through each location in the library's Locations array
                    foreach ($location in $singlelibrary.Locations) {
                        Write-Entry -Subtext "  Found location - '$($location)'" -Path $global:configLogging -Color Cyan -log Debug
                        # Compare lib.Path with each location
                        if ($Movie.Path -like "$location/*" -or $Movie.Path -like "$location\*") {
                            $SingleLibName = $singlelibrary.Name
                            Write-Entry -Subtext "  Single lib name is: '$($SingleLibName)'" -Path $global:configLogging -Color Cyan -log Debug
                            break # Exit loop after match
                        }
                    }
                }
                if ($SingleLibName -notin $LibstoExclude) {
                    Write-Entry -Subtext "Location: $($Movie.Path)" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "Libpath: $($lib.Path)" -Path $global:configLogging -Color Cyan -log Debug
                    if ($lib.Path.count -gt '1') {
                        $Matchedpath = AddTrailingSlash $($lib.Path[0])
                    }
                    else {
                        $Matchedpath = AddTrailingSlash $($lib.Path)
                    }
                    $libpath = $Matchedpath
                    $relativePath = $Movie.Path.Substring($libpath.Length)
                    $pathSegments = $relativePath -split '[\\/]'

                    # Determine the extracted folder and the root folder path
                    if ($pathSegments.Count -gt 2) {
                        $extractedFolder = $pathSegments[-2]  # Second-to-last segment is the folder containing the file
                        $extraFolder = $pathSegments[0]  # All segments up to the extracted folder
                    }
                    else {
                        $extractedFolder = $pathSegments[0]  # Only one segment, it's the folder
                        $extraFolder = $null  # No parent structure
                    }

                    if ($Movie.Tags) {
                        $Labels = $($Movie.Tags -join ',')
                    }
                    Else {
                        $Labels = ""
                    }
                    # Determine resolution category
                    if ($movie.Width -and $movie.Height) {
                        # Get the base resolution
                        $baseResolution = Get-Resolution -Width $movie.Width

                        # Grab the primary video stream to check for HDR
                        $videoStream = $movie.MediaStreams | Where-Object Type -eq 'Video' | Select-Object -First 1
                        Write-Entry -Subtext "Raw Video Description: $($videoStream.VideoRangeType)" -Path $global:configLogging -Color Cyan -log Debug
                        $hdrType = $videoStream.VideoRangeType

                        # Build the final string
                        if ($baseResolution -eq "4K" -and $hdrType) {

                            switch -Regex ($hdrType) {
                                # Check for Dolby Vision combinations
                                'DOVIWithEL' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                                'DOVI.*HDR10Plus' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                                'DOVI.*HDR10' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                                '^DOVI|^DolbyVision' { $Resolution = "$baseResolution DoVi"; break }

                                # Check for standard HDR combinations
                                '^HDR10Plus' { $Resolution = "$baseResolution HDR10"; break }
                                '^HDR10' { $Resolution = "$baseResolution HDR10"; break }

                                # If it's SDR or something unrecognized, just keep it simple
                                'SDR' { $Resolution = "$baseResolution"; break }
                                default { $Resolution = "$baseResolution"; break }
                            }

                        }
                        else {
                            # For 1080p, 720p, or files without a VideoRangeType, just use the base name
                            $Resolution = $baseResolution
                        }
                    }
                    Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug

                    $temp = New-Object psobject
                    $temp | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $SingleLibName
                    $temp | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $Movie.Type
                    $temp | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $PreferredMetadataLanguage
                    $temp | Add-Member -MemberType NoteProperty -Name "Id" -Value $Movie.Id
                    $temp | Add-Member -MemberType NoteProperty -Name "title" -Value $Movie.Name
                    $temp | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $Movie.OriginalTitle
                    $temp | Add-Member -MemberType NoteProperty -Name "year" -Value $Movie.ProductionYear
                    if ($Resolution) {
                        $temp | Add-Member -MemberType NoteProperty -Name "Resolution" -Value $Resolution
                    }
                    $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $Movie.ProviderIds.Imdb
                    $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $Movie.ProviderIds.Tmdb
                    $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $Movie.ProviderIds.Tvdb
                    $temp | Add-Member -MemberType NoteProperty -Name "Path" -Value $libpath
                    $temp | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $extractedFolder
                    $temp | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $extraFolder
                    $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerPosterUrl" -Value $Movie.ImageTags.Primary
                    $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerBackgroundUrl" -Value $($Movie.BackdropImageTags -join ",")
                    $temp | Add-Member -MemberType NoteProperty -Name "Labels" -Value $Labels
                    $Libraries.Add($temp)
                    Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                }
            }
}
        foreach ($Show in $AllShows.Items) {
            $Libtemp = Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/Items/$($Show.Id)/Ancestors" -Headers $global:OtherMediaServerHeaders
            $lib = $Libtemp | Where-Object { $_.Type -eq 'Folder' } | Select-Object Name, path

            $libraryQuery = "$($OtherMediaServerUrl.TrimEnd('/'))/Library/VirtualFolders"
            $OtherAllLibs = Invoke-RestMethod -Method Get -Uri $libraryQuery -Headers $global:OtherMediaServerHeaders
            if ($UseEmby -eq 'true') {
                $librariestemp = $OtherAllLibs | Where-Object { $_.CollectionType -eq 'tvshows' } | Select-Object Name, Locations, LibraryOptions -Unique
            }
            Else {
                $librariestemp = $OtherAllLibs | Where-Object { $_.CollectionType -eq 'tvshows' } | Select-Object Name, Locations -Unique
            }
            foreach ($singlelibrary in $librariestemp) {
                # Loop through each location in the library's Locations array
                foreach ($location in $singlelibrary.Locations) {
                    if ($UseEmby -eq 'true') {
                        # Select correct NetworkPath
                        $LibraryOptions = $singlelibrary.LibraryOptions.PathInfos | Where-Object { $_.Path -eq $location }
                        if ($LibraryOptions.NetworkPath) {
                            $location = $LibraryOptions.NetworkPath
                        }
                    }
                    Write-Entry -Subtext "  Found location - '$($location)'" -Path $global:configLogging -Color Cyan -log Debug
                    # Compare lib.Path with each location
                    if ($Show.Path -like "$location/*" -or $Show.Path -like "$location\*") {
                        $SingleLibName = $singlelibrary.Name
                        #Write-Entry -Subtext "  Single lib name is: '$($SingleLibName)'" -Path $global:configLogging -Color Cyan -log Debug
                        break # Exit loop after match
                    }
                }
            }
            if ($SingleLibName -notin $LibstoExclude) {
                Write-Entry -Subtext "Location: $($Show.Path)" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "Libpath: $($lib.Path)" -Path $global:configLogging -Color Cyan -log Debug
                $Matchedpath = AddTrailingSlash $($lib.Path)
                $libpath = $Matchedpath
                $relativePath = $Show.Path.Substring($libpath.Length)
                $pathSegments = $relativePath -split '[\\/]'

                # Determine the extracted folder and the root folder path
                if ($pathSegments.Count -gt 2) {
                    $extractedFolder = $pathSegments[-2]  # Second-to-last segment is the folder containing the file
                    $extraFolder = $pathSegments[0]  # All segments up to the extracted folder
                }
                else {
                    $extractedFolder = $pathSegments[0]  # Only one segment, it's the folder
                    $extraFolder = $null  # No parent structure
                }

                if ($Show.Tags) {
                    $Labels = $($Show.Tags -join ',')
                }
                Else {
                    $Labels = ""
                }

                Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug

                $temp = New-Object psobject
                $temp | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $SingleLibName
                $temp | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $Show.Type
                $temp | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $PreferredMetadataLanguage
                $temp | Add-Member -MemberType NoteProperty -Name "Id" -Value $Show.Id
                $temp | Add-Member -MemberType NoteProperty -Name "title" -Value $Show.Name
                $temp | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $Show.OriginalTitle
                $temp | Add-Member -MemberType NoteProperty -Name "year" -Value $Show.ProductionYear
                $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $Show.ProviderIds.Imdb
                $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $Show.ProviderIds.Tmdb
                $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $Show.ProviderIds.Tvdb
                $temp | Add-Member -MemberType NoteProperty -Name "Path" -Value $libpath
                $temp | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $extractedFolder
                $temp | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $extraFolder
                $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerPosterUrl" -Value $Show.ImageTags.Primary
                $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerBackgroundUrl" -Value $($Show.BackdropImageTags -join ",")
                $temp | Add-Member -MemberType NoteProperty -Name "Labels" -Value $Labels
                $Libraries.Add($temp)
                Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
            }
        }
        Write-Entry -Subtext "Found '$($Libraries.count)' Items..." -Path $global:configLogging -Color Cyan -log Info
        Write-Entry -Message "Starting episode data query now - This can take a while..." -Path $global:configLogging -Color Cyan -Log Info

        $Episodedata = [System.Collections.Generic.List[object]]::new()
        $TempShowLibs = $Libraries | Where-Object { $_."Library Type" -eq 'Series' }
        foreach ($show in $TempShowLibs) {
            # Iterate through all shows
            $seasons = $AllEpisodes.Items | Where-Object { $_.SeriesId -eq $show.id } | Group-Object -Property SeasonName | Sort-Object -Property Name
            foreach ($Season in $Seasons) {
                # Sort episodes within the season by IndexNumber
                $SeasonEpisodes = $Season.Group | Sort-Object -Property indexnumber

                # Collect episode IDs, Titles, and PrimaryImageTags
                $EpisodeIds = ($SeasonEpisodes.Id -join ',')
                $EpisodeWidths = ($SeasonEpisodes.Width -join ',')
                $EpisodeHeights = ($SeasonEpisodes.Height -join ',')
                $EpisodeTitles = ($SeasonEpisodes.Name -join ';')
                $Episodes = ($SeasonEpisodes.IndexNumber -join ',')
                $Thumbs = ($SeasonEpisodes.ImageTags.Primary -join ',')
                $VideoRangesArray = foreach ($ep in $SeasonEpisodes) {
                    $vid = $ep.MediaStreams | Where-Object Type -eq 'Video' | Select-Object -First 1

                    # Determine the base HDR string (Emby uses ExtendedVideoType, Jellyfin uses VideoRangeType)
                    $currentRange = ($UseEmby -eq 'true') ? $vid.ExtendedVideoType : $vid.VideoRangeType

                    if ($currentRange -and $currentRange -ne 'None') {
                        Write-Entry -Subtext "Raw Video Description: $($currentRange)" -Path $global:configLogging -Color Cyan -log Debug
                        if ($UseEmby -eq 'true' -and $vid.ExtendedVideoSubTypeDescription -and $vid.ExtendedVideoSubTypeDescription -ne 'None') {
                            Write-Entry -Subtext "Raw Sub Video Description: $($vid.ExtendedVideoSubTypeDescription)" -Path $global:configLogging -Color Cyan -log Debug
                        }
                        # Refine for Dolby Vision + HDR10 Hybrid (Profile 7 or 8)
                        if ($vid.ExtendedVideoSubTypeDescription -match 'Profile.*HDR10' -or $vid.VideoRangeType -match 'HDR10|EL' -or $vid.ExtendedVideoType -match 'HDR10|EL') {
                            $currentRange = "DOVIHDR10"
                        }

                        $currentRange
                    }
                    else {
                        "None"
                    }
                }
                $EpisodeVideoRanges = ($VideoRangesArray -join ',')

                # Calculate the ShowID and SeasonId
                $ShowID = if ($SeasonEpisodes.SeriesId) { $SeasonEpisodes.SeriesId } else { $null }
                $SeasonId = if ($SeasonEpisodes.SeasonId) { $SeasonEpisodes.SeasonId } else { $null }

                # Create an object for the current season
                $seasonObject = [PSCustomObject]@{
                    "Library Name"                 = $show."Library Name"
                    "Show Name"                    = $show.title
                    "Show Original Name"           = $show.OriginalTitle
                    "Library Language"             = $PreferredMetadataLanguage
                    "ShowID"                       = $ShowID
                    "SeasonId"                     = $SeasonId
                    "EpisodeIds"                   = $EpisodeIds
                    "EpisodeWidths"                = $EpisodeWidths
                    "EpisodeHeights"               = $EpisodeHeights
                    "EpisodeVideoRanges"           = $EpisodeVideoRanges
                    "tvdbid"                       = $show.tvdbid
                    "imdbid"                       = $show.imdbid
                    "tmdbid"                       = $show.tmdbid
                    "type"                         = "Episode"
                    "Season Number"                = $SeasonEpisodes[0].ParentIndexNumber
                    "SeasonName"                   = $Season.Name
                    "Episodes"                     = $Episodes
                    "Title"                        = $EpisodeTitles
                    "RootFoldername"               = $show.RootFoldername
                    "extraFolder"                  = $show.extraFolder
                    "Path"                         = $show.Path
                    "OtherMediaServerBackgroundUrl"= $show.OtherMediaServerBackgroundUrl
                    "OtherMediaServerTitleCardTag" = $Thumbs
                    "OtherMediaServerSeasonTag"    = $SeasonEpisodes[0].SeriesPrimaryImageTag
                }

                # Add the season object to the array
                $Episodedata.Add($seasonObject)
            }
        }
        # Create an empty array to hold the custom objects
        $FormattedData = [System.Collections.Generic.List[object]]::new()

        # Iterate over each item in $OtherEpisodedata
        foreach ($data in $Episodedata) {
            $EpisodeWidths = $data.EpisodeWidths -split ","
            $EpisodeHeights = $data.EpisodeHeights -split ","
            $EpisodeVideoRanges = $data.EpisodeVideoRanges -split ","
            # Initialize an empty array for resolutions
            $Resolution = [System.Collections.Generic.List[object]]::new()

            # Loop through each episode and determine resolution
            for ($i = 0; $i -lt $EpisodeWidths.Count; $i++) {
                $Width = [int]$EpisodeWidths[$i]

                # Get the base resolution for this episode
                $baseRes = Get-Resolution -Width $Width

                # Grab the primary video stream for THIS specific episode
                $hdrType = $EpisodeVideoRanges[$i]

                # Build the final string for this episode
                if ($baseRes -eq "4K" -and $hdrType -ne "None") {

                    switch -Regex ($hdrType) {
                        'DOVIWithEL' { $Resolution = "$baseResolution DoVi/HDR10"; break }
                        'DOVI.*HDR10Plus' { $finalRes = "$baseRes DoVi/HDR10"; break }
                        'DOVI.*HDR10' { $finalRes = "$baseRes DoVi/HDR10"; break }
                        '^DOVI|^DolbyVision' { $finalRes = "$baseRes DoVi"; break }
                        '^HDR10Plus' { $finalRes = "$baseRes HDR10"; break }
                        '^HDR10' { $finalRes = "$baseRes HDR10"; break }
                        'SDR' { $finalRes = "$baseRes"; break }
                        default { $finalRes = "$baseRes"; break }
                    }

                }
                else {
                    # Fallback for 1080p, 720p, etc.
                    $finalRes = $baseRes
                }

                $Resolution.Add($finalRes)
            }
            # Create a custom object for each episode using the variables
            $FormattedData.Add([PSCustomObject]@{
                    'Library Name'                 = $data.'Library Name'
                    'Show Name'                    = $data.'Show Name'
                    'Show Original Name'           = $data.'Show Original Name'
                    'Library Language'             = $data.'Library Language'
                    'ShowID'                       = $data.'ShowID'
                    'SeasonId'                     = $data.'SeasonId'
                    'EpisodeIds'                   = $data.'EpisodeIds'
                    'Resolutions'                  = $Resolution -join ","
                    'tvdbid'                       = $data.'tvdbid'
                    'imdbid'                       = $data.'imdbid'
                    'tmdbid'                       = $data.'tmdbid'
                    'type'                         = $data.'type'
                    'Season Number'                = $data.'Season Number'
                    'SeasonName'                   = $data.'SeasonName'
                    'Episodes'                     = $data.'Episodes'
                    'Title'                        = $data.'Title'
                    'RootFoldername'               = $data.'RootFoldername'
                    'extraFolder'                  = $data.'extraFolder'
                    'Path'                         = $data.'Path'
                    'OtherMediaServerBackgroundUrl'= $data.'OtherMediaServerBackgroundUrl'
                    'OtherMediaServerTitleCardTag' = $data.'OtherMediaServerTitleCardTag'
                    'OtherMediaServerSeasonTag'    = $data.'OtherMediaServerSeasonTag'
                })
        }

        # Export the formatted data to CSV
        $Episodedata = $FormattedData
        if ($AllEpisodes) {
            Write-Entry -Subtext "Found '$($AllEpisodes.Items.count)' Episodes..." -Path $global:configLogging -Color Cyan -log Info
        }

        $AllShows = $Libraries | Where-Object { $_.'Library Type' -eq 'Series' }
        $AllMovies = $Libraries | Where-Object { $_.'Library Type' -eq 'Movie' }

        # Store all Files from asset dir in a hashtable
        $directoryHashtable = Get-AssetHashtable

        Write-Entry -Message "Starting asset creation now, this can take a while..." -Path $global:configLogging -Color White -log Info
        Write-Entry -Message "Starting Movie Poster Creation part..." -Path $global:configLogging -Color Green -log Info
        $global:checkedItems = [System.Collections.Concurrent.ConcurrentBag[object]]::new()

        $globalState = [System.Collections.Hashtable]::Synchronized(@{})
        Get-Variable | Where-Object {
            $_.Options -notmatch 'ReadOnly|Constant' -and
            $_.Name -notin @('FormatEnumerationLimit', 'MaximumHistoryCount', 'Host', 'Error', 'PWD', 'HOME', 'PID', 'globalState', 'AllMovies', 'AllShows', 'Libraries', 'Libs', 'OtherMediaServerLibs', 'Metadata', 'Seasondata', '_', 'PSItem')
        } | ForEach-Object {
            $globalState[$_.Name] = $_.Value
        }

        $sbStr = [System.Text.StringBuilder]::new()
        foreach ($key in $globalState.Keys) {
            $safeKey = $key -replace "'", "''"
            [void]$sbStr.Append("`${global:$key} = `$state['$safeKey']; ")
        }
        $global:StateAssignerStr = $sbStr.ToString()

        # Movie Part
        if ($AllMovies) {
            $AllMovies | ForEach-Object -Parallel {
            $state = $using:globalState
            if (-not (Get-Command "Runspace-Initialized" -ErrorAction SilentlyContinue)) {
                $functionFiles = Get-ChildItem -Path "$($state['AppRoot'])/modules/functions" -Filter "*.ps1"
                foreach ($funcFile in $functionFiles) { . $funcFile.FullName }
                if ($state['FanartTvAPIKey']) {
                    Import-Module -Name Celerium.FanartTV -ErrorAction SilentlyContinue
                    Add-FanartTVAPIKey -ProjectKey $state['FanartTvAPIKey'] -ErrorAction SilentlyContinue
                }
                function Runspace-Initialized {}
            }
            $StateAssignerSb = [scriptblock]::Create($using:StateAssignerStr)
            & $StateAssignerSb

            Invoke-MoviePosterCreation -entry $_
        } -ThrottleLimit $(if ($config.PrerequisitePart.ParallelJobs) { $config.PrerequisitePart.ParallelJobs } else { 5 })
        }

        Write-Entry -Message "Starting Show/Season Poster/Background/TitleCard Creation part..." -Path $global:configLogging -Color Green -log Info
        # Show Part
        if ($AllShows) {
            $AllShows | ForEach-Object -Parallel {
            $state = $using:globalState
            if (-not (Get-Command "Runspace-Initialized" -ErrorAction SilentlyContinue)) {
                $functionFiles = Get-ChildItem -Path "$($state['AppRoot'])/modules/functions" -Filter "*.ps1"
                foreach ($funcFile in $functionFiles) { . $funcFile.FullName }
                if ($state['FanartTvAPIKey']) {
                    Import-Module -Name Celerium.FanartTV -ErrorAction SilentlyContinue
                    Add-FanartTVAPIKey -ProjectKey $state['FanartTvAPIKey'] -ErrorAction SilentlyContinue
                }
                function Runspace-Initialized {}
            }
            $StateAssignerSb = [scriptblock]::Create($using:StateAssignerStr)
            & $StateAssignerSb

            Invoke-ShowPosterCreation -entry $_
        } -ThrottleLimit $(if ($config.PrerequisitePart.ParallelJobs) { $config.PrerequisitePart.ParallelJobs } else { 5 })
        }

        if ($global:TitleCards -eq 'true' -and $FormattedData) {
            Write-Entry -Message "Starting TitleCard Creation part..." -Path $global:configLogging -Color Green -log Info
            $FormattedData | ForEach-Object -Parallel {
                $state = $using:globalState
                if (-not (Get-Command "Runspace-Initialized" -ErrorAction SilentlyContinue)) {
                    $functionFiles = Get-ChildItem -Path "$($state['AppRoot'])/modules/functions" -Filter "*.ps1"
                    foreach ($funcFile in $functionFiles) { . $funcFile.FullName }
                    if ($state['FanartTvAPIKey']) {
                        Import-Module -Name Celerium.FanartTV -ErrorAction SilentlyContinue
                        Add-FanartTVAPIKey -ProjectKey $state['FanartTvAPIKey'] -ErrorAction SilentlyContinue
                    }

                function Runspace-Initialized {}
            }
            $StateAssignerSb = [scriptblock]::Create($using:StateAssignerStr)
            & $StateAssignerSb

                Invoke-TitleCardCreation -episode $_
            } -ThrottleLimit $(if ($config.PrerequisitePart.ParallelJobs) { $config.PrerequisitePart.ParallelJobs } else { 5 })
        }

        $endTime = Get-Date
        $executionTime = New-TimeSpan -Start $startTime -End $endTime
        # Format the execution time
        $hours = [math]::Floor($executionTime.TotalHours)
        $minutes = $executionTime.Minutes
        $seconds = $executionTime.Seconds
        $FormattedTimespawn = $hours.ToString() + "h " + $minutes.ToString() + "m " + $seconds.ToString() + "s "
    Sync-GlobalStats
    Write-Entry -Message "Finished, Total images created: $posterCount" -Path $global:configLogging -Color Green -log Info
        if ($UploadCount -ge '1') {
            Write-Entry -Message "Finished, Total images Uploaded: $UploadCount" -Path $global:configLogging -Color Green -log Info
        }
        if ($posterCount -ge '1') {
            Write-Entry -Message "Show/Movie Posters created: $($posterCount-$SeasonCount-$BackgroundCount-$EpisodeCount)| Season images created: $SeasonCount | Background images created: $BackgroundCount | TitleCards created: $EpisodeCount" -Path $global:configLogging -Color Green -log Info
        }
        if ((Test-Path $global:ScriptRoot\Logs\ImageChoices.csv)) {
            Write-Entry -Message "You can find a detailed Summary of image Choices here: $global:ScriptRoot\Logs\ImageChoices.csv" -Path $global:configLogging -Color White -log Info
            # Calculate Summary
            $SummaryCount = Import-Csv -LiteralPath "$global:ScriptRoot\Logs\ImageChoices.csv" -Delimiter ';'
            $FallbackCount = @($SummaryCount | Where-Object Fallback -eq 'true')
            $TextlessCount = @($SummaryCount | Where-Object Language -eq 'Textless')
            $TextTruncatedCount = @($SummaryCount | Where-Object TextTruncated -eq 'true')
            $TextCount = @($SummaryCount | Where-Object Textless -eq 'false')
            if ($TextlessCount -or $FallbackCount -or $TextCount -or $PosterUnknownCount -or $TextTruncatedCount) {
                Write-Entry -Message "This is a subset summary of all image choices from the ImageChoices.csv" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextlessCount) {
                Write-Entry -Subtext "'$($TextlessCount.count)' times the script took a Textless image" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($FallbackCount) {
                Write-Entry -Subtext "'$($FallbackCount.count)' times the script took a fallback image" -Path $global:configLogging -Color Yellow -log Info
                Write-Entry -Subtext "'$($posterCount-$FallbackCount.count)' times the script took the image from fav provider: $global:FavProvider" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextCount) {
                Write-Entry -Subtext "'$($TextCount.count)' times the script took an image with Text" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($PosterUnknownCount -ge '1') {
                Write-Entry -Subtext "'$PosterUnknownCount' times the script took a season poster where we cannot tell if it has text or not" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextTruncatedCount) {
                Write-Entry -Subtext "'$($TextTruncatedCount.count)' times the script truncated the text in images" -Path $global:configLogging -Color Yellow -log Info
            }
        }
        if ((Test-Path $global:ScriptRoot\Logs\ImageChoices.csv)) {
            Write-Entry -Message "You can find a detailed Summary of image Choices here: $global:ScriptRoot\Logs\ImageChoices.csv" -Path $global:configLogging -Color White -log Info
            # Calculate Summary
            $SummaryCount = Import-Csv -LiteralPath "$global:ScriptRoot\Logs\ImageChoices.csv" -Delimiter ';'
            $FallbackCount = @($SummaryCount | Where-Object Fallback -eq 'true')
            $TextlessCount = @($SummaryCount | Where-Object Language -eq 'Textless')
            $TextTruncatedCount = @($SummaryCount | Where-Object TextTruncated -eq 'true')
            $TextCount = @($SummaryCount | Where-Object Textless -eq 'false')
            if ($TextlessCount -or $FallbackCount -or $TextCount -or $PosterUnknownCount -or $TextTruncatedCount) {
                Write-Entry -Message "This is a subset summary of all image choices from the ImageChoices.csv" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextlessCount) {
                Write-Entry -Subtext "'$($TextlessCount.count)' times the script took a Textless image" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($FallbackCount) {
                Write-Entry -Subtext "'$($FallbackCount.count)' times the script took a fallback image" -Path $global:configLogging -Color Yellow -log Info
                Write-Entry -Subtext "'$($posterCount-$FallbackCount.count)' times the script took the image from fav provider: $global:FavProvider" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextCount) {
                Write-Entry -Subtext "'$($TextCount.count)' times the script took an image with Text" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($PosterUnknownCount -ge '1') {
                Write-Entry -Subtext "'$PosterUnknownCount' times the script took a season poster where we cannot tell if it has text or not" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextTruncatedCount) {
                Write-Entry -Subtext "'$($TextTruncatedCount.count)' times the script truncated the text in images" -Path $global:configLogging -Color Yellow -log Info
            }
        }
        if ($errorCount -ge '1') {
            Write-Entry -Message "During execution '$errorCount' Errors occurred, please check the log for a detailed description where you see [ERROR-HERE]." -Path $global:configLogging -Color White -log Info
        }
        if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\ImageChoices.csv" -ErrorAction SilentlyContinue)) {
            $ImageChoicesDummycsv = New-Object psobject

            # Add members to the object with empty values
            $ImageChoicesDummycsv = New-Object psobject
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Title" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Type" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Language" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Manual" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $null

            $ImageChoicesDummycsv | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
            Write-Entry -Message "No ImageChoices.csv found, creating dummy file for you..." -Path $global:configLogging -Color White -log Info
        }
        Write-TextSizeCacheSummary
        Write-Entry -Message "Script execution time: $FormattedTimespawn" -Path $global:configLogging -Color White -log Info

        # Export json
        $jsonObject = [PSCustomObject]@{
            Posters              = if ($posterCount) { $posterCount } Else { 0 }
            Backgrounds          = if ($BackgroundCount) { $BackgroundCount } Else { 0 }
            Titlecards           = if ($EpisodeCount) { $EpisodeCount } Else { 0 }
            Seasons              = if ($SeasonCount) { $SeasonCount } Else { 0 }
            Collections          = if ($collectionCount) { $collectionCount } Else { 0 }
            Mode                 = $Mode
            Runtime              = $($hours.ToString() + ":" + $minutes.ToString() + ":" + $seconds.ToString())
            Errors               = if ($errorCount) { $errorCount } Else { 0 }
            Fallbacks            = if ($FallbackCount) { $FallbackCount } Else { 0 }
            Textless             = if ($TextlessCount) { $TextlessCount } Else { 0 }
            Truncated            = if ($TextTruncatedCount) { $TextTruncatedCount } Else { 0 }
            Text                 = if ($TextCount) { $TextCount } Else { 0 }
            "TBA Skipped"        = if ($SkipTBACount) { $SkipTBACount } Else { 0 }
            "Jap/Chines Skipped" = if ($SkipJapTitleCount) { $SkipJapTitleCount } Else { 0 }
            "Notification Sent"  = if ($global:SendNotification -eq 'true') { $global:SendNotification } Else { "false" }
            "Uptime Kuma"        = if ($global:UptimeKumaUrl) { "true" } Else { "false" }
            "Images cleared"     = if ($ImagesCleared) { $ImagesCleared } Else { 0 }
            "Folders Cleared"    = if ($PathsCleared) { $PathsCleared } Else { 0 }
            "Space saved"        = if ($savedsizestring) { $savedsizestring } Else { 0 }
            "Script Version"     = $CurrentScriptVersion
            "IM Version"         = $global:CurrentImagemagickversion
            "Start time"         = $startTime.ToString('dd.MM.yyyy HH:mm:ss')
            "End Time"           = $endTime.ToString('dd.MM.yyyy HH:mm:ss')
        }

        $jsonOutput = $jsonObject | ConvertTo-Json
        $jsonOutput | Out-File -FilePath "$global:ScriptRoot\Logs\$Mode.json" -Encoding utf8

        # Clear Running File
        if (Test-Path $CurrentlyRunning) {
            try {
                Remove-Item -LiteralPath $CurrentlyRunning -ErrorAction Stop | Out-Null
            }
            catch {
                Write-Entry -Message "Failed to delete '$CurrentlyRunning'." -Path $global:configLogging -Color Red -log Error
                Write-Entry -Subtext "Reason: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            }
        }
        if ($global:UptimeKumaUrl) {
            Send-UptimeKumaWebhook -status "up" -ping $executionTime.TotalMilliseconds
        }
    }
    elseif ($UsePlex -eq 'true') {
        $Library = $Libs.mediaContainer.Directory | Where-Object { $_.key -eq $Metadata.MediaContainer.$contentquery.librarySectionID }
        $metadatatemp = $Metadata.MediaContainer.$contentquery.guid.id
        $tmdbpattern = 'tmdb://(\d+)'
        $imdbpattern = 'imdb://tt(\d+)'
        $tvdbpattern = 'tvdb://(\d+)'
        if ($Metadata.MediaContainer.$contentquery.Location) {
            $location = $Metadata.MediaContainer.$contentquery.Location.path
            if ($location.count -gt '1') {
                $location = $location[0]
                $MultipleVersions = $true
            }
            Else {
                $MultipleVersions = $false
            }
            $libpaths = $($Library.location.path).split(',')
            Write-Entry -Subtext "Plex Lib Paths before split: $($Library.location.path)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "Plex Lib Paths after split: $libpaths" -Path $global:configLogging -Color Cyan -log Debug
            foreach ($libpath in $libpaths) {
                if ($location -like "$libpath/*" -or $location -like "$libpath\*") {
                    Write-Entry -Subtext "Location: $location" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "Libpath: $libpath" -Path $global:configLogging -Color Cyan -log Debug
                    $Matchedpath = AddTrailingSlash $libpath
                    $libpath = $Matchedpath
                    $relativePath = $location.Substring($libpath.Length)
                    $pathSegments = $relativePath -split '[\\/]'

                    # Determine the extracted folder and the root folder path
                    if ($pathSegments.Count -gt 2) {
                        $extractedFolder = $pathSegments[-2]  # Second-to-last segment is the folder containing the file
                        $extraFolder = $pathSegments[0]  # All segments up to the extracted folder
                    }
                    else {
                        $extractedFolder = $pathSegments[0]  # Only one segment, it's the folder
                        $extraFolder = $null  # No parent structure
                    }
                    Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug
                    continue
                }
            }
        }
        Else {
            $location = $Metadata.MediaContainer.$contentquery.media.part.file

            if ($location.count -gt '1') {
                Write-Entry -Subtext "Multi File Locations: $location" -Path $global:configLogging -Color Cyan -log Debug
                $location = $location[0]
                $MultipleVersions = $true
            }
            Else {
                $MultipleVersions = $false
            }
            Write-Entry -Subtext "File Location: $location" -Path $global:configLogging -Color Cyan -log Debug

            if ($location.length -ge '256' -and $Platform -eq 'Windows') {
                $CheckCharLimit = CheckCharLimit
                if ($CheckCharLimit -eq $false) {
                    Write-Entry -Subtext "Skipping [$($Metadata.MediaContainer.$contentquery.title)] because path length is over '256'..." -Path $global:configLogging -Color Yellow -log Warning
                    Write-Entry -Subtext "You can adjust it by following this: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation?tabs=registry#enable-long-paths-in-windows-10-version-1607-and-later" -Path $global:configLogging -Color Yellow -log Warning
                    continue
                }
            }

            $libpaths = $($Library.location.path).split(',')
            Write-Entry -Subtext "Plex Lib Paths before split: $($Library.location.path)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "Plex Lib Paths after split: $libpaths" -Path $global:configLogging -Color Cyan -log Debug
            foreach ($libpath in $libpaths) {
                if ($location -like "$libpath/*" -or $location -like "$libpath\*") {
                    Write-Entry -Subtext "Location: $location" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "Libpath: $libpath" -Path $global:configLogging -Color Cyan -log Debug
                    $Matchedpath = AddTrailingSlash $libpath
                    $libpath = $Matchedpath
                    $relativePath = $location.Substring($libpath.Length)
                    $pathSegments = $relativePath -split '[\\/]'

                    # Determine the extracted folder and the root folder path
                    if ($pathSegments.Count -gt 2) {
                        $extractedFolder = $pathSegments[-2]  # Second-to-last segment is the folder containing the file
                        $extraFolder = $pathSegments[0]  # All segments up to the extracted folder
                    }
                    else {
                        $extractedFolder = $pathSegments[0]  # Only one segment, it's the folder
                        $extraFolder = $null  # No parent structure
                    }
                    Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug
                    continue
                }
            }
        }
        if ($Seasondata) {
            $SeasonsTemp = $Seasondata.MediaContainer.Directory | Where-Object { $_.Title -ne 'All episodes' }
            $SeasonNames = $SeasonsTemp.Title -join ';'
            $SeasonNumbers = $SeasonsTemp.index -join ','
            $SeasonRatingkeys = $SeasonsTemp.ratingKey -join ','
            $SeasonPosterUrl = ($SeasonsTemp | Where-Object { $_.type -eq "season" }).thumb -join ','
        }
        $matchesimdb = [regex]::Matches($metadatatemp, $imdbpattern)
        $matchestmdb = [regex]::Matches($metadatatemp, $tmdbpattern)
        $matchestvdb = [regex]::Matches($metadatatemp, $tvdbpattern)
        if ($matchesimdb.value) { $imdbid = $matchesimdb.value.Replace('imdb://', '') }Else { $imdbid = $null }
        if ($matchestmdb.value) { $tmdbid = $matchestmdb.value.Replace('tmdb://', '') }Else { $tmdbid = $null }
        if ($matchestvdb.value) { $tvdbid = $matchestvdb.value.Replace('tvdb://', '') }Else { $tvdbid = $null }

        # check if there are more then 1 entry in idÂ´s
        if ($tvdbid.count -gt '1') { $tvdbid = $tvdbid[0] }
        if ($tmdbid.count -gt '1') { $tmdbid = $tmdbid[0] }
        if ($imdbid.count -gt '1') { $imdbid = $imdbid[0] }

        if ($Metadata.MediaContainer.$contentquery.Label.tag) {
            $Labels = $($Metadata.MediaContainer.$contentquery.Label.tag -join ',')
        }
        Else {
            $Labels = ""
        }
        $FileMetadata = $Metadata.MediaContainer.$contentquery.media.part.stream
        $Resolution = $null
        # Get Resolution
        if ($FileMetadata) {
            $FileMetadata | ForEach-Object {
                if ($_.streamType -eq '1') {
                    $Resolution = $_.displayTitle
                }
            }
        }
        $temp = New-Object psobject
        $temp | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $Library.title
        $temp | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $Metadata.MediaContainer.$contentquery.type
        $temp | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $($Library.language.split("-")[0])
        $temp | Add-Member -MemberType NoteProperty -Name "title" -Value $Metadata.MediaContainer.$contentquery.title
        if ($FileMetadata) {
            $temp | Add-Member -MemberType NoteProperty -Name "Resolution" -Value $Resolution
        }
        $temp | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $Metadata.MediaContainer.$contentquery.originalTitle
        $temp | Add-Member -MemberType NoteProperty -Name "SeasonNames" -Value $SeasonNames
        $temp | Add-Member -MemberType NoteProperty -Name "SeasonNumbers" -Value $SeasonNumbers
        $temp | Add-Member -MemberType NoteProperty -Name "SeasonRatingKeys" -Value $SeasonRatingkeys
        $temp | Add-Member -MemberType NoteProperty -Name "year" -Value $Metadata.MediaContainer.$contentquery.year
        $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $tvdbid
        $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $imdbid
        $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $tmdbid
        $temp | Add-Member -MemberType NoteProperty -Name "ratingKey" -Value $Metadata.MediaContainer.$contentquery.ratingKey
        $temp | Add-Member -MemberType NoteProperty -Name "Path" -Value $Matchedpath
        $temp | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $extractedFolder
        $temp | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $extraFolder
        $temp | Add-Member -MemberType NoteProperty -Name "MultipleVersions" -Value $MultipleVersions
        $temp | Add-Member -MemberType NoteProperty -Name "PlexPosterUrl" -Value $Metadata.MediaContainer.$contentquery.thumb
        $temp | Add-Member -MemberType NoteProperty -Name "PlexBackgroundUrl" -Value $Metadata.MediaContainer.$contentquery.art
        $temp | Add-Member -MemberType NoteProperty -Name "PlexSeasonUrls" -Value $SeasonPosterUrl
        $temp | Add-Member -MemberType NoteProperty -Name "Labels" -Value $Labels
        $Libraries.Add($temp)
        Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
        $AllShows = $Libraries | Where-Object { $_.'Library Type' -eq 'show' }
        $AllMovies = $Libraries | Where-Object { $_.'Library Type' -eq 'movie' }

        if ($global:TitleCards -eq 'true') {
            Write-Entry -Message "Query episodes data..." -Path $global:configLogging -Color White -log Info
            # Query episode info
            $Episodedata = [System.Collections.Generic.List[object]]::new()
            foreach ($showentry in $AllShows) {
                # Getting child entries for each season
                $splittedkeys = $showentry.SeasonRatingKeys.split(',')
                foreach ($key in $splittedkeys) {
                    [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$key/children? -Headers $extraPlexHeaders).content
                    $FileMetadata = $Seasondata.MediaContainer.video.media
                    $Resolution = $null
                    # Get Resolution
                    if ($FileMetadata) {
                        $ResolutionList = [System.Collections.Generic.List[object]]::new()
                        $FileMetadata | ForEach-Object {
                            $Resolution = $_.videoResolution
                            $ResolutionList.Add($Resolution)
                        }
                        $Resolution = $ResolutionList -join ","
                    }
                    $tempseasondata = New-Object psobject
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Show Name" -Value $Seasondata.MediaContainer.grandparentTitle
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Type" -Value $Seasondata.MediaContainer.viewGroup
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $showentry.tvdbid
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $showentry.tmdbid
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $showentry.imdbid
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $showentry.'Library Name'
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $showentry.'Library Language'
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Season Number" -Value $Seasondata.MediaContainer.parentIndex
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Episodes" -Value $($Seasondata.MediaContainer.video.index -join ',')
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Title" -Value $($Seasondata.MediaContainer.video.title -join ';')
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "RatingKeys" -Value $($Seasondata.MediaContainer.video.ratingKey -join ',')
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "PlexTitleCardUrls" -Value $($Seasondata.MediaContainer.video.thumb -join ',')
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $showentry.RootFoldername
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $showentry.extraFolder
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "ShowRatingKey" -Value $showentry.ratingKey
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "ShowId" -Value $showentry.Id
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Path" -Value $showentry.Path
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "PlexBackgroundUrl" -Value $showentry.PlexBackgroundUrl
                    if ($FileMetadata) {
                        $tempseasondata | Add-Member -MemberType NoteProperty -Name "Resolutions" -Value $Resolution
                    }
                    $Episodedata.Add($tempseasondata)
                    Write-Entry -Subtext "Found [$($tempseasondata.'Show Name')] of type $($tempseasondata.Type) for season $($tempseasondata.'Season Number')" -Path $global:configLogging -Color Cyan -log Debug
                }
            }
            if ($Episodedata) {
                Write-Entry -Subtext "Found '$($Episodedata.Episodes.split(',').count)' Episodes..." -Path $global:configLogging -Color Cyan -log Info
            }
        }

        # Store all Files from asset dir in a hashtable
        $directoryHashtable = Get-AssetHashtable
        # Download poster foreach movie
        Write-Entry -Message "Starting asset creation now, this can take a while..." -Path $global:configLogging -Color White -log Info
        Write-Entry -Message "Starting Movie Poster Creation part..." -Path $global:configLogging -Color Green -log Info
        $global:checkedItems = [System.Collections.Concurrent.ConcurrentBag[object]]::new()

        $globalState = [System.Collections.Hashtable]::Synchronized(@{})
        Get-Variable | Where-Object {
            $_.Options -notmatch 'ReadOnly|Constant' -and
            $_.Name -notin @('FormatEnumerationLimit', 'MaximumHistoryCount', 'Host', 'Error', 'PWD', 'HOME', 'PID', 'globalState', 'AllMovies', 'AllShows', 'Libraries', 'Libs', 'OtherMediaServerLibs', 'Metadata', 'Seasondata', '_', 'PSItem')
        } | ForEach-Object {
            $globalState[$_.Name] = $_.Value
        }

        $sbStr = [System.Text.StringBuilder]::new()
        foreach ($key in $globalState.Keys) {
            $safeKey = $key -replace "'", "''"
            [void]$sbStr.Append("`${global:$key} = `$state['$safeKey']; ")
        }
        $global:StateAssignerStr = $sbStr.ToString()

        # Movie Part
        if ($AllMovies) {
            $AllMovies | ForEach-Object -Parallel {
            $state = $using:globalState
            if (-not (Get-Command "Runspace-Initialized" -ErrorAction SilentlyContinue)) {
                $functionFiles = Get-ChildItem -Path "$($state['AppRoot'])/modules/functions" -Filter "*.ps1"
                foreach ($funcFile in $functionFiles) { . $funcFile.FullName }
                if ($state['FanartTvAPIKey']) {
                    Import-Module -Name Celerium.FanartTV -ErrorAction SilentlyContinue
                    Add-FanartTVAPIKey -ProjectKey $state['FanartTvAPIKey'] -ErrorAction SilentlyContinue
                }
                function Runspace-Initialized {}
            }
            $StateAssignerSb = [scriptblock]::Create($using:StateAssignerStr)
            & $StateAssignerSb

            Invoke-MoviePosterCreation -entry $_
        } -ThrottleLimit $(if ($config.PrerequisitePart.ParallelJobs) { $config.PrerequisitePart.ParallelJobs } else { 5 })
        }

    $global:SkipTBACount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SkipTBACount'] = 0 }
    $global:SkipJapTitleCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SkipJapTitleCount'] = 0 }
    
    # Initialize Summary Counts to prevent leakage between scheduled runs
    $FallbackCount = $null
    $TextlessCount = $null
    $TextTruncatedCount = $null
    $TextCount = $null

        Write-Entry -Message "Starting Show/Season Poster/Background/TitleCard Creation part..." -Path $global:configLogging -Color Green -log Info
        # Show Part
        if ($AllShows) {
            $AllShows | ForEach-Object -Parallel {
            $state = $using:globalState
            if (-not (Get-Command "Runspace-Initialized" -ErrorAction SilentlyContinue)) {
                $functionFiles = Get-ChildItem -Path "$($state['AppRoot'])/modules/functions" -Filter "*.ps1"
                foreach ($funcFile in $functionFiles) { . $funcFile.FullName }
                if ($state['FanartTvAPIKey']) {
                    Import-Module -Name Celerium.FanartTV -ErrorAction SilentlyContinue
                    Add-FanartTVAPIKey -ProjectKey $state['FanartTvAPIKey'] -ErrorAction SilentlyContinue
                }
                function Runspace-Initialized {}
            }
            $StateAssignerSb = [scriptblock]::Create($using:StateAssignerStr)
            & $StateAssignerSb

            Invoke-ShowPosterCreation -entry $_
        } -ThrottleLimit $(if ($config.PrerequisitePart.ParallelJobs) { $config.PrerequisitePart.ParallelJobs } else { 5 })
        }

        if ($global:TitleCards -eq 'true' -and $Episodedata) {
            Write-Entry -Message "Starting TitleCard Creation part..." -Path $global:configLogging -Color Green -log Info
            $Episodedata | ForEach-Object -Parallel {
                $state = $using:globalState
                if (-not (Get-Command "Runspace-Initialized" -ErrorAction SilentlyContinue)) {
                    $functionFiles = Get-ChildItem -Path "$($state['AppRoot'])/modules/functions" -Filter "*.ps1"
                    foreach ($funcFile in $functionFiles) { . $funcFile.FullName }
                    if ($state['FanartTvAPIKey']) {
                        Import-Module -Name Celerium.FanartTV -ErrorAction SilentlyContinue
                        Add-FanartTVAPIKey -ProjectKey $state['FanartTvAPIKey'] -ErrorAction SilentlyContinue
                    }

                function Runspace-Initialized {}
            }
            $StateAssignerSb = [scriptblock]::Create($using:StateAssignerStr)
            & $StateAssignerSb

                Invoke-TitleCardCreation -episode $_
            } -ThrottleLimit $(if ($config.PrerequisitePart.ParallelJobs) { $config.PrerequisitePart.ParallelJobs } else { 5 })
        }
        $endTime = Get-Date
        $executionTime = New-TimeSpan -Start $startTime -End $endTime
        # Format the execution time
        $hours = [math]::Floor($executionTime.TotalHours)
        $minutes = $executionTime.Minutes
        $seconds = $executionTime.Seconds
        $FormattedTimespawn = $hours.ToString() + "h " + $minutes.ToString() + "m " + $seconds.ToString() + "s "
    Sync-GlobalStats
    Write-Entry -Message "Finished, Total images created: $posterCount" -Path $global:configLogging -Color Green -log Info
        if ($posterCount -ge '1') {
            Write-Entry -Message "Show/Movie Posters created: $($posterCount-$SeasonCount-$BackgroundCount-$EpisodeCount)| Season images created: $SeasonCount | Background images created: $BackgroundCount | TitleCards created: $EpisodeCount" -Path $global:configLogging -Color Green -log Info
        }
        if ((Test-Path $global:ScriptRoot\Logs\ImageChoices.csv)) {
            Write-Entry -Message "You can find a detailed Summary of image Choices here: $global:ScriptRoot\Logs\ImageChoices.csv" -Path $global:configLogging -Color White -log Info
            # Calculate Summary
            $SummaryCount = Import-Csv -LiteralPath "$global:ScriptRoot\Logs\ImageChoices.csv" -Delimiter ';'
            $FallbackCount = @($SummaryCount | Where-Object Fallback -eq 'true')
            $TextlessCount = @($SummaryCount | Where-Object Language -eq 'Textless')
            $TextTruncatedCount = @($SummaryCount | Where-Object TextTruncated -eq 'true')
            $TextCount = @($SummaryCount | Where-Object Textless -eq 'false')
            if ($TextlessCount -or $FallbackCount -or $TextCount -or $PosterUnknownCount -or $TextTruncatedCount) {
                Write-Entry -Message "This is a subset summary of all image choices from the ImageChoices.csv" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextlessCount) {
                Write-Entry -Subtext "'$($TextlessCount.count)' times the script took a Textless image" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($FallbackCount) {
                Write-Entry -Subtext "'$($FallbackCount.count)' times the script took a fallback image" -Path $global:configLogging -Color Yellow -log Info
                Write-Entry -Subtext "'$($posterCount-$FallbackCount.count)' times the script took the image from fav provider: $global:FavProvider" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextCount) {
                Write-Entry -Subtext "'$($TextCount.count)' times the script took an image with Text" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($PosterUnknownCount -ge '1') {
                Write-Entry -Subtext "'$PosterUnknownCount' times the script took a season poster where we cannot tell if it has text or not" -Path $global:configLogging -Color Yellow -log Info
            }
            if ($TextTruncatedCount) {
                Write-Entry -Subtext "'$($TextTruncatedCount.count)' times the script truncated the text in images" -Path $global:configLogging -Color Yellow -log Info
            }
        }
        if ($errorCount -ge '1') {
            Write-Entry -Message "During execution '$errorCount' Errors occurred, please check the log for a detailed description where you see [ERROR-HERE]." -Path $global:configLogging -Color White -log Info
        }
        if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\ImageChoices.csv" -ErrorAction SilentlyContinue)) {
            $ImageChoicesDummycsv = New-Object psobject

            # Add members to the object with empty values
            $ImageChoicesDummycsv = New-Object psobject
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Title" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Type" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Language" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Manual" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $null
            $ImageChoicesDummycsv | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $null

            $ImageChoicesDummycsv | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
            Write-Entry -Message "No ImageChoices.csv found, creating dummy file for you..." -Path $global:configLogging -Color White -log Info
        }
        Write-TextSizeCacheSummary
        Write-Entry -Message "Script execution time: $FormattedTimespawn" -Path $global:configLogging -Color White -log Info

        # Send Notification
        # Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $errorCount -FallbackCount $FallbackCount.count -TextlessCount $TextlessCount.count -TruncatedCount $TextTruncatedCount.count -PosterUnknownCount $PosterUnknownCount -SkipTBACount $SkipTBACount -SkipJapTitleCount $SkipJapTitleCount -PosterCount $posterCount -BackgroundCount $BackgroundCount -SeasonCount $SeasonCount -EpisodeCount $EpisodeCount

        # Export json
        $jsonObject = [PSCustomObject]@{
            Posters              = if ($posterCount) { $posterCount } Else { 0 }
            Backgrounds          = if ($BackgroundCount) { $BackgroundCount } Else { 0 }
            Titlecards           = if ($EpisodeCount) { $EpisodeCount } Else { 0 }
            Seasons              = if ($SeasonCount) { $SeasonCount } Else { 0 }
            Collections          = if ($collectionCount) { $collectionCount } Else { 0 }
            Mode                 = $Mode
            Runtime              = $($hours.ToString() + ":" + $minutes.ToString() + ":" + $seconds.ToString())
            Errors               = if ($errorCount) { $errorCount } Else { 0 }
            Fallbacks            = if ($FallbackCount) { $FallbackCount } Else { 0 }
            Textless             = if ($TextlessCount) { $TextlessCount } Else { 0 }
            Truncated            = if ($TextTruncatedCount) { $TextTruncatedCount } Else { 0 }
            Text                 = if ($TextCount) { $TextCount } Else { 0 }
            "TBA Skipped"        = if ($SkipTBACount) { $SkipTBACount } Else { 0 }
            "Jap/Chines Skipped" = if ($SkipJapTitleCount) { $SkipJapTitleCount } Else { 0 }
            "Notification Sent"  = if ($global:SendNotification -eq 'true') { $global:SendNotification } Else { "false" }
            "Uptime Kuma"        = if ($global:UptimeKumaUrl) { "true" } Else { "false" }
            "Images cleared"     = if ($ImagesCleared) { $ImagesCleared } Else { 0 }
            "Folders Cleared"    = if ($PathsCleared) { $PathsCleared } Else { 0 }
            "Space saved"        = if ($savedsizestring) { $savedsizestring } Else { 0 }
            "Script Version"     = $CurrentScriptVersion
            "IM Version"         = $global:CurrentImagemagickversion
            "Start time"         = $startTime.ToString('dd.MM.yyyy HH:mm:ss')
            "End Time"           = $endTime.ToString('dd.MM.yyyy HH:mm:ss')
        }

        $jsonOutput = $jsonObject | ConvertTo-Json
        $jsonOutput | Out-File -FilePath "$global:ScriptRoot\Logs\$Mode.json" -Encoding utf8

        # Clear Running File
        if (Test-Path $CurrentlyRunning) {
            try {
                Remove-Item -LiteralPath $CurrentlyRunning -ErrorAction Stop | Out-Null
            }
            catch {
                Write-Entry -Message "Failed to delete '$CurrentlyRunning'." -Path $global:configLogging -Color Red -log Error
                Write-Entry -Subtext "Reason: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            }
        }
        if ($global:UptimeKumaUrl) {
            Send-UptimeKumaWebhook -status "up" -ping $executionTime.TotalMilliseconds
        }
    }
    Else {
        Write-Entry -Message "No Media Server selected, please check your settings..." -Path $global:configLogging -Color Red -log Error
        Exit
    }





