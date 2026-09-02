function MassDownloadPlexArtwork {
    $Mode = "backup"
    Write-Entry -Message "Backup Mode Started..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Query plex libs..." -Path $global:configLogging -Color White -log Info
    $Libsoverview = [System.Collections.Generic.List[object]]::new()
    foreach ($lib in $Libs.MediaContainer.Directory) {
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
                HandleScriptExit -Message "Invalid lib chars"
            }
            $Libsoverview.Add($libtemp)
        }
    }
    if ($($Libsoverview.count) -lt 1) {
        Write-Entry -Subtext "0 libraries were found. Are you on the correct Plex server?" -Path $global:configLogging -Color Red -log Error
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
            foreach ($item in $Libcontent.MediaContainer.$contentquery) {
                $extractedFolder = $null
                $Seasondata = $null
                if ($contentquery -eq 'Directory') {
                    try {
                        [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($item.ratingKey) -Headers $extraPlexHeaders).content
                        [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$($item.ratingKey)/children? -Headers $extraPlexHeaders).content
                    }
                    catch {
                        Write-Entry -Subtext "Current Seasondata Plex Query: $($PlexUrl[0..10] -join '')****/library/metadata/$($item.ratingKey)/children?" -Path $global:configLogging -Color Cyan -log Debug
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

                    }
                }
                Else {
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
                # check if there are more then 1 entry in ids
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
    $Libraries | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexLibexport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    Write-Entry -Message "Export everything to a csv: $global:ScriptRoot\Logs\PlexLibexport.csv" -Path $global:configLogging -Color White -log Info

    # Initialize counter variable
    $posterCount = 0
    $SeasonCount = 0
    $EpisodeCount = 0
    $BackgroundCount = 0
    $PosterUnknownCount = 0
    $SkipTBACount = 0
    $SkipJapTitleCount = 0
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
        $Episodedata | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        if ($Episodedata) {
            Write-Entry -Subtext "Found '$($Episodedata.Episodes.split(',').count)' Episodes..." -Path $global:configLogging -Color Cyan -log Info
        }
    }

    # Test if csvÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´s are missing and create dummy file.
    if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
        $EpisodeDummycsv = New-Object psobject

        # Add members to the object with empty values
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Show Name" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Type" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Season Number" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Episodes" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Title" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "PlexTitleCardUrls" -Value $null

        $EpisodeDummycsv | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        Write-Entry -Message "No PlexEpisodeExport.csv found, creating dummy file for you..." -Path $global:configLogging -Color White -log Info
    }
    if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\PlexLibexport.csv" -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
        # Add members to the object with empty values
        $PlexLibDummycsv = New-Object psobject
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "title" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "SeasonNames" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "SeasonNumbers" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "SeasonRatingKeys" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "year" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "ratingKey" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Path" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "MultipleVersions" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "PlexPosterUrl" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "PlexBackgroundUrl" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "PlexSeasonUrls" -Value $null

        $PlexLibDummycsv | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexLibexport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        Write-Entry -Message "No PlexLibexport.csv found, creating dummy file for you..." -Path $global:configLogging -Color White -log Info
    }
    # Store all Files from asset dir in a hashtable
    $directoryHashtable = Get-AssetHashtable -TargetPath $BackupPath

    # Download poster foreach movie
    Write-Entry -Message "Starting asset download now, this can take a while..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Starting Movie Poster/Background download part..." -Path $global:configLogging -Color Green -log Info

    $checkedItems = [System.Collections.Generic.List[object]]::new()
    # Movie Part
    foreach ($entry in $AllMovies) {
        try {
            if ($($entry.RootFoldername)) {
                $SkippingText = 'false'
                $global:posterurl = $null
                $global:ImageMagickError = $null
                $global:TMDBfallbackposterurl = $null
                $global:fanartfallbackposterurl = $null
                $global:IsFallback = $null
                $global:PlexartworkDownloaded = $null
                $global:langCode = $null
                $global:direction = $null

                # Determine the language direction
                $global:langCode = $entry.'Library Language'
                $global:direction = $global:languageDirections[$global:langCode]

                $cjkPattern = '[\p{IsHiragana}\p{IsKatakana}\p{IsCJKUnifiedIdeographs}\p{IsCyrillic}\p{IsDevanagari}\p{IsThai}\p{IsEthiopic}\p{IsGeorgian}\p{IsArmenian}\p{IsBengali}]'

                if ($UseOriginalTitle -eq 'true') {
                    if ($entry.originalTitle -match $cjkPattern) {
                        $Titletext = $entry.title
                    }
                    else {
                        $Titletext = $entry.originalTitle
                    }
                }
                Else {
                    if ($entry.title -match $cjkPattern) {
                        $Titletext = $entry.originalTitle
                    }
                    else {
                        $Titletext = $entry.title
                    }
                }

                if ($LibraryFolders -eq 'true') {
                    $LibraryName = $entry.'Library Name'
                    $EntryDir = "$BackupPath\$LibraryName\$($entry.RootFoldername)"
                    $PosterImageoriginal = "$EntryDir\poster.jpg"
                    $TestPath = $EntryDir
                    $Testfile = "poster"

                    if (!(Get-ChildItem -LiteralPath $EntryDir -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
                        New-Item -ItemType Directory -path $EntryDir -Force | out-null
                    }
                }
                Else {
                    $PosterImageoriginal = "$BackupPath\$($entry.RootFoldername).jpg"
                    $TestPath = $BackupPath
                    $Testfile = $($entry.RootFoldername)
                }

                if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                    $PosterImageoriginal = ($PosterImageoriginal).Replace('\', '/').Replace('./', '/')
                    $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                }
                else {
                    $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                    if ($fullTestPath) {
                        $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                    }
                    Else {
                        $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                    }
                }
                Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug
                $PosterImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.RootFoldername).jpg"
                $PosterImage = $PosterImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                # Now we can start the Poster Part
                if ($global:Posters -eq 'true') {
                    $checkedItems.Add($hashtestpath)

                    if (($null -ne $FileTestOnTrigger -and $FileTestOnTrigger -eq 'false') -or (-not $directoryHashtable.ContainsKey("$hashtestpath"))) {
                        # Define Global Variables
                        $SkippingText = 'false'
                        $global:tmdbid = $entry.tmdbid
                        $global:tvdbid = $entry.tvdbid
                        $global:imdbid = $entry.imdbid
                        $global:TextlessPoster = $null
                        $global:posterurl = $null
                        $global:PosterWithText = $null
                        $global:AssetTextLang = $null
                        $global:TMDBAssetTextLang = $null
                        $global:FANARTAssetTextLang = $null
                        $global:TVDBAssetTextLang = $null
                        $global:TMDBAssetChangeUrl = $null
                        $global:FANARTAssetChangeUrl = $null
                        $global:TVDBAssetChangeUrl = $null
                        $global:Fallback = $null
                        $global:IsFallback = $null
                        $global:ImageMagickError = $null
                        $Arturl = $null

                        if ($entry.PlexPosterUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexPosterUrl
                        }
                        Write-Entry -Message "Searching on Plex for $Titletext - Poster" -Path $global:configLogging -Color White -log Info

                        if ($fontAllCaps -eq 'true') {
                            $joinedTitle = $Titletext.ToUpper()
                        }
                        Else {
                            $joinedTitle = $Titletext
                        }
                        GetPlexArtworkUrl -ArtUrl $Arturl -TempImage $PosterImage
                        if ($global:posterurl) {
                            try {
                                Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $PosterImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                            }
                            catch {
                                if ($_.Exception.Response) {
                                    $statusCode = $_.Exception.Response.StatusCode.value__
                                }
                                else {
                                    $statusCode = $_.Exception.Message
                                }
                                Write-Entry -Subtext "An error occurred while downloading the artwork: $statusCode" -Path $global:configLogging -Color Red -log Error
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            }
                            # Move file back to original naming with Brackets.
                            if (Get-ChildItem -LiteralPath $PosterImage -ErrorAction SilentlyContinue -WarningAction SilentlyContinue) {
                                try {
                                    if ($LibraryFolders -eq 'true' -and !(Test-Path -LiteralPath $EntryDir)) {
                                        New-Item -ItemType Directory -Path $EntryDir -Force | Out-Null
                                    }
                                    # Attempt to move the item
                                    Move-Item -LiteralPath $PosterImage -Destination $PosterImageoriginal -Force -ErrorAction Stop

                                    # Log success if move was successful
                                    Write-Entry -Subtext "Added: $PosterImageoriginal" -Path $global:configLogging -Color Green -Log Info
                                }
                                catch {
                                    # Log the error if the move operation fails
                                    Write-Entry -Subtext "Failed to move $PosterImage to $PosterImageoriginal." -Path $global:configLogging -Color Red -Log Error
                                    Write-Entry -Subtext "Error: $_" -Path $global:configLogging -Color Red -Log Error
                                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                }
                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                $global:posterCount = Increment-GlobalStat 'posterCount'
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                        }
                    }
                    else {
                        if ($show_skipped -eq 'true' ) {
                            Write-Entry -Subtext "Already exists: $PosterImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                        }
                    }
                }
                # Now we can start the Background Poster Part
                if ($global:BackgroundPosters -eq 'true') {
                    if ($LibraryFolders -eq 'true') {
                        $LibraryName = $entry.'Library Name'
                        $EntryDir = "$BackupPath\$LibraryName\$($entry.RootFoldername)"
                        $backgroundImageoriginal = "$EntryDir\background.jpg"
                        $TestPath = $EntryDir
                        $Testfile = "background"

                        if (!(Get-ChildItem -LiteralPath $EntryDir -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
                            New-Item -ItemType Directory -path $EntryDir -Force | out-null
                        }
                    }
                    Else {
                        $backgroundImageoriginal = "$BackupPath\$($entry.RootFoldername)_background.jpg"
                        $TestPath = $BackupPath
                        $Testfile = "$($entry.RootFoldername)_background"
                    }

                    if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                        $backgroundImageoriginal = ($backgroundImageoriginal).Replace('\', '/').Replace('./', '/')
                        $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    }
                    else {
                        $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                        if ($fullTestPath) {
                            $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        }
                        Else {
                            $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                        }
                    }

                    $backgroundImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.RootFoldername)_background.jpg"
                    $backgroundImage = $backgroundImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                    $checkedItems.Add($hashtestpath)

                    if (($null -ne $FileTestOnTrigger -and $FileTestOnTrigger -eq 'false') -or (-not $directoryHashtable.ContainsKey("$hashtestpath"))) {
                        # Define Global Variables
                        $SkippingText = 'false'
                        $global:tmdbid = $entry.tmdbid
                        $global:tvdbid = $entry.tvdbid
                        $global:imdbid = $entry.imdbid
                        $global:posterurl = $null
                        $global:PosterWithText = $null
                        $global:AssetTextLang = $null
                        $global:Fallback = $null
                        $global:IsFallback = $null
                        $global:TMDBAssetTextLang = $null
                        $global:FANARTAssetTextLang = $null
                        $global:TVDBAssetTextLang = $null
                        $global:TMDBAssetChangeUrl = $null
                        $global:FANARTAssetChangeUrl = $null
                        $global:TVDBAssetChangeUrl = $null
                        $global:ImageMagickError = $null
                        $global:TextlessPoster = $null
                        $Arturl = $null

                        if ($entry.PlexBackgroundUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexBackgroundUrl
                        }
                        Write-Entry -Message "Searching on Plex for $Titletext - Background" -Path $global:configLogging -Color White -log Info

                        if ($BackgroundfontAllCaps -eq 'true') {
                            $joinedTitle = $Titletext.ToUpper()
                        }
                        Else {
                            $joinedTitle = $Titletext
                        }
                        GetPlexArtworkUrl -ArtUrl $Arturl -TempImage $BackgroundImage
                        if ($global:posterurl) {
                            try {
                                Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $BackgroundImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                            }
                            catch {
                                if ($_.Exception.Response) {
                                    $statusCode = $_.Exception.Response.StatusCode.value__
                                }
                                else {
                                    $statusCode = $_.Exception.Message
                                }
                                Write-Entry -Subtext "An error occurred while downloading the artwork: $statusCode" -Path $global:configLogging -Color Red -log Error
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            }

                            # Move file back to original naming with Brackets.
                            if (Get-ChildItem -LiteralPath $backgroundImage -ErrorAction SilentlyContinue -WarningAction SilentlyContinue) {
                                try {
                                    # Attempt to move the item
                                    Move-Item -LiteralPath $backgroundImage -Destination $backgroundImageoriginal -Force -ErrorAction Stop

                                    # Log success if move was successful
                                    Write-Entry -Subtext "Added: $backgroundImageoriginal" -Path $global:configLogging -Color Green -Log Info
                                }
                                catch {
                                    # Log the error if the move operation fails
                                    Write-Entry -Subtext "Failed to move $backgroundImage to $backgroundImageoriginal." -Path $global:configLogging -Color Red -Log Error
                                    Write-Entry -Subtext "Error: $_" -Path $global:configLogging -Color Red -Log Error
                                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                }
                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                $global:posterCount = Increment-GlobalStat 'posterCount'
                                $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                        }
                    }
                    else {
                        if ($show_skipped -eq 'true' ) {
                            Write-Entry -Subtext "Already exists: $backgroundImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                        }
                    }
                }
            }
            Else {
                Write-Entry -Message "Rootfolder value: $($entry.RootFoldername)" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Path value: $($entry.Path)" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Missing RootFolder for: $($entry.title) - you have to manually create the poster for it..." -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
        }
        catch {
            Write-Entry -Subtext "Could not query entries from movies array, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            write-Entry -Subtext "At line $($_.InvocationInfo.ScriptLineNumber)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

        }
    }

    Write-Entry -Message "Starting Show/Season Poster/Background/TitleCard Download part..." -Path $global:configLogging -Color Green -log Info
    # Show Part
    foreach ($entry in $AllShows) {
        if ($($entry.RootFoldername)) {
            # Define Global Variables
            $SkippingText = 'false'
            $global:tmdbid = $entry.tmdbid
            $global:tvdbid = $entry.tvdbid
            $global:imdbid = $entry.imdbid
            $Seasonpostersearchtext = $null
            $global:ImageMagickError = $null
            $Episodepostersearchtext = $null
            $global:TMDBfallbackposterurl = $null
            $global:fanartfallbackposterurl = $null
            $FanartSearched = $null
            $global:plexalreadysearched = $null
            $global:posterurl = $null
            $global:PosterWithText = $null
            $global:AssetTextLang = $null
            $global:TMDBAssetTextLang = $null
            $global:FANARTAssetTextLang = $null
            $global:TVDBAssetTextLang = $null
            $global:TMDBAssetChangeUrl = $null
            $global:FANARTAssetChangeUrl = $null
            $global:TVDBAssetChangeUrl = $null
            $global:IsFallback = $null
            $global:FallbackText = $null
            $global:Fallback = $null
            $global:TextlessPoster = $null
            $global:tvdbalreadysearched = $null
            $global:PlexartworkDownloaded = $null
            $global:langCode = $null
            $global:direction = $null

            # Determine the language direction
            $global:langCode = $entry.'Library Language'
            $global:direction = $global:languageDirections[$global:langCode]

            $cjkPattern = '[\p{IsHiragana}\p{IsKatakana}\p{IsCJKUnifiedIdeographs}\p{IsCyrillic}\p{IsDevanagari}\p{IsThai}\p{IsEthiopic}\p{IsGeorgian}\p{IsArmenian}\p{IsBengali}]'

            if ($UseOriginalTitle -eq 'true') {
                if ($entry.originalTitle -match $cjkPattern) {
                    $Titletext = $entry.title
                }
                else {
                    $Titletext = $entry.originalTitle
                }
            }
            Else {
                if ($entry.title -match $cjkPattern) {
                    $Titletext = $entry.originalTitle
                }
                else {
                    $Titletext = $entry.title
                }
            }

            if ($LibraryFolders -eq 'true') {
                $LibraryName = $entry.'Library Name'
                $EntryDir = "$BackupPath\$LibraryName\$($entry.RootFoldername)"
                $PosterImageoriginal = "$EntryDir\poster.jpg"
                $TestPath = $EntryDir
                $Testfile = "poster"

                if (!(Get-ChildItem -LiteralPath $EntryDir -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
                    New-Item -ItemType Directory -path $EntryDir -Force | out-null
                }
            }
            Else {
                $PosterImageoriginal = "$BackupPath\$($entry.RootFoldername).jpg"
                $TestPath = $BackupPath
                $Testfile = $($entry.RootFoldername)
            }

            if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                $PosterImageoriginal = ($PosterImageoriginal).Replace('\', '/').Replace('./', '/')
                $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
            }
            else {
                $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                if ($fullTestPath) {
                    $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                }
                Else {
                    $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                }
            }

            Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug

            $PosterImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.RootFoldername).jpg"
            $PosterImage = $PosterImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')

            # Now we can start the Poster Part
            if ($global:Posters -eq 'true') {
                $checkedItems.Add($hashtestpath)

                if (($null -ne $FileTestOnTrigger -and $FileTestOnTrigger -eq 'false') -or (-not $directoryHashtable.ContainsKey("$hashtestpath"))) {
                    $Arturl = $null
                    if ($entry.PlexPosterUrl -like "/library/*") {
                        $Arturl = $plexurl + $entry.PlexPosterUrl
                    }
                    Write-Entry -Message "Searching on Plex for $Titletext - Poster" -Path $global:configLogging -Color White -log Info
                    GetPlexArtworkUrl -ArtUrl $Arturl -TempImage $PosterImage

                    if ($fontAllCaps -eq 'true') {
                        $joinedTitle = $Titletext.ToUpper()
                    }
                    Else {
                        $joinedTitle = $Titletext
                    }
                    if (!$global:TextlessPoster -eq 'true' -and $global:TMDBfallbackposterurl) {
                        $global:posterurl = $global:TMDBfallbackposterurl
                    }
                    if (!$global:TextlessPoster -eq 'true' -and $global:fanartfallbackposterurl) {
                        $global:posterurl = $global:fanartfallbackposterurl
                    }
                    if ($global:posterurl) {
                        try {
                            Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                            Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $PosterImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                        }
                        catch {
                            if ($_.Exception.Response) {
                                $statusCode = $_.Exception.Response.StatusCode.value__
                            }
                            else {
                                $statusCode = $_.Exception.Message
                            }
                            Write-Entry -Subtext "An error occurred while downloading the artwork: $statusCode" -Path $global:configLogging -Color Red -log Error
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                        }
                        if (Get-ChildItem -LiteralPath $PosterImage -ErrorAction SilentlyContinue -WarningAction SilentlyContinue) {
                            # Move file back to original naming with Brackets.
                            try {
                                # Attempt to move the item
                                Move-Item -LiteralPath $PosterImage -Destination $PosterImageoriginal -Force -ErrorAction Stop

                                # Log success if move was successful
                                Write-Entry -Subtext "Added: $PosterImageoriginal" -Path $global:configLogging -Color Green -Log Info
                            }
                            catch {
                                # Log the error if the move operation fails
                                Write-Entry -Subtext "Failed to move $PosterImage to $PosterImageoriginal." -Path $global:configLogging -Color Red -Log Error
                                Write-Entry -Subtext "Error: $_" -Path $global:configLogging -Color Red -Log Error
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            }
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:posterCount = Increment-GlobalStat 'posterCount'
                        }

                    }
                    Else {
                        Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                        Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                    }
                }
                else {
                    if ($show_skipped -eq 'true' ) {
                        Write-Entry -Subtext "Already exists: $PosterImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                    }
                }
            }
            # Now we can start the Background Part
            if ($global:BackgroundPosters -eq 'true') {
                if ($LibraryFolders -eq 'true') {
                    $LibraryName = $entry.'Library Name'
                    $EntryDir = "$BackupPath\$LibraryName\$($entry.RootFoldername)"
                    $backgroundImageoriginal = "$EntryDir\background.jpg"
                    $TestPath = $EntryDir
                    $Testfile = "background"

                    if (!(Get-ChildItem -LiteralPath $EntryDir -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
                        New-Item -ItemType Directory -path $EntryDir -Force | out-null
                    }
                }
                Else {
                    $backgroundImageoriginal = "$BackupPath\$($entry.RootFoldername)_background.jpg"
                    $TestPath = $BackupPath
                    $Testfile = "$($entry.RootFoldername)_background"
                }

                if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                    $backgroundImageoriginal = ($backgroundImageoriginal).Replace('\', '/').Replace('./', '/')
                    $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                }
                else {
                    $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                    if ($fullTestPath) {
                        $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                    }
                    Else {
                        $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                    }
                }

                Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug

                $backgroundImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.RootFoldername)_background.jpg"
                $backgroundImage = $backgroundImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                $checkedItems.Add($hashtestpath)

                if (($null -ne $FileTestOnTrigger -and $FileTestOnTrigger -eq 'false') -or (-not $directoryHashtable.ContainsKey("$hashtestpath"))) {
                    # Define Global Variables
                    $SkippingText = 'false'
                    $global:tmdbid = $entry.tmdbid
                    $global:tvdbid = $entry.tvdbid
                    $global:imdbid = $entry.imdbid
                    $global:posterurl = $null
                    $global:PosterWithText = $null
                    $global:AssetTextLang = $null
                    $global:Fallback = $null
                    $global:IsFallback = $null
                    $global:FallbackText = $null
                    $global:TMDBAssetTextLang = $null
                    $global:FANARTAssetTextLang = $null
                    $global:TVDBAssetTextLang = $null
                    $global:TMDBAssetChangeUrl = $null
                    $global:FANARTAssetChangeUrl = $null
                    $global:TVDBAssetChangeUrl = $null
                    $global:TextlessPoster = $null
                    $global:ImageMagickError = $null
                    $Arturl = $null
                    if ($entry.PlexBackgroundUrl -like "/library/*") {
                        $Arturl = $plexurl + $entry.PlexBackgroundUrl
                    }
                    Write-Entry -Message "Searching on Plex for $Titletext - Background" -Path $global:configLogging -Color White -log Info
                    GetPlexArtworkUrl -ArtUrl $Arturl -TempImage $backgroundImage

                    if ($BackgroundfontAllCaps -eq 'true') {
                        $joinedTitle = $Titletext.ToUpper()
                    }
                    Else {
                        $joinedTitle = $Titletext
                    }
                    if ($global:posterurl) {
                        try {
                            Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                            Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $BackgroundImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                        }
                        catch {
                            if ($_.Exception.Response) {
                                $statusCode = $_.Exception.Response.StatusCode.value__
                            }
                            else {
                                $statusCode = $_.Exception.Message
                            }
                            Write-Entry -Subtext "An error occurred while downloading the artwork: $statusCode" -Path $global:configLogging -Color Red -log Error
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                        }
                        # Move file back to original naming with Brackets.
                        if (Get-ChildItem -LiteralPath $backgroundImage -ErrorAction SilentlyContinue -WarningAction SilentlyContinue) {
                            try {
                                # Attempt to move the item
                                Move-Item -LiteralPath $backgroundImage -Destination $backgroundImageoriginal -Force -ErrorAction Stop

                                # Log success if move was successful
                                Write-Entry -Subtext "Added: $backgroundImageoriginal" -Path $global:configLogging -Color Green -Log Info
                            }
                            catch {
                                # Log the error if the move operation fails
                                Write-Entry -Subtext "Failed to move $backgroundImage to $backgroundImageoriginal." -Path $global:configLogging -Color Red -Log Error
                                Write-Entry -Subtext "Error: $_" -Path $global:configLogging -Color Red -Log Error
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            }
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
                            $global:posterCount = Increment-GlobalStat 'posterCount'
                        }
                    }
                    Else {
                        Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                        Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                    }
                }
                else {
                    if ($show_skipped -eq 'true' ) {
                        Write-Entry -Subtext "Already exists: $backgroundImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                    }
                }
            }
            # Now we can start the Season Part
            if ($global:SeasonPosters -eq 'true') {
                $global:IsFallback = $null
                $global:FallbackText = $null
                $global:AssetTextLang = $null
                $global:Fallback = $null
                $global:TMDBAssetTextLang = $null
                $global:FANARTAssetTextLang = $null
                $global:TVDBAssetTextLang = $null
                $global:TMDBAssetChangeUrl = $null
                $global:FANARTAssetChangeUrl = $null
                $global:TVDBAssetChangeUrl = $null
                $global:PosterWithText = $null
                $global:ImageMagickError = $null
                $global:TextlessPoster = $null
                $global:seasonNames = $entry.SeasonNames -split ';'
                $global:SeasonRatingKeys = $entry.SeasonRatingKeys -split ','
                $global:seasonNumbers = $entry.seasonNumbers -split ','
                $global:PlexSeasonUrls = $entry.PlexSeasonUrls -split ','
                for ($i = 0; $i -lt $global:seasonNames.Count; $i++) {
                    $SkippingText = 'false'
                    $global:posterurl = $null
                    $global:seasontmp = $null
                    $global:IsFallback = $null
                    $global:FallbackText = $null
                    $global:AssetTextLang = $null
                    $global:Fallback = $null
                    $global:TMDBAssetTextLang = $null
                    $global:FANARTAssetTextLang = $null
                    $global:TVDBAssetTextLang = $null
                    $global:TMDBAssetChangeUrl = $null
                    $global:FANARTAssetChangeUrl = $null
                    $global:TVDBAssetChangeUrl = $null
                    $global:PosterWithText = $null
                    $global:ImageMagickError = $null
                    $global:TMDBSeasonFallback = $null
                    $global:TVDBSeasonFallback = $null
                    $global:FANARTSeasonFallback = $null
                    if ($SeasonfontAllCaps -eq 'true') {
                        $global:seasonTitle = $global:seasonNames[$i].ToUpper()
                    }
                    Else {
                        $global:seasonTitle = $global:seasonNames[$i]
                    }
                    $global:SeasonNumber = $global:seasonNumbers[$i]
                    $global:SeasonRatingKey = $global:SeasonRatingKeys[$i]
                    $global:PlexSeasonUrl = $global:PlexSeasonUrls[$i]
                    if ($null -ne $global:SeasonNumber) {
                        $global:seasontmp = "Season" + $global:SeasonNumber.PadLeft(2, '0')
                    }
                    if ($LibraryFolders -eq 'true') {
                        $SeasonImageoriginal = "$EntryDir\$global:seasontmp.jpg"
                        $TestPath = $EntryDir
                        $Testfile = "$global:seasontmp"
                    }
                    Else {
                        $SeasonImageoriginal = "$BackupPath\$($entry.RootFoldername)_$global:seasontmp.jpg"
                        $TestPath = $BackupPath
                        $Testfile = "$($entry.RootFoldername)_$global:seasontmp"
                    }

                    if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                        $SeasonImageoriginal = ($SeasonImageoriginal).Replace('\', '/').Replace('./', '/')
                        $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    }
                    else {
                        $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                        if ($fullTestPath) {
                            $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        }
                        Else {
                            $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                        }
                    }

                    Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug

                    $SeasonImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.RootFoldername)_$global:seasontmp.jpg"
                    $SeasonImage = $SeasonImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                    $checkedItems.Add($hashtestpath)

                    if (($null -ne $FileTestOnTrigger -and $FileTestOnTrigger -eq 'false') -or (-not $directoryHashtable.ContainsKey("$hashtestpath"))) {
                        $Arturl = $null
                        if ($global:PlexSeasonUrl -like "/library/*") {
                            $Arturl = $plexurl + $global:PlexSeasonUrl
                        }
                        if (!$Seasonpostersearchtext) {
                            Write-Entry -Message "Searching on Plex for $Titletext - Season" -Path $global:configLogging -Color White -log Info
                            $Seasonpostersearchtext = $true
                        }
                        GetPlexArtworkUrl -ArtUrl $Arturl -TempImage $SeasonImage
                        if ($global:posterurl) {
                            try {
                                Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $SeasonImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                            }
                            catch {
                                if ($_.Exception.Response) {
                                    $statusCode = $_.Exception.Response.StatusCode.value__
                                }
                                else {
                                    $statusCode = $_.Exception.Message
                                }
                                Write-Entry -Subtext "An error occurred while downloading the artwork: $statusCode" -Path $global:configLogging -Color Red -log Error
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            }
                            if (Get-ChildItem -LiteralPath $SeasonImage -ErrorAction SilentlyContinue -WarningAction SilentlyContinue) {
                                # Move file back to original naming with Brackets.
                                try {
                                    # Attempt to move the item
                                    Move-Item -LiteralPath $SeasonImage -Destination $SeasonImageoriginal -Force -ErrorAction Stop

                                    # Log success if move was successful
                                    Write-Entry -Subtext "Added: $SeasonImageoriginal" -Path $global:configLogging -Color Green -Log Info
                                }
                                catch {
                                    # Log the error if the move operation fails
                                    Write-Entry -Subtext "Failed to move $SeasonImage to $SeasonImageoriginal." -Path $global:configLogging -Color Red -Log Error
                                    Write-Entry -Subtext "Error: $_" -Path $global:configLogging -Color Red -Log Error
                                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                }
                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                $global:SeasonCount = Increment-GlobalStat 'SeasonCount'
                                $global:posterCount = Increment-GlobalStat 'posterCount'
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                        }
                    }
                    else {
                        if ($show_skipped -eq 'true' ) {
                            Write-Entry -Subtext "Already exists: $SeasonImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                        }
                    }
                }
            }
            # Now we can start the Episode Part
            if ($global:TitleCards -eq 'true') {
                # Loop through each episode
                foreach ($episode in $Episodedata) {
                    $SkippingText = 'false'
                    $global:AssetTextLang = $null
                    $global:TMDBAssetTextLang = $null
                    $global:FANARTAssetTextLang = $null
                    $global:TVDBAssetTextLang = $null
                    $global:TMDBAssetChangeUrl = $null
                    $global:FANARTAssetChangeUrl = $null
                    $global:TVDBAssetChangeUrl = $null
                    $global:PosterWithText = $null
                    $global:ImageMagickError = $null
                    $global:season_number = $null
                    $Episodepostersearchtext = $null
                    $global:show_name = $null
                    $global:episodenumber = $null
                    $global:episode_numbers = $null
                    $global:titles = $null
                    $global:posterurl = $null
                    $global:FileNaming = $null
                    $EpisodeImageoriginal = $null
                    $EpisodeImage = $null
                    $global:Fallback = $null
                    $global:IsFallback = $null
                    $global:FallbackText = $null
                    $global:TextlessPoster = $null

                    if (($episode.tmdbid -eq $entry.tmdbid -or $episode.tvdbid -eq $entry.tvdbid) -and $episode.'Show Name' -eq $entry.title -and $episode.'Library Name' -eq $entry.'Library Name') {
                        $global:show_name = $episode."Show Name"
                        $global:season_number = $episode."Season Number"
                        $global:episode_numbers = $episode."Episodes".Split(",")
                        $global:episode_ratingkeys = $episode."ratingKeys".Split(",")
                        $global:titles = $episode."Title".Split(";")
                        $global:PlexTitleCardUrls = $episode."PlexTitleCardUrls".Split(",")
                        $global:ImageMagickError = $null
                        for ($i = 0; $i -lt $global:episode_numbers.Count; $i++) {
                            $SkippingText = 'false'
                            $global:AssetTextLang = $null
                            $global:TMDBAssetTextLang = $null
                            $global:FANARTAssetTextLang = $null
                            $global:TVDBAssetTextLang = $null
                            $global:TMDBAssetChangeUrl = $null
                            $global:FANARTAssetChangeUrl = $null
                            $global:TVDBAssetChangeUrl = $null
                            $global:PosterWithText = $null
                            $global:Fallback = $null
                            $global:IsFallback = $null
                            $global:posterurl = $null
                            $Episodepostersearchtext = $null
                            $ExifFound = $null
                            $global:PlexartworkDownloaded = $null
                            $value = $null
                            $magickcommand = $null
                            $Arturl = $null
                            $global:PlexTitleCardUrl = $($global:PlexTitleCardUrls[$i].Trim())
                            $global:episode_ratingkey = $($global:episode_ratingkeys[$i].Trim())
                            $global:EPTitle = $($global:titles[$i].Trim())
                            $global:episodenumber = $($global:episode_numbers[$i].Trim())
                            $global:FileNaming = "S" + $global:season_number.PadLeft(2, '0') + "E" + $global:episodenumber.PadLeft(2, '0')
                            $bullet = [char]0x2022
                            $global:SeasonEPNumber = "$SeasonTCText $global:season_number $bullet $EpisodeTCText $global:episodenumber"

                            if ($LibraryFolders -eq 'true') {
                                $EpisodeImageoriginal = "$EntryDir\$global:FileNaming.jpg"
                                $TestPath = $EntryDir
                                $Testfile = "$global:FileNaming"
                            }
                            Else {
                                $EpisodeImageoriginal = "$BackupPath\$($entry.RootFoldername)_$global:FileNaming.jpg"
                                $TestPath = $BackupPath
                                $Testfile = "$($entry.RootFoldername)_$global:FileNaming"
                            }

                            if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                                $EpisodeImageoriginal = ($EpisodeImageoriginal).Replace('\', '/').Replace('./', '/')
                                $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                            }
                            else {
                                $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
                                if ($fullTestPath) {
                                    $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                                }
                                Else {
                                    $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                                }
                            }

                            Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug

                            $EpisodeImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.RootFoldername)_$global:FileNaming.jpg"
                            $EpisodeImage = $EpisodeImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')

                            $cjkTitlePattern = '[\p{IsHiragana}\p{IsKatakana}\p{IsCJKUnifiedIdeographs}\p{IsThai}]'
                            $checkedItems.Add($hashtestpath)

                            if (($null -ne $FileTestOnTrigger -and $FileTestOnTrigger -eq 'false') -or (-not $directoryHashtable.ContainsKey("$hashtestpath"))) {
                                $Arturl = $null
                                if ($global:PlexTitleCardUrl -like "/library/*") {
                                    $Arturl = $plexurl + $global:PlexTitleCardUrl
                                }
                                Write-Entry -Message "Searching on Plex for $global:show_name | $global:SeasonEPNumber - Titlecard" -Path $global:configLogging -Color White -log Info
                                GetPlexArtworkUrl -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                if ($global:posterurl) {
                                    try {
                                        Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                        Write-Entry -Subtext "Downloading Titlecard from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                    }
                                    catch {
                                        if ($_.Exception.Response) {
                                            $statusCode = $_.Exception.Response.StatusCode.value__
                                        }
                                        else {
                                            $statusCode = $_.Exception.Message
                                        }
                                        Write-Entry -Subtext "An error occurred while downloading the artwork: $statusCode" -Path $global:configLogging -Color Red -log Error
                                        $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                    }
                                    if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue -WarningAction SilentlyContinue) {
                                        # Move file back to original naming with Brackets.
                                        try {
                                            # Attempt to move the item
                                            Move-Item -LiteralPath $EpisodeImage -Destination $EpisodeImageoriginal -Force -ErrorAction Stop

                                            # Log success if move was successful
                                            Write-Entry -Subtext "Added: $EpisodeImageoriginal" -Path $global:configLogging -Color Green -Log Info
                                        }
                                        catch {
                                            # Log the error if the move operation fails
                                            Write-Entry -Subtext "Failed to move $EpisodeImage to $EpisodeImageoriginal." -Path $global:configLogging -Color Red -Log Error
                                            Write-Entry -Subtext "Error: $_" -Path $global:configLogging -Color Red -Log Error
                                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                        }
                                        Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                        $global:EpisodeCount = Increment-GlobalStat 'EpisodeCount'
                                        $global:posterCount = Increment-GlobalStat 'posterCount'
                                    }
                                }
                                Else {
                                    Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                }

                            }
                            else {
                                if ($show_skipped -eq 'true' ) {
                                    Write-Entry -Subtext "Already exists: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                                }
                            }
                        }
                    }
                }
            }
        }
        Else {
            Write-Entry -Message "Rootfolder value: $($entry.RootFoldername)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Message "Path value: $($entry.Path)" -Path $global:configLogging -Color Cyan -log Debug
            Write-Entry -Message "Missing RootFolder for: $($entry.title) - you have to manually create the poster for it..." -Path $global:configLogging -Color Red -log Error
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
    Write-Entry -Message "Finished, Total images downloaded: $posterCount" -Path $global:configLogging -Color Green -log Info
    if ($posterCount -ge '1') {
        Write-Entry -Message "Show/Movie Posters downloaded: $($posterCount-$SeasonCount-$BackgroundCount-$EpisodeCount)| Season images downloaded: $SeasonCount | Background images downloaded: $BackgroundCount | TitleCards downloaded: $EpisodeCount" -Path $global:configLogging -Color Green -log Info
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
    Write-TextSizeCacheSummary
    Write-Entry -Message "Script execution time: $FormattedTimespawn" -Path $global:configLogging -Color White -log Info

    # Send Notification
    $argFallback = if ($FallbackCount -is [array]) { $FallbackCount.count } else { 0 }
    $argTextless = if ($TextlessCount -is [array]) { $TextlessCount.count } else { 0 }
    $argTruncated = if ($TextTruncatedCount -is [array]) { $TextTruncatedCount.count } else { 0 }
    Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $errorCount -FallbackCount $argFallback -TextlessCount $argTextless -TruncatedCount $argTruncated -PosterUnknownCount $PosterUnknownCount -PosterCount $posterCount -BackgroundCount $BackgroundCount -SeasonCount $SeasonCount -EpisodeCount $EpisodeCount

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
    try { $jsonOutput | Out-File -FilePath "$global:ScriptRoot\Logs\$Mode.json" -Encoding utf8 -ErrorAction Stop } catch {}

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
function MassDownloadJellyEmbyArtwork {
    if ($UseJellyfin -eq 'true') {
        CheckJellyfinAccess -JellyfinUrl $JellyfinUrl -JellyfinApi $JellyfinAPIKey
        $OtherMediaServerUrl = $JellyfinUrl
        $OtherMediaServerApiKey = $JellyfinAPIKey
        $global:OtherMediaServerHeaders = @{ "Authorization" = "MediaBrowser Token=`"$JellyfinAPIKey`"" }
    }
    if ($UseEmby -eq 'true') {
        CheckEmbyAccess -EmbyUrl $EmbyUrl -EmbyAPI $EmbyAPIKey
        $OtherMediaServerUrl = $EmbyUrl
        $OtherMediaServerApiKey = $EmbyAPIKey
        $global:OtherMediaServerHeaders = @{ "Authorization" = "MediaBrowser Token=`"$EmbyAPIKey`"" }
    }

    $Mode = "backup"
    Write-Entry -Message "Backup Mode Started..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Querying Jelly/Emby libraries..." -Path $global:configLogging -Color White -log Info

    $libsResponse = Invoke-RestMethod -Uri "$OtherMediaServerUrl/Library/VirtualFolders" -Headers $global:OtherMediaServerHeaders

    $posterCount = 0
    $BackgroundCount = 0
    $SeasonCount = 0
    $EpisodeCount = 0

    foreach ($lib in $libsResponse) {
        if ($lib.Name -in $LibsToExclude) { continue }

        $collectionType = $lib.CollectionType.ToLower()
        if ($collectionType -notin @("movies", "tvshows")) { continue }

        Write-Entry -Message "--- Processing Library: $($lib.Name) ---" -Path $global:configLogging -Color Cyan -log Info

        $itemsUrl = "$OtherMediaServerUrl/Items?ParentId=$($lib.ItemId)&Recursive=true&IncludeItemTypes=Movie,Series&fields=Path,Id,Name,Type,ProductionYear,OriginalTitle"
        $items = (Invoke-RestMethod -Uri $itemsUrl -Headers $global:OtherMediaServerHeaders).Items

        foreach ($item in $items) {
            # Extract Folder/File names
            $rootFolderName = Split-Path $item.Path -Leaf
            if ($item.Type -eq "Movie") {
                $rootFolderName = [System.IO.Path]::GetFileNameWithoutExtension($item.Path)
            }

            if ($LibraryFolders) {
                $entryDir = Join-Path $BackupPath "$($lib.Name)\$rootFolderName"
                $posterDest = Join-Path $entryDir "poster.jpg"
                $backdropDest = Join-Path $entryDir "background.jpg"
            }
            else {
                $entryDir = $BackupPath
                $posterDest = Join-Path $entryDir "$($rootFolderName).jpg"
                $backdropDest = Join-Path $entryDir "$($rootFolderName)_background.jpg"
            }

            if (!(Test-Path -LiteralPath $entryDir)) {
                New-Item -ItemType Directory -Path $entryDir -Force | Out-Null
            }

            # 1. Download Primary Poster
            $posterUrl = "$OtherMediaServerUrl/Items/$($item.Id)/Images/Primary"
            if (!(Test-Path -LiteralPath $posterDest)) {
                try {
                    Invoke-WebRequest -Uri $posterUrl -OutFile $posterDest -ErrorAction SilentlyContinue -WarningAction SilentlyContinue -Headers $global:OtherMediaServerHeaders
                    $global:posterCount = Increment-GlobalStat 'posterCount'
                    Write-Entry -Subtext "Added: $posterDest" -Path $global:configLogging -Color Green -Log Info
                }
                catch {
                    Write-Entry -Subtext "[ERROR-HERE] Failed to download poster for $($item.Name)" -Path $global:configLogging -Color Red -Log Error
                    $global:errorCount = Increment-GlobalStat 'errorCount'
                }
            }

            # 2. Download Backdrop
            if (!(Test-Path -LiteralPath $backdropDest)) {
                try {
                    Invoke-WebRequest -Uri "$OtherMediaServerUrl/Items/$($item.Id)/Images/Backdrop" -OutFile $backdropDest -ErrorAction SilentlyContinue -WarningAction SilentlyContinue -Headers $global:OtherMediaServerHeaders
                    $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
                    $global:posterCount = Increment-GlobalStat 'posterCount'
                    Write-Entry -Subtext "Added: $backdropDest" -Path $global:configLogging -Color Green -Log Info
                }
                catch {
                    Write-Entry -Subtext "No backdrop found for $($item.Name)" -Path $global:configLogging -Color Yellow -Log Debug
                    $global:errorCount = Increment-GlobalStat 'errorCount'
                }
            }

            if ($item.Type -eq "Series") {
                $seasons = (Invoke-RestMethod -Uri "$OtherMediaServerUrl/Shows/$($item.Id)/Seasons" -Headers $global:OtherMediaServerHeaders).Items
                foreach ($season in $seasons) {
                    $sNum = if ($null -ne $season.IndexNumber) { $season.IndexNumber.ToString("D2") } else { "00" }
                    $sDest = if ($LibraryFolders) { Join-Path $entryDir "Season$sNum.jpg" } else { Join-Path $entryDir "$($rootFolderName)_season$sNum.jpg" }

                    if (!(Test-Path -LiteralPath $sDest)) {
                        try {
                            Invoke-WebRequest -Uri "$OtherMediaServerUrl/Items/$($season.Id)/Images/Primary" -OutFile $sDest -ErrorAction SilentlyContinue -WarningAction SilentlyContinue -Headers $global:OtherMediaServerHeaders
                            Write-Entry -Subtext "Added: $sDest" -Path $global:configLogging -Color Green -Log Info
                        }
                        catch {
                            Write-Entry -Subtext "No season found for $($item.Name) | Season$sNum" -Path $global:configLogging -Color Yellow -Log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'
                        }
                    }
                }

                $episodes = (Invoke-RestMethod -Uri "$OtherMediaServerUrl/Shows/$($item.Id)/Episodes?Fields=ParentIndexNumber,IndexNumber" -Headers $global:OtherMediaServerHeaders).Items
                foreach ($ep in $episodes) {
                    $sNum = if ($null -ne $ep.ParentIndexNumber) { $ep.ParentIndexNumber.ToString("D2") } else { "00" }
                    $eNum = if ($null -ne $ep.IndexNumber) { $ep.IndexNumber.ToString("D2") } else { "00" }
                    $naming = "S$($sNum)E$($eNum)"
                    $epDest = if ($LibraryFolders) { Join-Path $entryDir "$naming.jpg" } else { Join-Path $entryDir "$($rootFolderName)_$naming.jpg" }

                    if (!(Test-Path -LiteralPath $epDest)) {
                        try {
                            Invoke-WebRequest -Uri "$OtherMediaServerUrl/Items/$($ep.Id)/Images/Primary" -OutFile $epDest -ErrorAction SilentlyContinue -WarningAction SilentlyContinue -Headers $global:OtherMediaServerHeaders
                            $global:EpisodeCount = Increment-GlobalStat 'EpisodeCount'
                            $global:posterCount = Increment-GlobalStat 'posterCount'
                            Write-Entry -Subtext "Added: $epDest" -Path $global:configLogging -Color Green -Log Info
                        }
                        catch {
                            Write-Entry -Subtext "No episode found for $($item.Name) | $naming" -Path $global:configLogging -Color Yellow -Log Error
                            $global:errorCount = Increment-GlobalStat 'errorCount'
                        }
                    }
                }
            }
        }
    }

    $endTime = Get-Date
    $executionTime = New-TimeSpan -Start $startTime -End $endTime
    # Format the execution time
    $hours = [math]::Floor($executionTime.TotalHours)
    $minutes = $executionTime.Minutes
    $seconds = $executionTime.Seconds
    $FormattedTimespawn = $hours.ToString() + "h " + $minutes.ToString() + "m " + $seconds.ToString() + "s "
    Write-Entry -Message "Finished, Total images downloaded: $posterCount" -Path $global:configLogging -Color Green -log Info
    if ($posterCount -ge '1') {
        Write-Entry -Message "Show/Movie Posters downloaded: $($posterCount-$SeasonCount-$BackgroundCount-$EpisodeCount)| Season images downloaded: $SeasonCount | Background images downloaded: $BackgroundCount | TitleCards downloaded: $EpisodeCount" -Path $global:configLogging -Color Green -log Info
    }
    if ($errorCount -ge '1') {
        Write-Entry -Message "During execution '$errorCount' Errors occurred, please check the log for a detailed description where you see [ERROR-HERE]." -Path $global:configLogging -Color White -log Info
    }
    Write-TextSizeCacheSummary
    Write-Entry -Message "Script execution time: $FormattedTimespawn" -Path $global:configLogging -Color White -log Info

    # Send Notification
    $argFallback = if ($FallbackCount -is [array]) { $FallbackCount.count } else { 0 }
    $argTextless = if ($TextlessCount -is [array]) { $TextlessCount.count } else { 0 }
    $argTruncated = if ($TextTruncatedCount -is [array]) { $TextTruncatedCount.count } else { 0 }
    Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $errorCount -FallbackCount $argFallback -TextlessCount $argTextless -TruncatedCount $argTruncated -PosterUnknownCount $PosterUnknownCount -PosterCount $posterCount -BackgroundCount $BackgroundCount -SeasonCount $SeasonCount -EpisodeCount $EpisodeCount

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
    try { $jsonOutput | Out-File -FilePath "$global:ScriptRoot\Logs\$Mode.json" -Encoding utf8 -ErrorAction Stop } catch {}

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
function MassRestorePlexArtwork {
    $Mode = "restore"
    Write-Entry -Message "Restore Mode Started..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Query plex libs..." -Path $global:configLogging -Color White -log Info
    $Libsoverview = [System.Collections.Generic.List[object]]::new()
    foreach ($lib in $Libs.MediaContainer.Directory) {
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
                HandleScriptExit -Message "Invalid lib chars"
            }
            $Libsoverview.Add($libtemp)
        }
    }
    if ($($Libsoverview.count) -lt 1) {
        Write-Entry -Subtext "0 libraries were found. Are you on the correct Plex server?" -Path $global:configLogging -Color Red -log Error
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
            foreach ($item in $Libcontent.MediaContainer.$contentquery) {
                $extractedFolder = $null
                $Seasondata = $null
                if ($contentquery -eq 'Directory') {
                    try {
                        [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($item.ratingKey) -Headers $extraPlexHeaders).content
                        [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$($item.ratingKey)/children? -Headers $extraPlexHeaders).content
                    }
                    catch {
                        Write-Entry -Subtext "Current Seasondata Plex Query: $($PlexUrl[0..10] -join '')****/library/metadata/$($item.ratingKey)/children?" -Path $global:configLogging -Color Cyan -log Debug
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

                    }
                }
                Else {
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
                # check if there are more then 1 entry in ids
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
    $Libraries | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexLibexport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    Write-Entry -Message "Export everything to a csv: $global:ScriptRoot\Logs\PlexLibexport.csv" -Path $global:configLogging -Color White -log Info

    # Initialize counter variable
    $posterCount = 0
    $SeasonCount = 0
    $EpisodeCount = 0
    $BackgroundCount = 0
    $PosterUnknownCount = 0
    $SkipTBACount = 0
    $SkipJapTitleCount = 0
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
        $Episodedata | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        if ($Episodedata) {
            Write-Entry -Subtext "Found '$($Episodedata.Episodes.split(',').count)' Episodes..." -Path $global:configLogging -Color Cyan -log Info
        }
    }

    # Test if csvÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´s are missing and create dummy file.
    if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
        $EpisodeDummycsv = New-Object psobject

        # Add members to the object with empty values
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Show Name" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Type" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Season Number" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Episodes" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "Title" -Value $null
        $EpisodeDummycsv | Add-Member -MemberType NoteProperty -Name "PlexTitleCardUrls" -Value $null

        $EpisodeDummycsv | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        Write-Entry -Message "No PlexEpisodeExport.csv found, creating dummy file for you..." -Path $global:configLogging -Color White -log Info
    }
    if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\PlexLibexport.csv" -ErrorAction SilentlyContinue -WarningAction SilentlyContinue)) {
        # Add members to the object with empty values
        $PlexLibDummycsv = New-Object psobject
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Library Name" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Library Type" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Library Language" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "title" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "originalTitle" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "SeasonNames" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "SeasonNumbers" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "SeasonRatingKeys" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "year" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "ratingKey" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "Path" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "MultipleVersions" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "PlexPosterUrl" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "PlexBackgroundUrl" -Value $null
        $PlexLibDummycsv | Add-Member -MemberType NoteProperty -Name "PlexSeasonUrls" -Value $null

        $PlexLibDummycsv | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexLibexport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        Write-Entry -Message "No PlexLibexport.csv found, creating dummy file for you..." -Path $global:configLogging -Color White -log Info
    }
    # Store all Files from asset dir in a hashtable
    $directoryHashtable = Get-AssetHashtable -TargetPath $BackupPath

    # Restore poster foreach movie
    $checkedItems = [System.Collections.Generic.List[object]]::new()

    Write-Entry -Message "Starting asset restore now, this can take a while..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Starting Movie Poster/Background restore part..." -Path $global:configLogging -Color Green -log Info

    $posterCount = 0
    $SeasonCount = 0
    $EpisodeCount = 0
    $BackgroundCount = 0

    $AllShows = $Libraries | Where-Object { $_.'Library Type' -eq 'show' }
    $AllMovies = $Libraries | Where-Object { $_.'Library Type' -eq 'movie' }

    # Optional filtering
    if ($RestoreLibrary) {
        $AllShows = $AllShows | Where-Object { $_.'Library Name' -eq $RestoreLibrary }
        $AllMovies = $AllMovies | Where-Object { $_.'Library Name' -eq $RestoreLibrary }
    }
    if ($RestoreItem) {
        $AllShows = $AllShows | Where-Object { $_.title -eq $RestoreItem -or $_.originalTitle -eq $RestoreItem -or $_.RootFoldername -eq $RestoreItem }
        $AllMovies = $AllMovies | Where-Object { $_.title -eq $RestoreItem -or $_.originalTitle -eq $RestoreItem -or $_.RootFoldername -eq $RestoreItem }
    }



    # Movie Part
    foreach ($entry in $AllMovies) {
        if ($LibraryFolders -eq 'true') {
            $LibraryName = $entry.'Library Name'
            $EntryDir = "$BackupPath\$LibraryName\$($entry.RootFoldername)"
        } Else {
            $EntryDir = $BackupPath
        }

        $posterPath = if ($LibraryFolders -eq 'true') { "$EntryDir\poster.jpg" } else { "$EntryDir\$($entry.RootFoldername).jpg" }
        $backgroundPath = if ($LibraryFolders -eq 'true') { "$EntryDir\background.jpg" } else { "$EntryDir\$($entry.RootFoldername)_background.jpg" }

        if (!$RestoreType -or $RestoreType -eq 'poster') {
            if (Push-PlexAsset -RatingKey $entry.ratingKey -AssetPath $posterPath -Type "posters") { $posterCount++ }
        }
        if (!$RestoreType -or $RestoreType -eq 'background') {
            if (Push-PlexAsset -RatingKey $entry.ratingKey -AssetPath $backgroundPath -Type "arts") { $BackgroundCount++ }
        }
    }

    # Show Part
    foreach ($entry in $AllShows) {
        if ($LibraryFolders -eq 'true') {
            $LibraryName = $entry.'Library Name'
            $EntryDir = "$BackupPath\$LibraryName\$($entry.RootFoldername)"
        } Else {
            $EntryDir = $BackupPath
        }

        $posterPath = if ($LibraryFolders -eq 'true') { "$EntryDir\poster.jpg" } else { "$EntryDir\$($entry.RootFoldername).jpg" }
        $backgroundPath = if ($LibraryFolders -eq 'true') { "$EntryDir\background.jpg" } else { "$EntryDir\$($entry.RootFoldername)_background.jpg" }

        if (!$RestoreType -or $RestoreType -eq 'poster') {
            if (Push-PlexAsset -RatingKey $entry.ratingKey -AssetPath $posterPath -Type "posters") { $posterCount++ }
        }
        if (!$RestoreType -or $RestoreType -eq 'background') {
            if (Push-PlexAsset -RatingKey $entry.ratingKey -AssetPath $backgroundPath -Type "arts") { $BackgroundCount++ }
        }

        # Seasons
        if ($entry.SeasonRatingKeys) {
            $seasonKeys = $entry.SeasonRatingKeys -split ','
            $seasonNums = $entry.SeasonNumbers -split ','
            for ($i = 0; $i -lt $seasonKeys.Count; $i++) {
                $snum = $seasonNums[$i]
                $skey = $seasonKeys[$i]
                $snumFormatted = "{0:D2}" -f [int]$snum
                $seasonPosterPath = if ($LibraryFolders -eq 'true') { "$EntryDir\Season$snumFormatted.jpg" } else { "$EntryDir\$($entry.RootFoldername)_Season$snumFormatted.jpg" }

                if (!$RestoreType -or $RestoreType -eq 'season') {
                    if (Push-PlexAsset -RatingKey $skey -AssetPath $seasonPosterPath -Type "posters") { $SeasonCount++ }
                }
            }
        }

        # Episodes
        if (!$RestoreType -or $RestoreType -eq 'titlecard' -or $RestoreType -eq 'episode') {
            if ($entry.SeasonRatingKeys) {
                $seasonKeys = $entry.SeasonRatingKeys -split ','
                foreach ($skey in $seasonKeys) {
                    try {
                        [xml]$Seasondata = (Invoke-WebRequest "$PlexUrl/library/metadata/$skey/children?" -Headers $extraPlexHeaders).content
                        foreach ($ep in $Seasondata.MediaContainer.video) {
                            $epNum = $ep.index
                            $epTitle = $ep.title
                            $epKey = $ep.ratingKey

                            $snum = $Seasondata.MediaContainer.parentIndex
                            $snumFormatted = "{0:D2}" -f [int]$snum
                            $epNumFormatted = "{0:D2}" -f [int]$epNum

                            $titlecardPath = if ($LibraryFolders -eq 'true') { "$EntryDir\S${snumFormatted}E${epNumFormatted}.jpg" } else { "$EntryDir\$($entry.RootFoldername)_S${snumFormatted}E${epNumFormatted}.jpg" }

                            if (Push-PlexAsset -RatingKey $epKey -AssetPath $titlecardPath -Type "posters") { $EpisodeCount++ }
                        }
                    } catch {}
                }
            }
        }
    }

    Write-Entry -Message "Restore completed! Posters: $posterCount | Backgrounds: $BackgroundCount | Seasons: $SeasonCount | Episodes: $EpisodeCount" -Path $global:configLogging -Color Green -log Info
}
function MassRestoreJellyEmbyArtwork {

    if ($UseJellyfin -eq 'true') {
        CheckJellyfinAccess -JellyfinUrl $JellyfinUrl -JellyfinApi $JellyfinAPIKey
        $OtherMediaServerUrl = $JellyfinUrl
        $OtherMediaServerApiKey = $JellyfinAPIKey
        $global:OtherMediaServerHeaders = @{ "Authorization" = "MediaBrowser Token=`"$JellyfinAPIKey`"" }
    }
    if ($UseEmby -eq 'true') {
        CheckEmbyAccess -EmbyUrl $EmbyUrl -EmbyAPI $EmbyAPIKey
        $OtherMediaServerUrl = $EmbyUrl
        $OtherMediaServerApiKey = $EmbyAPIKey
        $global:OtherMediaServerHeaders = @{ "Authorization" = "MediaBrowser Token=`"$EmbyAPIKey`"" }
    }

    $Mode = "restore"
    Write-Entry -Message "Restore Mode Started..." -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Querying Jelly/Emby libraries..." -Path $global:configLogging -Color White -log Info

    $libsResponse = Invoke-RestMethod -Uri "$OtherMediaServerUrl/Library/VirtualFolders" -Headers $global:OtherMediaServerHeaders

    $posterCount = 0
    $BackgroundCount = 0
    $SeasonCount = 0
    $EpisodeCount = 0

    foreach ($lib in $libsResponse) {
        if ($lib.Name -in $LibsToExclude) { continue }

        $collectionType = $lib.CollectionType.ToLower()
        if ($collectionType -notin @("movies", "tvshows")) { continue }

        Write-Entry -Message "--- Processing Library: $($lib.Name) ---" -Path $global:configLogging -Color Cyan -log Info

        $itemsUrl = "$OtherMediaServerUrl/Items?ParentId=$($lib.ItemId)&Recursive=true&IncludeItemTypes=Movie,Series&fields=Path,Id,Name,Type,ProductionYear,OriginalTitle"
        $items = (Invoke-RestMethod -Uri $itemsUrl -Headers $global:OtherMediaServerHeaders).Items



    foreach ($item in $items) {
        $rootFolderName = Split-Path $item.Path -Leaf
        if ($item.Type -eq "Movie") {
            $rootFolderName = [System.IO.Path]::GetFileNameWithoutExtension($item.Path)
        }

        if ($RestoreItem -and $item.Name -ne $RestoreItem -and $item.OriginalTitle -ne $RestoreItem -and $rootFolderName -ne $RestoreItem) { continue }

        if ($LibraryFolders) {
            $entryDir = Join-Path $BackupPath "$($lib.Name)\$rootFolderName"
            $posterDest = Join-Path $entryDir "poster.jpg"
            $backdropDest = Join-Path $entryDir "background.jpg"
        }
        else {
            $entryDir = $BackupPath
            $posterDest = Join-Path $entryDir "$($rootFolderName).jpg"
            $backdropDest = Join-Path $entryDir "$($rootFolderName)_background.jpg"
        }

        if (!$RestoreType -or $RestoreType -eq 'poster') {
            if (Push-EmbyAsset -ItemId $item.Id -AssetPath $posterDest -Type "Primary") { $posterCount++ }
        }
        if (!$RestoreType -or $RestoreType -eq 'background') {
            if (Push-EmbyAsset -ItemId $item.Id -AssetPath $backdropDest -Type "Backdrop") { $BackgroundCount++ }
        }

        if ($item.Type -eq "Series") {
            $seasons = (Invoke-RestMethod -Uri "$OtherMediaServerUrl/Shows/$($item.Id)/Seasons" -Headers $global:OtherMediaServerHeaders).Items
            foreach ($season in $seasons) {
                $sNum = if ($null -ne $season.IndexNumber) { $season.IndexNumber.ToString("D2") } else { "00" }
                $sDest = if ($LibraryFolders) { Join-Path $entryDir "Season$sNum.jpg" } else { Join-Path $entryDir "$($rootFolderName)_season$sNum.jpg" }

                if (!$RestoreType -or $RestoreType -eq 'season') {
                    if (Push-EmbyAsset -ItemId $season.Id -AssetPath $sDest -Type "Primary") { $SeasonCount++ }
                }
            }

            $episodes = (Invoke-RestMethod -Uri "$OtherMediaServerUrl/Shows/$($item.Id)/Episodes?Fields=ParentIndexNumber,IndexNumber" -Headers $global:OtherMediaServerHeaders).Items
            foreach ($ep in $episodes) {
                $sNum = if ($null -ne $ep.ParentIndexNumber) { $ep.ParentIndexNumber.ToString("D2") } else { "00" }
                $eNum = if ($null -ne $ep.IndexNumber) { $ep.IndexNumber.ToString("D2") } else { "00" }
                $naming = "S$($sNum)E$($eNum)"
                $epDest = if ($LibraryFolders) { Join-Path $entryDir "$naming.jpg" } else { Join-Path $entryDir "$($rootFolderName)_$naming.jpg" }

                if (!$RestoreType -or $RestoreType -eq 'titlecard' -or $RestoreType -eq 'episode') {
                    if (Push-EmbyAsset -ItemId $ep.Id -AssetPath $epDest -Type "Primary") { $EpisodeCount++ }
                }
            }
        }
    }
}
}
