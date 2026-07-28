#region Normal Mode
    if ($UISchedule -or $ContainerSchedule) {
        $Mode = "scheduled"
        Write-Entry -Message "Scheduled Mode Started..." -Path $global:configLogging -Color White -log Info
    }
    Else {
        $Mode = "normal"
        Write-Entry -Message "Normal Mode Started..." -Path $global:configLogging -Color White -log Info
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
                        HandleScriptExit -Message "Invalid chars on lib"
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

                Write-Entry -Subtext "Fetching Library ID: $($Library.ID) | Start: $searchsize | Total: $totalContentSize" -Path $global:configLogging -Color Cyan -log Debug

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
            if ($global:logLevel -eq '3') {
                $MasterXml = New-Object System.Xml.XmlDocument
                $RootNode = $MasterXml.CreateElement("PlexExport")
                $MasterXml.AppendChild($RootNode) | Out-Null
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

                # Build a lightweight metadata object from already fetched section listing data.
                $metadataDoc = New-Object System.Xml.XmlDocument
                $metadataRoot = $metadataDoc.CreateElement('MediaContainer')
                $metadataDoc.AppendChild($metadataRoot) | Out-Null
                $importedItemNode = $metadataDoc.ImportNode($item, $true)
                $metadataRoot.AppendChild($importedItemNode) | Out-Null
                $Metadata = $metadataDoc

                # For movies, section-level data can miss guids in some setups. Only then fetch full metadata.
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
                if ($global:logLevel -eq '3') {
                    $ItemWrapper = $MasterXml.CreateElement("Item")
                    $ItemWrapper.SetAttribute("ratingKey", $item.ratingKey)
                    $ItemWrapper.SetAttribute("title", $item.title)

                    $ImportedMetadata = $MasterXml.ImportNode($Metadata.MediaContainer, $true)
                    $MetadataWrapper = $MasterXml.CreateElement("RawMetadata")
                    $MetadataWrapper.AppendChild($ImportedMetadata) | Out-Null
                    $ItemWrapper.AppendChild($MetadataWrapper) | Out-Null

                    if ($contentquery -eq 'Directory') {
                        $ImportedSeasons = $MasterXml.ImportNode($Seasondata.MediaContainer, $true)
                        $SeasonsWrapper = $MasterXml.CreateElement("RawChildren")
                        $SeasonsWrapper.AppendChild($ImportedSeasons) | Out-Null
                        $ItemWrapper.AppendChild($SeasonsWrapper) | Out-Null
                    }

                    $RootNode.AppendChild($ItemWrapper) | Out-Null
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
            if ($global:logLevel -eq '3') {
                if ($RootNode.HasChildNodes) {
                    $XmlPath = Join-Path $global:ScriptRoot "Logs/Raw_Plex_Metadata_$($Library.Name).xml"
                    try {
                        $MasterXml.Save($XmlPath)

                        # Verification: Force PowerShell to check the disk
                        if (Test-Path $XmlPath) {
                            Write-Entry -Subtext "Raw XML saved and verified: $XmlPath" -Path $global:configLogging -Color Cyan -log Debug
                        }
                        else {
                            throw "XML.Save() returned no error, but the file does not exist on disk."
                        }
                    }
                    catch {
                        Write-Entry -Message "CRITICAL: Failed to save XML for $($Library.Name)" -Path $global:configLogging -Color Red -log Error
                        Write-Entry -Subtext "Reason: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
                    }
                }
            }
        }
    }
    Write-Entry -Subtext "Found '$($Libraries.count)' Items..." -Path $global:configLogging -Color Cyan -log Info
    $Libraries | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexLibexport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
    Write-Entry -Message "Export everything to a csv: $global:ScriptRoot\Logs\PlexLibexport.csv" -Path $global:configLogging -Color White -log Info

    # Initialize counter variable
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

    $AllShows = $Libraries | Where-Object { $_.'Library Type' -eq 'show' }
    $AllMovies = $Libraries | Where-Object { $_.'Library Type' -eq 'movie' }

    # Getting information of all Episodes
    if ($global:TitleCards -eq 'true') {
        Write-Entry -Message "Query episodes data from all Libs, this can take a while..." -Path $global:configLogging -Color White -log Info
        # Query episode info
        $global:Episodedata = [System.Collections.Generic.List[object]]::new()
        # Debug Export
        if ($global:logLevel -eq '3') {
            $MasterXml = New-Object System.Xml.XmlDocument
            $RootNode = $MasterXml.CreateElement("PlexEpisodeExport")
            $MasterXml.AppendChild($RootNode) | Out-Null
        }
        foreach ($showentry in $AllShows) {
            # Getting child entries for each season
            $splittedkeys = $showentry.SeasonRatingKeys.split(',')
            foreach ($key in $splittedkeys) {
                if ([string]::IsNullOrWhiteSpace($key)) { continue }
                $requestUrl = "$PlexUrl/library/metadata/$key/children?"
                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "Requesting metadata for Key: $key | URL: $(RedactMediaServerUrl -url $requestUrl)" -Path $global:configLogging -Color Cyan -log Debug
                try {
                    $response = Invoke-WebRequest $requestUrl -Headers $extraPlexHeaders -ErrorAction Stop
                    [xml]$Seasondata = $response.Content

                    if (-not $Seasondata.MediaContainer) {
                        Write-Entry -Subtext "  WARNING: No MediaContainer found for Key: $key" -Path $global:configLogging -Color Yellow -log Debug
                        Write-Entry -Subtext "  Raw Response Start: $($response.Content.Substring(0, [Math]::Min(100, $response.Content.Length)))" -Path $global:configLogging -Color Yellow -log Debug
                    }
                }
                catch {
                    Write-Entry -Subtext "  Failed to query Key: $key" -Path $global:configLogging -Color Red -log Error
                    Write-Entry -Subtext "  Error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
                    continue
                }
                if ($global:logLevel -eq '3') {
                    $ImportedNode = $MasterXml.ImportNode($Seasondata.MediaContainer, $true)
                    $ImportedNode.SetAttribute("sourceKey", $key)
                    $RootNode.AppendChild($ImportedNode) | Out-Null
                }
                $FileMetadata = $Seasondata.MediaContainer.video.media
                $ExtractedEpisodes = $Seasondata.MediaContainer.video
                Write-Entry -Subtext "  Key $($key): Found $($ExtractedEpisodes.Count) episode nodes. ParentTitle: [$($Seasondata.MediaContainer.grandparentTitle)]" -Path $global:configLogging -Color Cyan -log Debug

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
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "OtherMediaServerBackgroundUrl" -Value $showentry.OtherMediaServerBackgroundUrl
                $tempseasondata | Add-Member -MemberType NoteProperty -Name "PlexBackgroundUrl" -Value $showentry.PlexBackgroundUrl
                if ($FileMetadata) {
                    $tempseasondata | Add-Member -MemberType NoteProperty -Name "Resolutions" -Value $Resolution
                }
                $global:Episodedata.Add($tempseasondata)
                Write-Entry -Subtext "  Found [$($tempseasondata.'Show Name')] of type $($tempseasondata.Type) for season $($tempseasondata.'Season Number')" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging -Color Cyan -log Debug
            }
        }
        if ($global:logLevel -eq '3') {
            if ($RootNode.HasChildNodes) {
                $XmlPath = Join-Path $global:ScriptRoot "Logs/Raw_Plex_Episode_Metadata.xml"
                try {
                    $MasterXml.Save($XmlPath)
                    if (Test-Path $XmlPath) {
                        Write-Entry -Subtext "  Raw Episode XML saved to $XmlPath" -Path $global:configLogging -Color Cyan -log Debug
                    }
                    else {
                        Write-Entry -Subtext "  Episode file missing after save." -Path $global:configLogging -Color Cyan -log Debug
                    }
                }
                catch {
                    Write-Entry -Subtext "  Failed to save Episode XML" -Path $global:configLogging -Color Red -log Error
                    Write-Entry -Subtext "  Reason: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Error
                }
            }
        }
        $global:Episodedata | Select-Object * | Export-Csv -Path "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force
        if ($global:Episodedata) {
            $totalEps = ($global:Episodedata.Episodes -join ',').Split(',').Count
            Write-Entry -Subtext "Found '$totalEps' Episodes across $($global:Episodedata.Count) seasons..." -Path $global:configLogging -Color Cyan -log Info
        }
    }

    # Test if csvÂ´s are missing and create dummy file.
    if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\PlexEpisodeExport.csv" -ErrorAction SilentlyContinue)) {
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
    if (!(Get-ChildItem -LiteralPath "$global:ScriptRoot\Logs\PlexLibexport.csv" -ErrorAction SilentlyContinue)) {
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

    Write-Entry -Message "Starting Show/Season Poster/Background Creation part..." -Path $global:configLogging -Color Green -log Info
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

    # TitleCard Part - separate parallel loop over episode season data
    if ($global:TitleCards -eq 'true') {
        Write-Entry -Message "Starting TitleCard Creation part..." -Path $global:configLogging -Color Green -log Info
        $global:Episodedata | ForEach-Object -Parallel {
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
    Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $errorCount -FallbackCount $argFallback -TextlessCount $argTextless -TruncatedCount $argTruncated -PosterUnknownCount $PosterUnknownCount -SkipTBACount $SkipTBACount -SkipJapTitleCount $SkipJapTitleCount -PosterCount $posterCount -BackgroundCount $BackgroundCount -SeasonCount $SeasonCount -EpisodeCount $EpisodeCount -ImagesCleared $ImagesCleared -PathsCleared $PathsCleared -SavedSizeString $savedsizestring

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


