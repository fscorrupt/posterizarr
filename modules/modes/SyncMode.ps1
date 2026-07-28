#region Sync Mode
    # Initialize counter variable
    $global:posterCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['posterCount'] = 0 }
    $global:SeasonCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SeasonCount'] = 0 }
    $global:EpisodeCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['EpisodeCount'] = 0 }
    $global:BackgroundCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['BackgroundCount'] = 0 }
    $global:UploadCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['UploadCount'] = 0 }

    [xml]$Libs = CheckPlexAccess -PlexUrl $PlexUrl
    $LibstoExclude = $config.PlexPart.LibstoExclude

    if ($SyncJelly) {
        # Check Jellyfin now:
        CheckJellyfinAccess -JellyfinUrl $JellyfinUrl -JellyfinApi $JellyfinAPIKey
        $OtherMediaServerUrl = $JellyfinUrl
        $OtherMediaServerApiKey = $JellyfinAPIKey
        $Mode = "syncjelly"
        Write-Entry -Message "Sync Jelly Mode Started..." -Path $global:configLogging -Color White -log Info
    }
    if ($SyncEmby) {
        # Check Emby now:
        CheckEmbyAccess -EmbyUrl $EmbyUrl -EmbyAPI $EmbyAPIKey
        $OtherMediaServerUrl = $EmbyUrl
        $OtherMediaServerApiKey = $EmbyAPIKey
        $Mode = "syncemby"
        Write-Entry -Message "Sync Emby Mode Started..." -Path $global:configLogging -Color White -log Info
    }

    Write-Entry -Message "Query plex libs..." -Path $global:configLogging -Color White -log Info
    $retryCount = 0
    $maxRetries = 3
    $Libsoverview = [System.Collections.Generic.List[object]]::new()

    while ($retryCount -le $maxRetries) {
        $Libsoverview.Clear()
        if ($Libs -and $Libs.MediaContainer.Directory) {
            foreach ($lib in @($Libs.MediaContainer.Directory)) {
                if ($lib.title -notin $LibstoExclude) {
                    $libtemp = New-Object psobject
                    $libtemp | Add-Member -MemberType NoteProperty -Name "ID" -Value $lib.key
                    $libtemp | Add-Member -MemberType NoteProperty -Name "Name" -Value $lib.title
                    $libtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $lib.language

                    # Check if $lib.location.path is an array
                    if ($lib.location.path -is [array]) {
                        $paths = $lib.location.path -join ',' # Convert array to string
                        $libtemp | Add-Member -MemberType NoteProperty -Name "Path" -Value $paths
                    }
                    else {
                        $libtemp | Add-Member -MemberType NoteProperty -Name "Path" -Value $lib.location.path
                    }
                    # Check if Libname has chars we cant use for Folders
                    if ($lib.title -notmatch "^[^\/:*?`"<>\|\\}]+$") {
                        Write-Entry -Message  "Lib: '$($lib.title)' contains invalid characters." -Path $global:configLogging -Color Red -log Error
                        Write-Entry -Subtext "Please rename your lib and remove all chars that are listed here: '/, :, *, ?, `", <, >, |, \, or }'" -Path $global:configLogging -Color Yellow -log Warning
                        # Clear Running File
                        HandleScriptExit -Message "Lib contains invalid chars"
                    }
                    $Libsoverview.Add($libtemp)
                }
            }
        }

        if ($($Libsoverview.count) -ge 1) {
            break
        }

        $retryCount++
        if ($retryCount -le $maxRetries) {
            Write-Entry -Subtext "0 libraries were found. Retrying in 10 seconds... (Attempt $retryCount/$maxRetries)" -Path $global:configLogging -Color Yellow -log Warning
            Start-Sleep -Seconds 10
            try {
                $result = Invoke-WebRequest -Uri "$PlexUrl/library/sections" -ErrorAction SilentlyContinue -Headers $extraPlexHeaders
                if ($result -and $result.StatusCode -eq 200) {
                    [XML]$Libs = $result.Content
                }
            }
            catch { }
        }
    }

    if ($($Libsoverview.count) -lt 1) {
        Write-Entry -Subtext "0 libraries were found after $($maxRetries) retries. Are you on the correct Plex server?" -Path $global:configLogging -Color Red -log Error
        # Clear Running File
        HandleScriptExit -Message "No libs found"
    }
    Write-Entry -Subtext "Found '$($Libsoverview.count)' libs and '$($LibstoExclude.count)' are excluded..." -Path $global:configLogging -Color Cyan -log Info
    $IncludedLibraryNames = $Libsoverview.Name -join ', '
    Write-Entry -Subtext "Included Libraries: $IncludedLibraryNames" -Path $global:configLogging -Color Cyan -log Info
    Write-Entry -Message "Query all items from all Libs, this can take a while..." -Path $global:configLogging -Color White -log Info
    $Libraries = [System.Collections.Generic.List[object]]::new()
    Foreach ($Library in $Libsoverview) {
        if ($Library.Name -notin $LibstoExclude) {
            $PlexHeaders = @{}
            if ($PlexToken) {
                $PlexHeaders['X-Plex-Token'] = $PlexToken
            }

            # Create a parent XML document
            $Libcontent = New-Object -TypeName System.Xml.XmlDocument
            $mediaContainerNode = $Libcontent.CreateElement('MediaContainer')
            $Libcontent.AppendChild($mediaContainerNode) | Out-Null

            # Initialize variables for pagination
            $searchsize = 0
            $totalContentSize = 1

            # Loop until all content is retrieved
            do {
                # Set headers for the current request
                $PlexHeaders['X-Plex-Container-Start'] = $searchsize
                $PlexHeaders['X-Plex-Container-Size'] = '1000'

                # Fetch content from Plex server
                $response = Invoke-WebRequest -Uri "$PlexUrl/library/sections/$($Library.ID)/all" -Headers $PlexHeaders

                # Convert response content to XML
                [xml]$additionalContent = $response.Content

                # Get total content size if not retrieved yet
                if ($totalContentSize -eq 1) {
                    $totalContentSize = $additionalContent.MediaContainer.totalSize
                }

                # Import and append video nodes to the parent XML document
                $contentquery = if ($additionalContent.MediaContainer.video) {
                    'video'
                }
                else {
                    'Directory'
                }
                foreach ($videoNode in $additionalContent.MediaContainer.$contentquery) {
                    $importedNode = $Libcontent.ImportNode($videoNode, $true)
                    [void]$mediaContainerNode.AppendChild($importedNode)
                }

                # Update search size for next request
                $searchsize += [int]$additionalContent.MediaContainer.Size
            } until ($searchsize -ge $totalContentSize)
            if ($Libcontent.MediaContainer.video) {
                $contentquery = 'video'
            }
            Else {
                $contentquery = 'Directory'
            }
            $itemQueryCounter = 0
            foreach ($item in $Libcontent.MediaContainer.$contentquery) {
                $itemQueryCounter++
                if (($itemQueryCounter % 200) -eq 0) {
                    Start-Sleep -Milliseconds 1
                }
                $extractedFolder = $null
                $Seasondata = $null
                $Metadata = $null
                $needSeasonData = ($contentquery -eq 'Directory')
                $needFullMetadata = $false

                $metadataDoc = New-Object System.Xml.XmlDocument
                $metadataRoot = $metadataDoc.CreateElement('MediaContainer')
                $metadataDoc.AppendChild($metadataRoot) | Out-Null
                $importedItemNode = $metadataDoc.ImportNode($item, $true)
                $metadataRoot.AppendChild($importedItemNode) | Out-Null
                $Metadata = $metadataDoc

                if ($contentquery -eq 'video' -or $contentquery -eq 'Directory') {
                    $itemNode = $Metadata.MediaContainer.$contentquery
                    $itemGuid = $itemNode.guid.id
                    $itemLocation = $itemNode.Location.path
                    if (-not $itemLocation) {
                        $itemLocation = $itemNode.media.part.file
                    }
                    if (-not $itemGuid -or -not $itemLocation) {
                        $needFullMetadata = $true
                    }
                }

                if ($needFullMetadata) {
                    try {
                        [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($item.ratingKey) -Headers $extraPlexHeaders).content
                    }
                    catch {
                        Write-Entry -Subtext "Current Metadata Plex Query: $($PlexUrl[0..10] -join '')****/library/metadata/$($item.ratingKey)" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "An error occurred during Plex query: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        $isConnRefused = $_.Exception.Message -match "(Connection refused|Name or service not known)"
                        if ($isConnRefused) {
                            $global:ConnRefusedCount = Increment-GlobalStat 'ConnRefusedCount'
                        }
                        if ($isConnRefused -and $ConnRefusedCount -ge 3) {
                            HandleScriptExit -Message "[FATAL] Connection refused 3 times. Terminating script."
                        }
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                        continue
                    }
                }

                if ($needSeasonData) {
                    try {
                        [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$($item.ratingKey)/children? -Headers $extraPlexHeaders).content
                    }
                    catch {
                        Write-Entry -Subtext "Current Seasondata Plex Query: $($PlexUrl[0..10] -join '')****/library/metadata/$($item.ratingKey)/children?" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "An error occurred during Plex query: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        $isConnRefused = $_.Exception.Message -match "(Connection refused|Name or service not known)"
                        if ($isConnRefused) {
                            $global:ConnRefusedCount = Increment-GlobalStat 'ConnRefusedCount'
                        }
                        if ($isConnRefused -and $ConnRefusedCount -ge 3) {
                            HandleScriptExit -Message "[FATAL] Connection refused 3 times. Terminating script."
                        }
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                    }
                }
                $metadatatemp = $Metadata.MediaContainer.$contentquery.guid.id
                $tmdbpattern = 'tmdb://(\d+)'
                $imdbpattern = 'imdb://tt(\d+)'
                $tvdbpattern = 'tvdb://(\d+)'
                if ($Metadata.MediaContainer.$contentquery.Location) {
                    $location = $Metadata.MediaContainer.$contentquery.Location.path
                    if ($location) {
                        $location = $location.replace('\\?\', '')
                    }
                    if ($location.count -gt '1') {
                        $location = $location[0]
                        $MultipleVersions = $true
                    }
                    Else {
                        $MultipleVersions = $false
                    }
                    $libpaths = $($Library.path).split(',')
                    Write-Entry -Subtext "Plex Lib Paths before split: $($Library.path)" -Path $global:configLogging -Color Cyan -log Debug
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
                    if ($location) {
                        $location = $location.replace('\\?\', '')
                    }
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
                            Write-Entry -Subtext "Skipping [$($item.title)] because path length is over '256'..." -Path $global:configLogging -Color Yellow -log Warning
                            Write-Entry -Subtext "You can adjust it by following this: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation?tabs=registry#enable-long-paths-in-windows-10-version-1607-and-later" -Path $global:configLogging -Color Yellow -log Warning
                            continue
                        }
                    }

                    $libpaths = $($Library.path).split(',')
                    Write-Entry -Subtext "Plex Lib Paths before split: $($Library.path)" -Path $global:configLogging -Color Cyan -log Debug
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

                # check if there are more then 1 entry in id´s
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
                $temp | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $Library.Name
                $temp | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $Metadata.MediaContainer.$contentquery.type
                $temp | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $($Library.language.split("-")[0])
                $temp | Add-Member -MemberType NoteProperty -Name "title" -Value $($item.title)
                if ($FileMetadata) {
                    $temp | Add-Member -MemberType NoteProperty -Name "Resolution" -Value $Resolution
                }
                $temp | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $($item.originalTitle)
                $temp | Add-Member -MemberType NoteProperty -Name "SeasonNames" -Value $SeasonNames
                $temp | Add-Member -MemberType NoteProperty -Name "SeasonNumbers" -Value $SeasonNumbers
                $temp | Add-Member -MemberType NoteProperty -Name "SeasonRatingKeys" -Value $SeasonRatingkeys
                $temp | Add-Member -MemberType NoteProperty -Name "year" -Value $item.year
                $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $tvdbid
                $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $imdbid
                $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $tmdbid
                $temp | Add-Member -MemberType NoteProperty -Name "ratingKey" -Value $item.ratingKey
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
            }
        }
    }
    Write-Entry -Subtext "Found '$($Libraries.count)' Items..." -Path $global:configLogging -Color Cyan -log Info

    $AllShows = $Libraries | Where-Object { $_.'Library Type' -eq 'show' }
    $AllMovies = $Libraries | Where-Object { $_.'Library Type' -eq 'movie' }

    # Getting information of all Episodes
    if ($global:TitleCards -eq 'true') {
        Write-Entry -Message "Query episodes data from all Libs, this can take a while..." -Path $global:configLogging -Color White -log Info
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
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $showentry.'Library Name'
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "Season Number" -Value $Seasondata.MediaContainer.parentIndex
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "Episodes" -Value $($Seasondata.MediaContainer.video.index -join ',')
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "Title" -Value $($Seasondata.MediaContainer.video.title -join ';')
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "RatingKeys" -Value $($Seasondata.MediaContainer.video.ratingKey -join ',')
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "PlexTitleCardUrls" -Value $($Seasondata.MediaContainer.video.thumb -join ',')
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

    # Query Jellyfin/Emby
    Write-Entry -Message "Query Jellyfin/Emby..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Query all items from all Libs, this can take a while..." -Path $global:configLogging -Color White -log Info
    $PreferredMetadataLanguage = (Invoke-RestMethod -Method Get -Uri "$($OtherMediaServerUrl.TrimEnd('/'))/System/Configuration" -Headers $global:OtherMediaServerHeaders).PreferredMetadataLanguage ?? "en"
    $allLibsquery = "$($OtherMediaServerUrl.TrimEnd('/'))/Library/VirtualFolders"
    $OtherAllLibs = Invoke-RestMethod -Method Get -Uri $allLibsquery -Headers $global:OtherMediaServerHeaders

    write-Entry -Subtext "Found '$($OtherAllLibs.name.count)' libs and '$(@($LibstoExclude).count)' are excluded..." -Path $global:configLogging -Color Cyan -log Info
    $IncludedLibraryNames = ($OtherAllLibs | Where-Object { $_.Name -notin $LibstoExclude }).Name -join ', '
    Write-Entry -Subtext "Included Libraries: $IncludedLibraryNames" -Path $global:configLogging -Color Cyan -log Info

    # Build path-based lookup tables once to avoid expensive per-item Ancestors API calls.
    $OtherMovieLibraryLookup = [System.Collections.Generic.List[object]]::new()
    $OtherShowLibraryLookup = [System.Collections.Generic.List[object]]::new()
    foreach ($library in $OtherAllLibs) {
        if ($library.Name -in $LibstoExclude) { continue }

        $resolvedLocations = [System.Collections.Generic.List[string]]::new()
        foreach ($location in @($library.Locations)) {
            $effectiveLocation = $location
            if ($SyncEmby -and $library.LibraryOptions -and $library.LibraryOptions.PathInfos) {
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
            $OtherMovieLibraryLookup.Add($lookupEntry)
        }
        elseif ($library.CollectionType -eq 'tvshows') {
            $OtherShowLibraryLookup.Add($lookupEntry)
        }
    }

    # Debug Output all Libs
    Write-Entry -Subtext "Media Server Lib overview..." -Path $global:configLogging -Color Cyan -log Debug
    Foreach ($lib in $OtherAllLibs) {
        Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "  Lib name: $($lib.name)" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "  Lib Type: $($lib.CollectionType)" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "  Lib locations: $($lib.Locations)" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
    }

    $OtherAllMovies = [System.Collections.Generic.List[object]]::new()
    $OtherAllShows = [System.Collections.Generic.List[object]]::new()
    $OtherAllEpisodes = [System.Collections.Generic.List[object]]::new()

    foreach ($otherlib in $OtherAllLibs) {
        if ($otherlib.Name -notin $LibstoExclude) {
            if ($otherlib.CollectionType -eq 'movies') {
                Write-Entry -Subtext "Getting all Itmes from [$($otherlib.Name)] with item id [$($otherlib.ItemId)]" -Path $global:configLogging -Color Cyan -log Debug
                $allMoviesquery = "$OtherMediaServerUrl/Items?ParentId=$($otherlib.ItemId)&Recursive=true&Fields=ProviderIds,OriginalTitle,Settings,Path,Overview,ProductionYear,Tags&IncludeItemTypes=Movie"
                $Querytemp = Invoke-RestMethod -Method Get -Uri $allMoviesquery -Headers $global:OtherMediaServerHeaders
                $OtherAllMovies.Add($Querytemp)
            }
            if ($otherlib.CollectionType -eq 'tvshows') {
                Write-Entry -Subtext "Getting all Itmes from [$($otherlib.Name)] with item id [$($otherlib.ItemId)]" -Path $global:configLogging -Color Cyan -log Debug
                $allShowsquery = "$OtherMediaServerUrl/Items?ParentId=$($otherlib.ItemId)&Recursive=true&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags&IncludeItemTypes=Series"
                $allEpisodesquery = "$OtherMediaServerUrl/Items?ParentId=$($otherlib.ItemId)&Recursive=true&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,Settings,Tags&IncludeItemTypes=Episode"
                $Querytempshow = Invoke-RestMethod -Method Get -Uri $allShowsquery -Headers $global:OtherMediaServerHeaders
                $QuerytempEpisodes = Invoke-RestMethod -Method Get -Uri $allEpisodesquery -Headers $global:OtherMediaServerHeaders
                $OtherAllShows.Add($Querytempshow)
                $OtherAllEpisodes.Add($QuerytempEpisodes)
            }
        }
    }

    $OtherLibraries = [System.Collections.Generic.List[object]]::new()
    $otherMovieQueryCounter = 0
    foreach ($Movie in $OtherAllMovies.Items) {
        $otherMovieQueryCounter++
        if (($otherMovieQueryCounter % 200) -eq 0) {
            Start-Sleep -Milliseconds 1
        }
        $SingleLibName = $null
        $Matchedpath = $null
        foreach ($singlelibrary in $OtherMovieLibraryLookup) {
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

        if ($SyncEmby) {
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
            $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $Movie.ProviderIds.Imdb
            $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $Movie.ProviderIds.Tmdb
            $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $Movie.ProviderIds.Tvdb
            $temp | Add-Member -MemberType NoteProperty -Name "Path" -Value $libpath
            $temp | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $extractedFolder
            $temp | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $extraFolder
            $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerPosterUrl" -Value $Movie.ImageTags.Primary
            $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerBackgroundUrl" -Value $($Movie.BackdropImageTags -join ",")
            $temp | Add-Member -MemberType NoteProperty -Name "Labels" -Value $Labels
            $OtherLibraries.Add($temp)
            Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
        }
        Else {
            Write-Entry -Subtext "Processing - '$($Movie.Name)'" -Path $global:configLogging -Color Cyan -log Debug
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
                Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug
            }
            if ($Movie.Tags) {
                $Labels = $($Movie.Tags -join ',')
            }
            Else {
                $Labels = ""
            }
            $temp = New-Object psobject
            $temp | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $SingleLibName
            $temp | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $Movie.Type
            $temp | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $PreferredMetadataLanguage
            $temp | Add-Member -MemberType NoteProperty -Name "Id" -Value $Movie.Id
            $temp | Add-Member -MemberType NoteProperty -Name "title" -Value $Movie.Name
            $temp | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $Movie.OriginalTitle
            $temp | Add-Member -MemberType NoteProperty -Name "year" -Value $Movie.ProductionYear
            $temp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $Movie.ProviderIds.Imdb
            $temp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $Movie.ProviderIds.Tmdb
            $temp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $Movie.ProviderIds.Tvdb
            $temp | Add-Member -MemberType NoteProperty -Name "Path" -Value $libpath
            $temp | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $extractedFolder
            $temp | Add-Member -MemberType NoteProperty -Name "extraFolder" -Value $extraFolder
            $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerPosterUrl" -Value $Movie.ImageTags.Primary
            $temp | Add-Member -MemberType NoteProperty -Name "OtherMediaServerBackgroundUrl" -Value $($Movie.BackdropImageTags -join ",")
            $temp | Add-Member -MemberType NoteProperty -Name "Labels" -Value $Labels
            $OtherLibraries.Add($temp)
            Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
        }
    }
    $otherShowQueryCounter = 0
    foreach ($Show in $OtherAllShows.Items) {
        $otherShowQueryCounter++
        if (($otherShowQueryCounter % 200) -eq 0) {
            Start-Sleep -Milliseconds 1
        }
        $SingleLibName = $null
        $Matchedpath = $null
        foreach ($singlelibrary in $OtherShowLibraryLookup) {
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
        Write-Entry -Subtext "Matchedpath: $Matchedpath" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "ExtractedFolder: $extractedFolder" -Path $global:configLogging -Color Cyan -log Debug

        if ($Show.Tags) {
            $Labels = $($Show.Tags -join ',')
        }
        Else {
            $Labels = ""
        }

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
        $OtherLibraries.Add($temp)
        Write-Entry -Subtext "Found [$($temp.title)] of type $($temp.{Library Type}) in [$($temp.{Library Name})]" -Path $global:configLogging -Color Cyan -log Debug
        Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
    }
    Write-Entry -Subtext "Found '$($OtherLibraries.count)' Items..." -Path $global:configLogging -Color Cyan -log Info
    $OtherEpisodedata = [System.Collections.Generic.List[object]]::new()
    $OtherEpisodesBySeriesId = @{}
    foreach ($episode in $OtherAllEpisodes.Items) {
        if (-not $episode.SeriesId) { continue }
        $seriesIdKey = [string]$episode.SeriesId
        if (-not $OtherEpisodesBySeriesId.ContainsKey($seriesIdKey)) {
            $OtherEpisodesBySeriesId[$seriesIdKey] = [System.Collections.Generic.List[object]]::new()
        }
        $OtherEpisodesBySeriesId[$seriesIdKey].Add($episode)
    }
    $TempShowLibs = $OtherLibraries | Where-Object { $_."Library Type" -eq 'Series' }
    foreach ($show in $TempShowLibs) {
        # Use pre-grouped data by SeriesId to avoid repeatedly scanning the full episode list.
        $seriesEpisodes = @()
        $showIdKey = [string]$show.id
        if ($OtherEpisodesBySeriesId.ContainsKey($showIdKey)) {
            $seriesEpisodes = $OtherEpisodesBySeriesId[$showIdKey]
        }
        $seasons = $seriesEpisodes | Group-Object -Property SeasonName | Sort-Object -Property Name
        foreach ($Season in $Seasons) {
            # Sort episodes within the season by IndexNumber
            $SeasonEpisodes = $Season.Group | Sort-Object -Property indexnumber

            # Collect episode IDs, Titles, and PrimaryImageTags
            $EpisodeIds = ($SeasonEpisodes.Id -join ',')
            $EpisodeTitles = ($SeasonEpisodes.Name -join ';')
            $Episodes = ($SeasonEpisodes.IndexNumber -join ',')
            $Thumbs = ($SeasonEpisodes.ImageTags.Primary -join ',')

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


            # Create an object for the current season
            $seasonObject = [PSCustomObject]@{
                "Library Name"                 = $show."Library Name"
                "Show Name"                    = $show.title
                "Show Original Name"           = $show.OriginalTitle
                "Library Language"             = $PreferredMetadataLanguage
                "ShowID"                       = $ShowID
                "SeasonId"                     = $SeasonId
                "EpisodeIds"                   = $EpisodeIds
                "tvdbid"                       = $show.tvdbid
                "imdbid"                       = $show.imdbid
                "tmdbid"                       = $show.tmdbid
                "type"                         = "Episode"
                "Season Number"                = $SeasonEpisodes[0].ParentIndexNumber
                "SeasonName"                   = $Season.Name
                "Episodes"                     = $Episodes
                "Title"                        = $EpisodeTitles
                "OtherMediaServerTitleCardTag" = $Thumbs
                "OtherMediaServerSeasonTag"    = $SeasonEpisodes[0].SeriesPrimaryImageTag
            }

            # Add the season object to the array
            $OtherEpisodedata.Add($seasonObject)
        }
    }
    if ($OtherAllEpisodes) {
        Write-Entry -Subtext "Found '$($OtherAllEpisodes.items.count)' Episodes..." -Path $global:configLogging -Color Cyan -log Info
    }

    $OtherAllShows = $OtherLibraries | Where-Object { $_.'Library Type' -eq 'Series' }
    $OtherAllMovies = $OtherLibraries | Where-Object { $_.'Library Type' -eq 'Movie' }

    # Create an empty array to hold the custom objects
    $FormattedData = [System.Collections.Generic.List[object]]::new()

    # Iterate over each item in $OtherEpisodedata
    foreach ($data in $OtherEpisodedata) {
        # Create a custom object for each episode using the variables
        $FormattedData.Add([PSCustomObject]@{
                'Library Name'                 = $data.'Library Name'
                'Show Name'                    = $data.'Show Name'
                'Show Original Name'           = $data.'Show Original Name'
                'Library Language'             = $data.'Library Language'
                'ShowID'                       = $data.'ShowID'
                'SeasonId'                     = $data.'SeasonId'
                'EpisodeIds'                   = $data.'EpisodeIds'
                'tvdbid'                       = $data.'tvdbid'
                'imdbid'                       = $data.'imdbid'
                'tmdbid'                       = $data.'tmdbid'
                'type'                         = $data.'type'
                'Season Number'                = $data.'Season Number'
                'SeasonName'                   = $data.'SeasonName'
                'Episodes'                     = $data.'Episodes'
                'Title'                        = $data.'Title'
                'OtherMediaServerTitleCardTag' = $data.'OtherMediaServerTitleCardTag'
                'OtherMediaServerSeasonTag'    = $data.'OtherMediaServerSeasonTag'
            })
    }

    # Export the formatted data to CSV
    $FormattedData | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\OtherEpisodedata.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    $OtherLibraries | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\OtherLibraries.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    $Episodedata | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\Episodedata.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    $Libraries | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\Libraries.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force

    # START HERE
    Write-Entry -Message "Starting artwork sync now, this can take a while..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Starting movie artwork sync part..." -Path $global:configLogging -Color Green -log Info

    # Movie Part
    foreach ($entry in $AllMovies) {
        try {
            # check if item has skip label
            if ($entry.labels -match 'skip_posterizarr') {
                Write-Entry -Message "Skipping '$($entry.title)' because it has a skip label..." -Path $global:configLogging -Color Yellow -log Warning
            }
            Else {
                # Now we can start the Poster Part
                if ($global:Posters -eq 'true') {
                    $global:posterurl = $null
                    $global:PosterWithText = $null
                    if ($null -ne $entry.PlexPosterUrl) {
                        if ($entry.PlexPosterUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexPosterUrl
                        }

                        # Attempt to match by ID (preferred)
                        $matchingMovie = $OtherAllMovies | Where-Object {
                            $_."Library Name" -eq $entry."Library Name" -and (
                                ($null -ne $entry.TmdbId -and $_.TmdbId -eq $entry.TmdbId) -or
                                ($null -ne $entry.TvdbId -and $_.TvdbId -eq $entry.TvdbId) -or
                                ($null -ne $entry.ImdbId -and $_.ImdbId -eq $entry.ImdbId)
                            )
                        }

                        # If no ID match, fall back to Title
                        if ($null -eq $matchingMovie) {
                            $warningMsg = "No ID match for '$($entry.title)'."
                            $warningMsg += " Source IDs (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId), ImdbId: $($entry.ImdbId)). Falling back to Title match..."
                            Write-Entry -Subtext $warningMsg -Path $global:configLogging -Color Yellow -log Warning

                            $matchingMovie = $OtherAllMovies | Where-Object {
                                $_."Library Name" -eq $entry."Library Name" -and
                                $_.Title -eq $entry.Title
                            }
                            if ($matchingMovie) {
                                Write-Entry -Subtext "Fallback to Title match SUCCESSFUL for '$($entry.title)'." -Path $global:configLogging -Color Cyan -log Debug
                            }
                        }

                        if ($matchingMovie) {
                            $MovieTitle = $entry.Title
                            $imageType = "Primary"
                            Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Movie Title: $MovieTitle" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Type: $imageType" -Path $global:configLogging -Color Cyan -log Debug
                            if ($matchingMovie.id.Count -gt 1) {
                                foreach ($id in $matchingMovie.id) {
                                    $DestUrl = "$OtherMediaServerUrl/items/$id/images/$imageType/"
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $MovieTitle -artworktype 'poster'
                                    Write-Entry -Subtext "Movie ID: $id" -Path $global:configLogging -Color Cyan -log Debug
                                }
                            }
                            Else {
                                $DestUrl = "$OtherMediaServerUrl/items/$($matchingMovie.id)/images/$imageType/"
                                if ($matchingMovie.id) {
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $MovieTitle -artworktype 'poster'
                                    Write-Entry -Subtext "Movie ID: $($matchingMovie.id)" -Path $global:configLogging -Color Cyan -log Debug
                                }
                                Else {
                                    Write-Entry -Message "Could not find Movie ID for '$MovieTitle' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                        }
                        Else {
                            $errorMsg = "Could not match movie '$($entry.title)' in '$($entry.'Library Name')' by ID or Title."
                            $errorMsg += " Source (Plex) IDs were (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId), ImdbId: $($entry.ImdbId)). Please check destination library metadata."
                            Write-Entry -Subtext $errorMsg -Path $global:configLogging -Color Red -log Error
                        }
                    }
                    Else {
                        Write-Entry -Message "Could not find Poster URL for '$($entry.title)' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                        Write-Entry -Message "Please fix the metadata on the source media server to resolve this issue." -Path $global:configLogging -Color Red -log Error
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                    }

                }
                # Now we can start the Background Poster Part
                if ($global:BackgroundPosters -eq 'true') {
                    $global:posterurl = $null
                    $global:PosterWithText = $null
                    # check if Background url id exists.
                    if ($null -ne $entry.PlexBackgroundUrl) {
                        if ($entry.PlexBackgroundUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexBackgroundUrl
                        }

                        # Attempt to match by ID (preferred)
                        $matchingMovie = $OtherAllMovies | Where-Object {
                            $_."Library Name" -eq $entry."Library Name" -and (
                                ($null -ne $entry.TmdbId -and $_.TmdbId -eq $entry.TmdbId) -or
                                ($null -ne $entry.TvdbId -and $_.TvdbId -eq $entry.TvdbId) -or
                                ($null -ne $entry.ImdbId -and $_.ImdbId -eq $entry.ImdbId)
                            )
                        }

                        # If no ID match, fall back to Title
                        if ($null -eq $matchingMovie) {
                            $warningMsg = "No ID match for '$($entry.title) (Background)'."
                            $warningMsg += " Source IDs (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId), ImdbId: $($entry.ImdbId)). Falling back to Title match..."
                            Write-Entry -Subtext $warningMsg -Path $global:configLogging -Color Yellow -log Warning

                            $matchingMovie = $OtherAllMovies | Where-Object {
                                $_."Library Name" -eq $entry."Library Name" -and
                                $_.Title -eq $entry.Title
                            }

                            if ($matchingMovie) {
                                Write-Entry -Subtext "Fallback to Title match SUCCESSFUL for '$($entry.title) (Background)'." -Path $global:configLogging -Color Cyan -log Debug
                            }
                        }

                        if ($matchingMovie) {
                            $MovieTitle = $entry.Title + " | Background"
                            $imageType = "Backdrop"
                            Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Movie Title: $MovieTitle" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Type: $imageType" -Path $global:configLogging -Color Cyan -log Debug
                            if ($matchingMovie.id.Count -gt 1) {
                                foreach ($id in $matchingMovie.id) {
                                    $DestUrl = "$OtherMediaServerUrl/items/$id/images/$imageType/"
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $MovieTitle -artworktype 'background'
                                    Write-Entry -Subtext "Movie ID: $id" -Path $global:configLogging -Color Cyan -log Debug
                                }
                            }
                            Else {
                                $DestUrl = "$OtherMediaServerUrl/items/$($matchingMovie.id)/images/$imageType/"
                                if ($matchingMovie.id) {
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $MovieTitle -artworktype 'background'
                                    Write-Entry -Subtext "Movie ID: $($matchingMovie.id)" -Path $global:configLogging -Color Cyan -log Debug
                                }
                                Else {
                                    Write-Entry -Message "Could not find Movie ID for '$MovieTitle' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                        }
                        Else {
                            $errorMsg = "Could not match movie '$($entry.title) (Background)' in '$($entry.'Library Name')' by ID or Title."
                            $errorMsg += " Source (Plex) IDs were (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId), ImdbId: $($entry.ImdbId)). Please check destination library metadata."
                            Write-Entry -Subtext $errorMsg -Path $global:configLogging -Color Red -log Error
                        }
                    }
                    Else {
                        Write-Entry -Message "Could not find Background URL for '$($entry.title)' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                        Write-Entry -Message "Please fix the metadata on the source media server to resolve this issue." -Path $global:configLogging -Color Red -log Error
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                    }
                }
            }
        }
        catch {
            write-Entry -Subtext "For: $MovieTitle in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Could not sync movies to jelly/emby, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            write-Entry -Subtext "At line $($_.InvocationInfo.ScriptLineNumber)." -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

        }
    }

    Write-Entry -Message "Starting show artwork sync part..." -Path $global:configLogging -Color Green -log Info
    foreach ($entry in $AllShows) {
        try {
            # check if item has skip label
            if ($entry.labels -match 'skip_posterizarr') {
                Write-Entry -Message "Skipping '$($entry.title)' because it has a skip label..." -Path $global:configLogging -Color Yellow -log Warning
            }
            Else {
                # Now we can start the Poster Part
                if ($global:Posters -eq 'true') {
                    if ($null -ne $entry.PlexPosterUrl) {
                        if ($entry.PlexPosterUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexPosterUrl
                        }

                        # Attempt to match by ID (preferred)
                        $matchingShow = $OtherAllShows | Where-Object {
                            $_."Library Name" -eq $entry."Library Name" -and (
                                ($null -ne $entry.TmdbId -and $_.TmdbId -eq $entry.TmdbId) -or
                                ($null -ne $entry.TvdbId -and $_.TvdbId -eq $entry.TvdbId)
                            )
                        }

                        # If no ID match, fall back to Title
                        if ($null -eq $matchingShow) {
                            $warningMsg = "No ID match for show '$($entry.title)'."
                            $warningMsg += " Source IDs (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Falling back to Title match..."
                            Write-Entry -Subtext $warningMsg -Path $global:configLogging -Color Yellow -log Warning

                            $matchingShow = $OtherAllShows | Where-Object {
                                $_."Library Name" -eq $entry."Library Name" -and
                                ($_.Title -eq $entry.Title -or $_.originalTitle -eq $entry.originalTitle)
                            }

                            if ($matchingShow) {
                                Write-Entry -Subtext "Fallback to Title match SUCCESSFUL for show '$($entry.title)'." -Path $global:configLogging -Color Cyan -log Debug
                            }
                        }

                        if ($matchingShow) {
                            $ShowTitle = $entry.Title
                            $imageType = "Primary"
                            Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Show Title: $ShowTitle" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Type: $imageType" -Path $global:configLogging -Color Cyan -log Debug
                            if ($matchingShow.id.Count -gt 1) {
                                foreach ($id in $matchingShow.id) {
                                    $DestUrl = "$OtherMediaServerUrl/items/$id/images/$imageType/"
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'poster'
                                    Write-Entry -Subtext "Show ID: $id" -Path $global:configLogging -Color Cyan -log Debug
                                }
                            }
                            Else {
                                $DestUrl = "$OtherMediaServerUrl/items/$($matchingShow.id)/images/$imageType/"
                                if ($matchingShow.id) {
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'poster'
                                    Write-Entry -Subtext "Show ID: $($matchingShow.id)" -Path $global:configLogging -Color Cyan -log Debug
                                }
                                Else {
                                    Write-Entry -Message "Could not find Show ID for '$ShowTitle' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                        }
                        Else {
                            $errorMsg = "Could not match show '$($entry.title)' in '$($entry.'Library Name')' by ID or Title."
                            $errorMsg += " Source (Plex) IDs were (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Please check destination library metadata."
                            Write-Entry -Subtext $errorMsg -Path $global:configLogging -Color Red -log Error
                        }
                    }
                    Else {
                        Write-Entry -Message "Could not find Poster URL for '$($entry.title)' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                        Write-Entry -Message "Please fix the metadata on the source media server to resolve this issue." -Path $global:configLogging -Color Red -log Error
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                    }

                }
                # Now we can start the Background Poster Part
                if ($global:BackgroundPosters -eq 'true') {
                    if ($null -ne $entry.PlexBackgroundUrl) {
                        if ($entry.PlexBackgroundUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexBackgroundUrl
                        }

                        # Attempt to match by ID (preferred)
                        $matchingShow = $OtherAllShows | Where-Object {
                            $_."Library Name" -eq $entry."Library Name" -and (
                                ($null -ne $entry.TmdbId -and $_.TmdbId -eq $entry.TmdbId) -or
                                ($null -ne $entry.TvdbId -and $_.TvdbId -eq $entry.TvdbId)
                            )
                        }

                        # If no ID match, fall back to Title
                        if ($null -eq $matchingShow) {
                            $warningMsg = "No ID match for show '$($entry.title) (Background)'."
                            $warningMsg += " Source IDs (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Falling back to Title match..."
                            Write-Entry -Subtext $warningMsg -Path $global:configLogging -Color Yellow -log Warning

                            $matchingShow = $OtherAllShows | Where-Object {
                                $_."Library Name" -eq $entry."Library Name" -and
                                ($_.Title -eq $entry.Title -or $_.originalTitle -eq $entry.originalTitle)
                            }

                            if ($matchingShow) {
                                Write-Entry -Subtext "Fallback to Title match SUCCESSFUL for show '$($entry.title) (Background)'." -Path $global:configLogging -Color Cyan -log Debug
                            }
                        }

                        if ($matchingShow) {
                            $ShowTitle = $entry.Title + " | Background"
                            $imageType = "Backdrop"
                            Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Show Title: $ShowTitle" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Type: $imageType" -Path $global:configLogging -Color Cyan -log Debug
                            if ($matchingShow.id.Count -gt 1) {
                                foreach ($id in $matchingShow.id) {
                                    $DestUrl = "$OtherMediaServerUrl/items/$id/images/$imageType/"
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'background'
                                    Write-Entry -Subtext "Show ID: $id" -Path $global:configLogging -Color Cyan -log Debug
                                }
                            }
                            Else {
                                $DestUrl = "$OtherMediaServerUrl/items/$($matchingShow.id)/images/$imageType/"
                                if ($matchingShow.id) {
                                    SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'background'
                                    Write-Entry -Subtext "Show ID: $($matchingShow.id)" -Path $global:configLogging -Color Cyan -log Debug
                                }
                                Else {
                                    Write-Entry -Message "Could not find Show ID for '$ShowTitle' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                        }
                        Else {
                            $errorMsg = "Could not match show '$($entry.title) (Background)' in '$($entry.'Library Name')' by ID or Title."
                            $errorMsg += " Source (Plex) IDs were (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Please check destination library metadata."
                            Write-Entry -Subtext $errorMsg -Path $global:configLogging -Color Red -log Error
                        }
                    }
                    Else {
                        Write-Entry -Message "Could not find Background URL for '$($entry.title)' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                        write-Entry -Subtext "At line $($_.InvocationInfo.ScriptLineNumber)." -Path $global:configLogging -Color Red -log Error
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                    }

                }
                # Now we can start the Season Poster Part
                if ($global:SeasonPosters -eq 'true') {
                    $global:seasonNumbers = $entry.seasonNumbers -split ','
                    $global:PlexSeasonUrls = $entry.PlexSeasonUrls -split ','
                    for ($i = 0; $i -lt $global:seasonNumbers.Count; $i++) {
                        $global:SeasonNumber = $global:seasonNumbers[$i]
                        $global:PlexSeasonUrl = $global:PlexSeasonUrls[$i]
                        if ($null -ne $global:PlexSeasonUrl) {
                            if ($global:PlexSeasonUrl -like "/library/*") {
                                $Arturl = $plexurl + $global:PlexSeasonUrl
                            }

                            # Attempt to match by ID (preferred)
                            $matchingSeason = $OtherEpisodedata | Where-Object {
                                $_."Library Name" -eq $entry."Library Name" -and
                                $_."Season Number" -eq $global:SeasonNumber -and (
                                    ($null -ne $entry.TmdbId -and $_.TmdbId -eq $entry.TmdbId) -or
                                    ($null -ne $entry.TvdbId -and $_.TvdbId -eq $entry.TvdbId)
                                )
                            }

                            # If no ID match, fall back to Title
                            if ($null -eq $matchingSeason) {
                                $warningMsg = "No ID match for '$($entry.Title) | Season $global:SeasonNumber'."
                                $warningMsg += " Source IDs (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Falling back to Title match..."
                                Write-Entry -Subtext $warningMsg -Path $global:configLogging -Color Yellow -log Warning

                                $matchingSeason = $OtherEpisodedata | Where-Object {
                                    $_."Library Name" -eq $entry."Library Name" -and
                                    $_."Season Number" -eq $global:SeasonNumber -and
                                    ($_.'Show Name' -eq $entry.Title -or $_.'Show Name' -eq $entry.originalTitle -or $_."Show Original Name" -eq $entry.originalTitle -or $_."Show Original Name" -eq $entry.Title)
                                }

                                if ($matchingSeason) {
                                    Write-Entry -Subtext "Fallback to Title match SUCCESSFUL for '$($entry.Title) | Season $global:SeasonNumber'." -Path $global:configLogging -Color Cyan -log Debug
                                }
                            }

                            if ($matchingSeason) {
                                $ShowTitle = $entry.Title + " | Season $global:SeasonNumber"
                                $imageType = "Primary"
                                Write-Entry -Subtext "--------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                                Write-Entry -Message "Show Title: $ShowTitle" -Path $global:configLogging -Color Cyan -log Debug
                                Write-Entry -Message "Type: $imageType" -Path $global:configLogging -Color Cyan -log Debug
                                if ($matchingSeason.SeasonId.Count -gt 1) {
                                    foreach ($id in $matchingSeason.SeasonId) {
                                        $DestUrl = "$OtherMediaServerUrl/items/$id/images/$imageType/"
                                        SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'season'
                                        Write-Entry -Subtext "Season ID: $id" -Path $global:configLogging -Color Cyan -log Debug
                                    }
                                }
                                Else {
                                    $DestUrl = "$OtherMediaServerUrl/items/$($matchingSeason.SeasonId)/images/$imageType/"
                                    if ($matchingSeason.SeasonId) {
                                        SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'season'
                                        Write-Entry -Subtext "Season ID: $($matchingSeason.SeasonId)" -Path $global:configLogging -Color Cyan -log Debug
                                    }
                                    Else {
                                        Write-Entry -Message "Could not find Season ID for '$ShowTitle' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                            }
                            Else {
                                $errorMsg = "Could not match season '$($entry.Title) | Season $global:SeasonNumber' in '$($entry.'Library Name')' by ID or Title."
                                $errorMsg += " Source (Plex) IDs were (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Please check destination library metadata."
                                Write-Entry -Subtext $errorMsg -Path $global:configLogging -Color Red -log Error
                            }
                        }
                        Else {
                            Write-Entry -Message "Could not find Season URL for '$($entry.Title) - Season $global:SeasonNumber' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                            Write-Entry -Message "Please fix the metadata on the source media server to resolve this issue." -Path $global:configLogging -Color Red -log Error
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                        }

                    }
                }
                # Now we can start the Title Card Part
                if ($global:TitleCards -eq 'true') {
                    foreach ($episode in $Episodedata) {
                        $global:show_name = $episode."Show Name"
                        $global:season_number = $episode."Season Number"
                        $global:episode_numbers = $episode."Episodes".Split(",")
                        $global:PlexTitleCardUrls = $episode."PlexTitleCardUrls".Split(",")

                        # Match based on Show name, tmdbid, tvdbid, and Library Name
                        if ($episode.'Library Name' -eq $entry.'Library Name' -and (
                                ($episode.tmdbid -eq $entry.tmdbid -or $episode.tvdbid -eq $entry.tvdbid) -or
                                ($episode.'Show Name' -eq $entry.title -or $episode.'Show Name' -eq $entry.originalTitle)
                            )) {

                            # Loop through episodes in $episode_numbers
                            for ($i = 0; $i -lt $global:episode_numbers.Count; $i++) {
                                if ($global:PlexTitleCardUrls.Count -gt $i -and $null -ne $global:PlexTitleCardUrls[$i]) { $global:PlexTitleCardUrl = $($global:PlexTitleCardUrls[$i].Trim()) } else { $global:PlexTitleCardUrl = $null }
                                if ($global:episode_numbers.Count -gt $i -and $null -ne $global:episode_numbers[$i]) { $global:episodenumber = $($global:episode_numbers[$i].Trim()) } else { $global:episodenumber = $null }
                                if ([string]::IsNullOrWhiteSpace($global:episodenumber)) {
                                    Write-Entry -Subtext "Skipping sync title card entry at index [$i] because episode number is missing." -Path $global:configLogging -Color Yellow -log Warning
                                    continue
                                }
                                if ($null -ne $global:PlexTitleCardUrl) {
                                    if ($global:PlexTitleCardUrl -like "/library/*") {
                                        $Arturl = $plexurl + $global:PlexTitleCardUrl
                                    }

                                    # Find matching episode in OtherEpisodedata
                                    $matchingEpisode = $OtherEpisodedata | Where-Object {
                                        $_."Library Name" -eq $entry."Library Name" -and
                                        $_."Season Number" -eq $global:season_number -and
                                        ($_.Episodes.Split(",") -contains $global:episodenumber) -and (
                                            ($null -ne $entry.TmdbId -and $_.TmdbId -eq $entry.TmdbId) -or
                                            ($null -ne $entry.TvdbId -and $_.TvdbId -eq $entry.TvdbId)
                                        )
                                    }

                                    # If no ID match, fall back to Title
                                    if ($null -eq $matchingEpisode) {
                                        $warningMsg = "No ID match for '$($entry.Title) S$($global:season_number)E$($global:episodenumber)'."
                                        $warningMsg += " Source IDs (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Falling back to Title match..."
                                        Write-Entry -Subtext $warningMsg -Path $global:configLogging -Color Yellow -log Warning

                                        $matchingEpisode = $OtherEpisodedata | Where-Object {
                                            ($_.'Show Name' -eq $entry.title -or $_.'Show Name' -eq $entry.originalTitle) -and
                                            $_."Library Name" -eq $entry."Library Name" -and
                                            $_."Season Number" -eq $global:season_number -and
                                            ($_.Episodes.Split(",") -contains $global:episodenumber)
                                        }

                                        if ($matchingEpisode) {
                                            Write-Entry -Subtext "Fallback to Title match SUCCESSFUL for '$($entry.Title) S$($global:season_number)E$($global:episodenumber)'." -Path $global:configLogging -Color Cyan -log Debug
                                        }
                                    }

                                    if ($matchingEpisode) {
                                        # Select the matching episode ID based on the current index
                                        $global:episodeid = $matchingEpisode.EpisodeIds.Split(",")[$i]
                                        # Construct the show title with the current episode number
                                        $ShowTitle = "$($entry.Title) | Season $($global:season_number) - Episode $global:episodenumber"
                                        # Define the image type and destination URL
                                        $imageType = "Primary"
                                        $DestUrl = "$OtherMediaServerUrl/items/$($global:episodeid)/images/$imageType/"
                                        # Call the SyncPlexArtwork function to sync the artwork
                                        if ($matchingShow.id) {
                                            SyncPlexArtwork -ArtUrl $Arturl -DestUrl $DestUrl -imagetype $imageType -title $ShowTitle -artworktype 'tc'
                                        }
                                        Else {
                                            Write-Entry -Message "Could not find Episode ID for '$ShowTitle' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                        }
                                        Write-Entry -Subtext "Show Title: $ShowTitle" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "Type: $imageType" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "Episode ID: $global:episodeid" -Path $global:configLogging -Color Cyan -log Debug
                                    }
                                    Else {
                                        $errorMsg = "Could not match episode '$($entry.Title) S$($global:season_number)E$($global:episodenumber)' in '$($entry.'Library Name')' by ID or Title."
                                        $errorMsg += " Source (Plex) IDs were (TmdbId: $($entry.TmdbId), TvdbId: $($entry.TvdbId)). Please check destination library metadata."
                                        Write-Entry -Subtext $errorMsg -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                                Else {
                                    Write-Entry -Message "Could not find TitleCard URL for '$($entry.Title) - Season $global:season_number - Episode $global:episodenumber' in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
                                    Write-Entry -Message "Please fix the metadata on the source media server to resolve this issue." -Path $global:configLogging -Color Red -log Error
                                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                }

                            }
                        }
                    }
                }
            }
        }
        catch {
            write-Entry -Subtext "For: $ShowTitle in $($entry.'Library Name')" -Path $global:configLogging -Color Red -log Error
            Write-Entry -Subtext "Could not sync shows to jelly/emby, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            write-Entry -Subtext "At line $($_.InvocationInfo.ScriptLineNumber)." -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
        }
    }

    $endTime = Get-Date
    $executionTime = New-TimeSpan -Start $startTime -End $endTime
    # Format the execution time
    $hours = [math]::Floor($executionTime.TotalHours)
    $minutes = $executionTime.Minutes
    $seconds = $executionTime.Seconds
    $FormattedTimespawn = $hours.ToString() + "h " + $minutes.ToString() + "m " + $seconds.ToString() + "s "
    Write-Entry -Message "Finished, Total images uploaded: $uploadCount" -Path $global:configLogging -Color Green -log Info
    if ($errorCount -ge '1') {
        Write-Entry -Message "During execution '$errorCount' Errors occurred, please check the log for a detailed description where you see [ERROR-HERE]." -Path $global:configLogging -Color White -log Info
    }
    Write-TextSizeCacheSummary
    Write-Entry -Message "Script execution time: $FormattedTimespawn" -Path $global:configLogging -Color White -log Info

    # Send Notification
    Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $errorCount -PosterCount $posterCount -BackgroundCount $BackgroundCount -SeasonCount $SeasonCount -EpisodeCount $EpisodeCount -UploadCount $UploadCount

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
