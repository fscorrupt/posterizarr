#region Tautulli Mode
    # Get Plex data for this Show/Movie
    # {rating_key}	The unique identifier for the movie, episode, or track.
    # {parent_rating_key}	The unique identifier for the season or album.
    # {grandparent_rating_key}	The unique identifier for the TV show or artist.
    $Mode = "tautulli"
    Write-Entry -Message "Tautulli Mode Started..." -Path $global:configLogging -Color White -log Info
    if ($UsePlex -eq 'true') {
        $Upload2Plex = 'true'
        Write-Entry -Subtext "Tautulli Mode forces direct Plex upload for generated assets." -Path $global:configLogging -Color Cyan -log Info
    }
    $Libraries = [System.Collections.Generic.List[object]]::new()
    if (($RatingKey -or $parentratingkey -or $grandparentratingkey) -and $mediatype) {
        if ($mediatype -eq 'movie') {
            $contentquery = "video"
            $queryKey = $RatingKey
        }
        Elseif ($mediatype -eq 'show') {
            $contentquery = "Directory"
            $queryKey = $RatingKey
        }
        Elseif ($mediatype -eq 'season') {
            $contentquery = "Directory"
            $queryKey = $parentratingkey
        }
        Else {
            $contentquery = "Directory"
            $queryKey = if ($grandparentratingkey) { $grandparentratingkey }Else { $parentratingkey }
        }
        $extractedFolder = $null
        $Seasondata = $null
        if ($PlexToken) {
            if ($contentquery -eq 'Directory') {
                [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($queryKey)?X-Plex-Token=$PlexToken -Headers $extraPlexHeaders).content
                [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$($queryKey)/children?X-Plex-Token=$PlexToken -Headers $extraPlexHeaders).content
            }
            Else {
                [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($queryKey)?X-Plex-Token=$PlexToken -Headers $extraPlexHeaders).content
            }
        }
        Else {
            if ($contentquery -eq 'Directory') {
                [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($queryKey) -Headers $extraPlexHeaders).content
                [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$($queryKey)/children? -Headers $extraPlexHeaders).content
            }
            Else {
                [xml]$Metadata = (Invoke-WebRequest $PlexUrl/library/metadata/$($queryKey) -Headers $extraPlexHeaders).content
            }
        }

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
    }

    $AllShows = $Libraries | Where-Object { $_.'Library Type' -eq 'show' }
    $AllMovies = $Libraries | Where-Object { $_.'Library Type' -eq 'movie' }

    if ($global:TitleCards -eq 'true' -and $mediatype -ne 'movie') {
        Write-Entry -Message "Query episodes data..." -Path $global:configLogging -Color White -log Info
        # Query episode info
        $Episodedata = [System.Collections.Generic.List[object]]::new()
        foreach ($showentry in $AllShows) {
            # Getting child entries for each season
            $splittedkeys = $showentry.SeasonRatingKeys.split(',')
            foreach ($key in $splittedkeys) {
                if ($PlexToken) {
                    [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$key/children?X-Plex-Token=$PlexToken -Headers $extraPlexHeaders).content
                }
                Else {
                    [xml]$Seasondata = (Invoke-WebRequest $PlexUrl/library/metadata/$key/children? -Headers $extraPlexHeaders).content
                }
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


