#region Emby/Jelly Mode
    $global:posterCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['posterCount'] = 0 }
    $global:SeasonCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SeasonCount'] = 0 }
    $global:EpisodeCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['EpisodeCount'] = 0 }
    $global:BackgroundCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['BackgroundCount'] = 0 }
    $global:PosterUnknownCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['PosterUnknownCount'] = 0 }
    $global:SkipTBACount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SkipTBACount'] = 0 }
    $global:SkipJapTitleCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SkipJapTitleCount'] = 0 }
    
    # Initialize Summary Counts to prevent leakage between scheduled runs
    $FallbackCount = $null
    $TextlessCount = $null
    $TextTruncatedCount = $null
    $TextCount = $null

    if ($UISchedule -or $ContainerSchedule) {
        $Mode = "scheduled"
        Write-Entry -Message "Scheduled Mode Started..." -Path $global:configLogging -Color White -log Info
    }
    Else {
        $Mode = "normal"
        Write-Entry -Message "Normal Mode Started..." -Path $global:configLogging -Color White -log Info
    }

    Write-Entry -Message "Query Jellyfin/Emby..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Query all items from all Libs, this can take a while..." -Path $global:configLogging -Color White -log Info
    $retryCount = 0
    $maxRetries = 3
    $AllLibs = $null
    
    while ($retryCount -le $maxRetries) {
        try {
            $PreferredMetadataLanguage = (Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/System/Configuration" -Headers $global:OtherMediaServerHeaders -ErrorAction Stop).PreferredMetadataLanguage ?? "en"
            $allLibsquery = "$($OtherMediaServerUrl.TrimEnd('/'))/Library/VirtualFolders"
            $AllLibs = Invoke-RestMethod -Method Get -Uri $allLibsquery -Headers $global:OtherMediaServerHeaders -ErrorAction Stop
        } catch { }

        $validLibs = @($AllLibs | Where-Object { $_.Name -notin $LibstoExclude })
        if ($validLibs.Count -ge 1) {
            break
        }

        $retryCount++
        if ($retryCount -le $maxRetries) {
            Write-Entry -Subtext "0 libraries were found. Retrying in 10 seconds... (Attempt $retryCount/$maxRetries)" -Path $global:configLogging -Color Yellow -log Warning
            Start-Sleep -Seconds 10
        }
    }

    $validLibs = @($AllLibs | Where-Object { $_.Name -notin $LibstoExclude })
    if ($validLibs.Count -lt 1) {
        Write-Entry -Subtext "0 libraries were found after $($maxRetries) retries. Are you on the correct server?" -Path $global:configLogging -Color Red -log Error
        HandleScriptExit -Message "No libs found"
    }

    write-Entry -Subtext "Found '$($AllLibs.count)' libs and '$(@($LibstoExclude).count)' are excluded..." -Path $global:configLogging -Color Cyan -log Info
    $IncludedLibraryNames = $validLibs.Name -join ', '
    Write-Entry -Subtext "Included Libraries: $IncludedLibraryNames" -Path $global:configLogging -Color Cyan -log Info

    # Build path-based lookup tables once to avoid expensive per-item Ancestors API calls.
    $MovieLibraryLookup = [System.Collections.Generic.List[object]]::new()
    $ShowLibraryLookup = [System.Collections.Generic.List[object]]::new()
    foreach ($library in $AllLibs) {
        if ($library.Name -in $LibstoExclude) { continue }

        $resolvedLocations = [System.Collections.Generic.List[string]]::new()
        foreach ($location in @($library.Locations)) {
            $effectiveLocation = $location
            if ($UseEmby -eq 'true' -and $library.LibraryOptions -and $library.LibraryOptions.PathInfos) {
                $pathInfo = $library.LibraryOptions.PathInfos | Where-Object { $_.Path -eq $location } | Select-Object -First 1
                if ($pathInfo -and $pathInfo.NetworkPath) {
                    $effectiveLocation = $pathInfo.NetworkPath
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($effectiveLocation)) {
                [void]$resolvedLocations.Add([string]$effectiveLocation)
            }
        }

        if ($resolvedLocations.Count -eq 0) { continue }

        $lookupEntry = [PSCustomObject]@{
            Name      = $library.Name
            Locations = $resolvedLocations
        }

        if ($library.CollectionType -eq 'movies') {
            $MovieLibraryLookup.Add($lookupEntry)
        }
        elseif ($library.CollectionType -eq 'tvshows') {
            $ShowLibraryLookup.Add($lookupEntry)
        }
    }

    # Debug Output all Libs
    Write-Entry -Subtext "Media Server Lib overview..." -Path $global:configLogging -Color Cyan -log Debug
    Foreach ($lib in $AllLibs) {
        Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "  Lib name: $($lib.name)" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "  Lib Type: $($lib.CollectionType)" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "  Lib locations: $($lib.Locations)" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
    }
    $AllMovies = [System.Collections.Generic.List[object]]::new()
    $AllShows = [System.Collections.Generic.List[object]]::new()
    $AllEpisodes = [System.Collections.Generic.List[object]]::new()
    foreach ($slib in $AllLibs) {
        if ($slib.Name -notin $LibstoExclude) {
            if ($slib.CollectionType -eq 'movies') {
                Write-Entry -Subtext "Getting all Itmes from [$($slib.Name)] with item id [$($slib.ItemId)]" -Path $global:configLogging -Color Cyan -log Debug
                $allMoviesquery = "$OtherMediaServerUrl/Items?ParentId=$($slib.ItemId)&Recursive=true&Fields=ProviderIds,OriginalTitle,Settings,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&IncludeItemTypes=Movie"
                $Querytemp = Invoke-RestMethod -Method Get -Uri $allMoviesquery -Headers $global:OtherMediaServerHeaders
                $AllMovies.Add($Querytemp)
            }
            if ($slib.CollectionType -eq 'tvshows') {
                Write-Entry -Subtext "Getting all Itmes from [$($slib.Name)] with item id [$($slib.ItemId)]" -Path $global:configLogging -Color Cyan -log Debug
                $allShowsquery = "$OtherMediaServerUrl/Items?ParentId=$($slib.ItemId)&Recursive=true&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&IncludeItemTypes=Series"
                $allEpisodesquery = "$OtherMediaServerUrl/Items?ParentId=$($slib.ItemId)&Recursive=true&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,Settings,Tags,Width,Height,MediaStreams&IncludeItemTypes=Episode"
                $Querytempshow = Invoke-RestMethod -Method Get -Uri $allShowsquery -Headers $global:OtherMediaServerHeaders
                $QuerytempEpisodes = Invoke-RestMethod -Method Get -Uri $allEpisodesquery -Headers $global:OtherMediaServerHeaders
                $AllShows.Add($Querytempshow)
                $AllEpisodes.Add($QuerytempEpisodes)
            }
        }
    }

    $Libraries = [System.Collections.Generic.List[object]]::new()
    $movieQueryCounter = 0
    foreach ($Movie in $AllMovies.Items) {
        $movieQueryCounter++
        if (($movieQueryCounter % 200) -eq 0) {
            Start-Sleep -Milliseconds 1
        }
        $Resolution = $null
        $SingleLibName = $null
        $Matchedpath = $null

        foreach ($singlelibrary in $MovieLibraryLookup) {
            foreach ($location in $singlelibrary.Locations) {
                Write-Entry -Subtext "  Found location - '$($location)'" -Path $global:configLogging -Color Cyan -log Debug
                if ($Movie.Path -like "$($location)/*" -or $Movie.Path -like "$($location)\*") {
                    $SingleLibName = $singlelibrary.Name
                    $Matchedpath = AddTrailingSlash $location
                    Write-Entry -Subtext "  Single lib name is: '$($SingleLibName)'" -Path $global:configLogging -Color Cyan -log Debug
                    break
                }
            }
            if ($SingleLibName) { break }
        }

        if (-not $SingleLibName -or -not $Matchedpath) {
            Write-Entry -Subtext "No matching library path found for [$($Movie.Name)] at [$($Movie.Path)]" -Path $global:configLogging -Color Yellow -log Debug
            continue
        }

        if ($UseEmby -eq 'true') {
            if ($SingleLibName -notin $LibstoExclude) {
                Write-Entry -Subtext "Location: $($Movie.Path)" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "Libpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
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
                        Write-Entry -Subtext "[$($movie.Name)] Raw Video Description: $($videoStream.ExtendedVideoSubTypeDescription)" -Path $global:configLogging -Color Cyan -log Debug
                        if ($videoStream.ExtendedVideoSubTypeDescription -match 'Profile.*HDR10') {
                            $hdrType = 'DOVIHDR10'
                        }
                    }
                    Else {
                        Write-Entry -Subtext "[$($movie.Name)] Raw Video Description: $($videoStream.ExtendedVideoType)" -Path $global:configLogging -Color Cyan -log Debug
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
            if ($SingleLibName -notin $LibstoExclude) {
                Write-Entry -Subtext "Location: $($Movie.Path)" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "Libpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
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
                    Write-Entry -Subtext "[$($movie.Name)] Raw Video Description: $($videoStream.VideoRangeType)" -Path $global:configLogging -Color Cyan -log Debug
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
    $showQueryCounter = 0
    foreach ($Show in $AllShows.Items) {
        $showQueryCounter++
        if (($showQueryCounter % 200) -eq 0) {
            Start-Sleep -Milliseconds 1
        }
        $SingleLibName = $null
        $Matchedpath = $null
        foreach ($singlelibrary in $ShowLibraryLookup) {
            foreach ($location in $singlelibrary.Locations) {
                Write-Entry -Subtext "  Found location - '$($location)'" -Path $global:configLogging -Color Cyan -log Debug
                if ($Show.Path -like "$location/*" -or $Show.Path -like "$location\*") {
                    $SingleLibName = $singlelibrary.Name
                    $Matchedpath = AddTrailingSlash $location
                    Write-Entry -Subtext "  Single lib name is: '$($SingleLibName)'" -Path $global:configLogging -Color Cyan -log Debug
                    break
                }
            }
            if ($SingleLibName) { break }
        }

        if (-not $SingleLibName -or -not $Matchedpath) {
            Write-Entry -Subtext "No matching library path found for [$($Show.Name)] at [$($Show.Path)]" -Path $global:configLogging -Color Yellow -log Debug
            continue
        }

        if ($SingleLibName -notin $LibstoExclude) {
            Write-Entry -Subtext "Location: $($Show.Path)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "Libpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
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
    $Libraries | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\OtherMediaServerLibExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    Write-Entry -Message "Export everything to a csv: $global:ScriptRoot\Logs\OtherMediaServerLibExport.csv" -Path $global:configLogging -Color White -log Info

    Write-Entry -Message "Starting episode data query now - This can take a while..." -Path $global:configLogging -Color Cyan -Log Info

    $Episodedata = [System.Collections.Generic.List[object]]::new()
    $EpisodesBySeriesId = @{}
    foreach ($episode in $AllEpisodes.Items) {
        if (-not $episode.SeriesId) { continue }
        $seriesIdKey = [string]$episode.SeriesId
        if (-not $EpisodesBySeriesId.ContainsKey($seriesIdKey)) {
            $EpisodesBySeriesId[$seriesIdKey] = [System.Collections.Generic.List[object]]::new()
        }
        $EpisodesBySeriesId[$seriesIdKey].Add($episode)
    }
    $TempShowLibs = $Libraries | Where-Object { $_."Library Type" -eq 'Series' }
    foreach ($show in $TempShowLibs) {
        # Initialize lists to hold season properties for the show object
        $showSeasonIds = [System.Collections.Generic.List[string]]::new()
        $showSeasonNumbers = [System.Collections.Generic.List[string]]::new()
        $showSeasonNames = [System.Collections.Generic.List[string]]::new()
        $showSeasonUrls = [System.Collections.Generic.List[string]]::new()

        # Use pre-grouped data by SeriesId to avoid repeatedly scanning the full episode list.
        $seriesEpisodes = @()
        $showIdKey = [string]$show.id
        if ($EpisodesBySeriesId.ContainsKey($showIdKey)) {
            $seriesEpisodes = $EpisodesBySeriesId[$showIdKey]
        }
        $seasons = $seriesEpisodes | Group-Object -Property SeasonName | Sort-Object -Property Name
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
                    Write-Entry -Subtext "[$($show.title) - S$(([int]$ep.ParentIndexNumber).ToString('00'))E$(([int]$ep.IndexNumber).ToString('00')) - $($ep.Name)] Raw Video Description: $($currentRange)" -Path $global:configLogging -Color Cyan -log Debug
                    if ($UseEmby -eq 'true' -and $vid.ExtendedVideoSubTypeDescription -and $vid.ExtendedVideoSubTypeDescription -ne 'None') {
                        Write-Entry -Subtext "[$($show.title) - S$(([int]$ep.ParentIndexNumber).ToString('00'))E$(([int]$ep.IndexNumber).ToString('00')) - $($ep.Name)] Raw Sub Video Description: $($vid.ExtendedVideoSubTypeDescription)" -Path $global:configLogging -Color Cyan -log Debug
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
            if ($null -ne $SeasonEpisodes.SeriesId) {
                if ($SeasonEpisodes.SeriesId -is [System.Array]) {
                    $ShowID = $SeasonEpisodes.SeriesId[0]
                }
                else {
                    $ShowID = $SeasonEpisodes.SeriesId
                }
            }
            else {
                $ShowID = $null
            }

            if ($null -ne $SeasonEpisodes.SeasonId) {
                if ($SeasonEpisodes.SeasonId -is [System.Array]) {
                    $SeasonId = $SeasonEpisodes.SeasonId[0]
                }
                else {
                    $SeasonId = $SeasonEpisodes.SeasonId
                }
            }
            else {
                $SeasonId = $null
            }

            $OtherMediaServerTitleCardUrlsList = [System.Collections.Generic.List[string]]::new()
            foreach ($epId in ($EpisodeIds -split ',')) {
                if ($epId) {
                    $OtherMediaServerTitleCardUrlsList.Add("$OtherMediaServerUrl/Items/$epId/Images/Primary")
                }
            }
            $OtherMediaServerTitleCardUrls = $OtherMediaServerTitleCardUrlsList -join ','

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
                "EpisodeVideoRanges"           = $EpisodeVideoRanges
                "tvdbid"                       = $show.tvdbid
                "imdbid"                       = $show.imdbid
                "tmdbid"                       = $show.tmdbid
                "type"                         = "Episode"
                "Season Number"                = $SeasonEpisodes[0].ParentIndexNumber
                "SeasonName"                   = $Season.Name
                "Episodes"                     = $Episodes
                "Title"                        = $EpisodeTitles
                "OtherMediaServerTitleCardUrls"= $OtherMediaServerTitleCardUrls
                "OtherMediaServerTitleCardTag" = $Thumbs
                "RootFoldername"               = $show.RootFoldername
                "extraFolder"                  = $show.extraFolder
                "Path"                         = $show.Path
                "OtherMediaServerBackgroundUrl"= $show.OtherMediaServerBackgroundUrl
                "OtherMediaServerSeasonTag"    = $SeasonEpisodes[0].SeriesPrimaryImageTag
            }

            # Add the season object to the array
            $Episodedata.Add($seasonObject)

            # Add to show-level collections
            if ($SeasonId) { $showSeasonIds.Add($SeasonId) }
            $showSeasonNumbers.Add($SeasonEpisodes[0].ParentIndexNumber)
            $showSeasonNames.Add($Season.Name)
            if ($SeasonId) { $showSeasonUrls.Add("$OtherMediaServerUrl/Items/$SeasonId/Images/Primary") }
        }

        # Append collected season metadata to the parent show object
        $show | Add-Member -MemberType NoteProperty -Name "SeasonNames" -Value ($showSeasonNames -join ';') -Force
        $show | Add-Member -MemberType NoteProperty -Name "SeasonRatingKeys" -Value ($showSeasonIds -join ',') -Force
        $show | Add-Member -MemberType NoteProperty -Name "seasonNumbers" -Value ($showSeasonNumbers -join ',') -Force
        $show | Add-Member -MemberType NoteProperty -Name "OtherMediaServerSeasonUrls" -Value ($showSeasonUrls -join ',') -Force
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
                'OtherMediaServerTitleCardUrls'= $data.'OtherMediaServerTitleCardUrls'
                'OtherMediaServerTitleCardTag' = $data.'OtherMediaServerTitleCardTag'
                'OtherMediaServerSeasonTag'    = $data.'OtherMediaServerSeasonTag'
                'RootFoldername'               = $data.'RootFoldername'
                'extraFolder'                  = $data.'extraFolder'
                'Path'                         = $data.'Path'
                'OtherMediaServerBackgroundUrl'= $data.'OtherMediaServerBackgroundUrl'
            })
    }

    # Export the formatted data to CSV
    $FormattedData | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\OtherMediaServerEpisodeExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
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

    Write-Entry -Message "Starting Show/Season Poster/Background/TitleCard Creation part..." -Path $global:configLogging -Color Green -log Info
    # Show Part
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

    if ($global:TitleCards -eq 'true') {
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
    # Asset Cleanup
    if ($AssetCleanup -eq 'true') {
        $ImagesCleared = 0
        $PathsCleared = 0
        $savedsizestring = 0
        Write-Entry -Subtext "Starting Asset Cleanup, this can take some time..." -Path $global:configLogging -Color Yellow -log Info
        Write-Entry -Subtext "Only removing Artwork with posterizarr exif data" -Path $global:configLogging -Color Cyan -log Info
        $processedDirectories = [System.Collections.Generic.List[object]]::new()
        $checkedItemsLookup = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($checkedItem in $checkedItems) {
            [void]$checkedItemsLookup.Add([string]$checkedItem)
        }

        # Perform deletion of unchecked items
        foreach ($uncheckedItem in $directoryHashtable.Keys) {
            if ($checkedItemsLookup.Contains([string]$uncheckedItem)) { continue }

            if ($uncheckedItem -notlike '*.jpg') {
                # Full path to the item
                $uncheckedItemPath = $uncheckedItem + ".jpg"

                if (Test-IsPosterizarrAsset -Path $uncheckedItemPath) {
                    Remove-Item -LiteralPath $uncheckedItemPath -Force
                    $ImagesCleared++
                    Write-Entry -Subtext "Artwork Removed: $uncheckedItemPath" -Path $global:configLogging -Color Yellow -log Info

                    if ($LibraryFolders -eq 'true') {
                        # Determine the parent directory of the item
                        $parentDir = Split-Path -Path $uncheckedItemPath -Parent

                        # Add the directory to the list if it's not already included
                        if ($parentDir -notin $processedDirectories) {
                            $processedDirectories.Add($parentDir)
                        }
                    }
                }
            }
        }

        # Cleanup empty Asset dirs
        if ($LibraryFolders -eq 'true') {
            # After all files are removed get all empty directories at once
            $dirs2delete = Get-ChildItem -LiteralPath $AssetPath -Recurse -Directory -Force | Where-Object { -not $_.GetFileSystemInfos() }

            # Loop through the pre-filtered list
            foreach ($dir in $dirs2delete) {
                # Increment counter
                $PathsCleared++
                # Remove the empty directory
                Remove-Item -LiteralPath $dir.FullName -Force -Confirm:$false | Out-Null

                # Log the action
                Write-Entry -Subtext "Removed empty directory: $($dir.FullName)" -Path $global:configLogging -Color Yellow -log Info
            }
        }
        if ($ImagesCleared -ge '1' -or $PathsCleared -ge '1') {
            Write-Entry -Message "Asset Cleanup overview..." -Path $global:configLogging -Color Green -log Info
        }
        # Check new dir Size
        if ($ImagesCleared -ge '1') {
            $newtotalSize = Get-ChildItem $AssetPath -Recurse | Measure-Object -Property Length -Sum
            # Convert bytes to kilobytes, megabytes, or gigabytes as needed
            if ($newtotalSize.Sum -gt 1GB) {
                $newtotalSizeString = "{0:N2} GB" -f ($newtotalSize.Sum / 1GB)
            }
            elseif ($newtotalSize.Sum -gt 1MB) {
                $newtotalSizeString = "{0:N2} MB" -f ($newtotalSize.Sum / 1MB)
            }
            elseif ($newtotalSize.Sum -gt 1KB) {
                $newtotalSizeString = "{0:N2} KB" -f ($newtotalSize.Sum / 1KB)
            }
            else {
                $newtotalSizeString = "$($newtotalSize.Sum) bytes"
            }

            # Saved space
            $SavedSpace = $global:totalSize - $newtotalSize.Sum

            # Convert bytes to kilobytes, megabytes, or gigabytes as needed
            if ($SavedSpace -gt 1GB) {
                $savedsizestring = "{0:N2} GB" -f ($SavedSpace / 1GB)
            }
            elseif ($SavedSpace -gt 1MB) {
                $savedsizestring = "{0:N2} MB" -f ($SavedSpace / 1MB)
            }
            elseif ($SavedSpace -gt 1KB) {
                $savedsizestring = "{0:N2} KB" -f ($SavedSpace / 1KB)
            }
            else {
                $savedsizestring = "$SavedSpace bytes"
            }

            if ($ImagesCleared -ge '1') {
                Write-Entry -Subtext "Images Cleared: $ImagesCleared" -Path $global:configLogging -Color White -log Info
            }
            Else {
                Write-Entry -Subtext "Images Cleared: 0" -Path $global:configLogging -Color White -log Info
            }
        }
        if ($PathsCleared -ge '1') {
            if ($PathsCleared -ge '1') {
                Write-Entry -Subtext "Empty Folders Cleared: $PathsCleared" -Path $global:configLogging -Color White -log Info
            }
            Else {
                Write-Entry -Subtext "Empty Folders Cleared: 0" -Path $global:configLogging -Color White -log Info
            }
        }
        if ($ImagesCleared -ge '1') {
            Write-Entry -Subtext "Cleanup saved: $savedsizestring" -Path $global:configLogging -Color Green -log Info
        }
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

    # Send Notification
    $argFallback = if ($FallbackCount -is [array]) { $FallbackCount.count } else { 0 }
    $argTextless = if ($TextlessCount -is [array]) { $TextlessCount.count } else { 0 }
    $argTruncated = if ($TextTruncatedCount -is [array]) { $TextTruncatedCount.count } else { 0 }
    Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $errorCount -FallbackCount $argFallback -TextlessCount $argTextless -TruncatedCount $argTruncated -PosterUnknownCount $PosterUnknownCount -SkipTBACount $SkipTBACount -SkipJapTitleCount $SkipJapTitleCount -PosterCount $posterCount -BackgroundCount $BackgroundCount -SeasonCount $SeasonCount -EpisodeCount $EpisodeCount -ImagesCleared $ImagesCleared -PathsCleared $PathsCleared -SavedSizeString $savedsizestring -UploadCount $UploadCount

    # Calculate Counts
    $CalculatedCount = $($posterCount - $SeasonCount - $BackgroundCount - $EpisodeCount)

    # Export json
    $jsonObject = [PSCustomObject]@{
        Posters              = if ($CalculatedCount) { $CalculatedCount } Else { 0 }
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


