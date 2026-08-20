#region LogoUpdater Mode
    $global:UploadCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['UploadCount'] = 0 }
    $matched = 0
    $OriginalLibraryName = $LibraryName
    $Mode = "logoupdater"
    Write-Entry -Message "LogoUpdater Mode Started..." -Path $global:configLogging -Color White -log Info



    $isOtherServer = ($UseJellyfin -eq 'true' -or $UseEmby -eq 'true')
    $AllLibs = $null
    if ($isOtherServer) {
        $allLibsquery = "$($OtherMediaServerUrl.TrimEnd('/'))/Library/VirtualFolders"
        try {
            $AllLibs = Invoke-RestMethod -Method Get -Uri $allLibsquery -Headers $global:OtherMediaServerHeaders -ErrorAction Stop
        } catch {
            Write-Entry -Message "Error querying JF/Emby libs" -Path $global:configLogging -Color Red -log Error
        }
    }

    if (-not $LibraryName) {
        # Prompt for library
        $Libsoverview = [System.Collections.Generic.List[object]]::new()
        if ($isOtherServer) {
            Write-Entry -Message "Query JF/Emby libs..." -Path $global:configLogging -Color White -log Info
            if ($AllLibs) {
                foreach ($lib in $AllLibs) {
                    if ($lib.Name -notin $LibstoExclude -and ($lib.CollectionType -eq 'movies' -or $lib.CollectionType -eq 'tvshows')) {
                        $libtemp = New-Object psobject
                        $libtemp | Add-Member -MemberType NoteProperty -Name "ID" -Value $lib.ItemId
                        $libtemp | Add-Member -MemberType NoteProperty -Name "Name" -Value $lib.Name
                        $libtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value $lib.CollectionType
                        $Libsoverview.Add($libtemp)
                    }
                }
            }
        } else {
            Write-Entry -Message "Query plex libs..." -Path $global:configLogging -Color White -log Info
            foreach ($lib in $Libs.MediaContainer.Directory) {
                if ($lib.title -notin $LibstoExclude -and ($lib.type -eq 'movie' -or $lib.type -eq 'show')) {
                    $libtemp = New-Object psobject
                    $libtemp | Add-Member -MemberType NoteProperty -Name "ID" -Value $lib.key
                    $libtemp | Add-Member -MemberType NoteProperty -Name "Name" -Value $lib.title
                    $libtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value $lib.type
                    $Libsoverview.Add($libtemp)
                }
            }
        }

        if ($Libsoverview.Count -eq 0) {
            Write-Entry -Message "No suitable Movie or TV Show libraries found." -Path $global:configLogging -Color Red -log Error
            HandleScriptExit -Message "No libs found for LogoUpdater"
        }

        Write-Host "Available Libraries:" -ForegroundColor Cyan
        for ($i = 0; $i -lt $Libsoverview.Count; $i++) {
            Write-Host "[$($i + 1)] $($Libsoverview[$i].Name) ($($Libsoverview[$i].Type))"
        }

        $selection = Read-Host "Please select a library number to scan (or press Enter to exit)"
        if ([string]::IsNullOrWhiteSpace($selection)) {
            Write-Entry -Message "Operation cancelled by user." -Path $global:configLogging -Color Yellow -log Info
            HandleScriptExit -Message "Cancelled by user"
        }

        try {
            $selInt = [int]$selection
            if ($selInt -lt 1 -or $selInt -gt $Libsoverview.Count) { throw }
            $LibraryName = $Libsoverview[$selInt - 1].Name
        }
        catch {
            Write-Entry -Message "Invalid selection." -Path $global:configLogging -Color Red -log Error
            HandleScriptExit -Message "Invalid library selection"
        }
    }

    $LibrariesToProcess = @()
    if ($LibraryName -eq "all") {
        if ($isOtherServer) {
            if ($AllLibs) {
                foreach ($lib in $AllLibs) {
                    if ($lib.Name -notin $LibstoExclude -and ($lib.CollectionType -eq 'movies' -or $lib.CollectionType -eq 'tvshows')) {
                        $LibrariesToProcess += $lib
                    }
                }
            }
        } else {
            foreach ($lib in $Libs.MediaContainer.Directory) {
                if ($lib.title -notin $LibstoExclude -and ($lib.type -eq 'movie' -or $lib.type -eq 'show')) {
                    $LibrariesToProcess += $lib
                }
            }
        }
    }
    else {
        if ($isOtherServer) {
            $SelectedLib = $AllLibs | Where-Object { $_.Name -eq $LibraryName }
            if ($SelectedLib) {
                $LibrariesToProcess += $SelectedLib
            }
        } else {
            $SelectedLib = $Libs.MediaContainer.Directory | Where-Object { $_.title -eq $LibraryName }
            if ($SelectedLib) {
                $LibrariesToProcess += $SelectedLib
            }
        }
    }

    if ($LibrariesToProcess.Count -eq 0) {
        Write-Entry -Message "No suitable libraries found to process." -Path $global:configLogging -Color Red -log Error
        HandleScriptExit -Message "No libraries found"
    }

    foreach ($SelectedLib in $LibrariesToProcess) {
        if ($isOtherServer) {
            $LibraryName = $SelectedLib.Name
            Set-LibraryLanguageOverride -LibraryName $LibraryName
            Write-Entry -Message "Processing library: $LibraryName ($($SelectedLib.CollectionType))" -Path $global:configLogging -Color Cyan -log Info
            
            $allItems = [System.Collections.Generic.List[object]]::new()
            $libId = $SelectedLib.ItemId
            $allMoviesquery = "$OtherMediaServerUrl/Items?ParentId=$libId&Recursive=true&Fields=ProviderIds,OriginalTitle,ImageTags,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&IncludeItemTypes=Movie,Series"
            try {
                $Querytemp = Invoke-RestMethod -Method Get -Uri $allMoviesquery -Headers $global:OtherMediaServerHeaders
                if ($Querytemp.Items) {
                    foreach ($item in $Querytemp.Items) {
                        $allItems.Add($item)
                    }
                }
            } catch {
                Write-Entry -Subtext "Error fetching items for $LibraryName" -Path $global:configLogging -Color Red -log Error
                continue
            }
            
            Write-Entry -Subtext "Found $($allItems.Count) items. Checking for missing logos..." -Path $global:configLogging -Color Cyan -log Info
            
            foreach ($item in $allItems) {
                $ratingKey = $item.Id
                $title = $item.Name
                $hasLogo = if ($item.ImageTags -and $item.ImageTags.Logo) { $true } else { $false }
                
                if ($hasLogo) {
                    if ($LogoRevert) {
                        Write-Entry -Message "[$title] Logo exists. Attempting Revert..." -Path $global:configLogging -Color Yellow -log Info
                        $deleteUrl = "$OtherMediaServerUrl/Items/$ratingKey/Images/Logo"
                        try {
                            Invoke-RestMethod -Method Delete -Uri $deleteUrl -Headers $global:OtherMediaServerHeaders
                            Write-Entry -Subtext "[$title] Successfully deleted via API." -Path $global:configLogging -Color Green -log Info
                            $global:UploadCount = Increment-GlobalStat 'UploadCount'
                        } catch {
                            Write-Entry -Subtext "[$title] Unexpected error during deletion: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        }
                        continue
                    }
                    if ($ForceReplace) {
                        Write-Entry -Message "[$title] Logo exists but ForceReplace is enabled. Attempting to fetch..." -Path $global:configLogging -Color Yellow -log Info
                    }
                    else {
                        Write-Entry -Subtext "[$title] Logo already exists. Skipping." -Path $global:configLogging -Color Cyan -log Debug
                        continue
                    }
                } else {
                    if ($LogoRevert) {
                        continue
                    }
                    Write-Entry -Message "[$title] Missing Logo. Attempting to fetch..." -Path $global:configLogging -Color Yellow -log Info
                }
                
                $global:tmdbid = $item.ProviderIds.Tmdb
                $global:tvdbid = $item.ProviderIds.Tvdb
                $global:imdbid = $item.ProviderIds.Imdb
                $global:LogoUrl = $null
                $global:UseClearlogo = 'true'
                $global:UseClearart = 'false'
                
                if (-not $global:tmdbid -and -not $global:tvdbid -and -not $global:imdbid) {
                    Write-Entry -Subtext "[$title] Could not extract any IDs." -Path $global:configLogging -Color Yellow -log Warning
                    continue
                }
                
                $mediaType = if ($item.Type -eq 'Movie') { 'movie' } else { 'tv' }
                $tvdbType = if ($item.Type -eq 'Movie') { 'movies' } else { 'series' }
                $fanartType = if ($item.Type -eq 'Movie') { 'movies' } else { 'tv' }
                
                GetTMDBLogo -Type $mediaType | Out-Null
                if (-not $global:LogoUrl) { GetTVDBLogo -Type $tvdbType | Out-Null }
                if (-not $global:LogoUrl) { GetFanartLogo -Type $fanartType | Out-Null }
                
                if ($global:LogoUrl) {
                    Write-Entry -Subtext "[$title] Found Logo URL: $global:LogoUrl" -Path $global:configLogging -Color Green -log Info
                    $global:matched++
                    
                    $tempLogo = Join-Path $global:ScriptRoot -ChildPath "temp\logo_$ratingKey.png"
                    try {
                        Invoke-WebRequest -Uri $global:LogoUrl -OutFile $tempLogo -ErrorAction Stop
                        
                        if ($magick) {
                            $CommentArguments = "`"$tempLogo`" -set `"comment`" `"created with posterizarr`" `"$tempLogo`""
                            InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                        }
                        
                        $uploadUri = "$OtherMediaServerUrl/Items/$ratingKey/Images/Logo"
                        Write-Entry -Subtext "[$title] Uploading Logo to Jellyfin/Emby..." -Path $global:configLogging -Color DarkMagenta -log Info
                        
                        $base64Logo = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tempLogo))
                        Invoke-RestMethod -Method Post -Uri $uploadUri -Headers $global:OtherMediaServerHeaders -Body $base64Logo -ContentType "image/png"
                        Write-Entry -Subtext "[$title] Logo uploaded successfully!" -Path $global:configLogging -Color Green -log Info
                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                        
                    } catch {
                        Write-Entry -Subtext "[$title] Processing failed: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        $global:errorCount = Increment-GlobalStat 'errorCount'
                    } finally {
                        if (Test-Path $tempLogo) { Remove-Item -LiteralPath $tempLogo -Force }
                    }
                } else {
                    Write-Entry -Subtext "[$title] No Logo found online." -Path $global:configLogging -Color Yellow -log Warning
                }
            }
        } else {
            $LibraryName = $SelectedLib.title
            Set-LibraryLanguageOverride -LibraryName $LibraryName
            Write-Entry -Message "Processing library: $LibraryName ($($SelectedLib.type))" -Path $global:configLogging -Color Cyan -log Info

        $PlexHeaders = @{}
        if ($PlexToken) {
            $PlexHeaders['X-Plex-Token'] = $PlexToken
        }

        # Fetch all items in library
        $searchsize = 0
        $totalContentSize = 1
        $allItems = [System.Collections.Generic.List[object]]::new()

        Write-Entry -Subtext "Fetching items from Plex..." -Path $global:configLogging -Color White -log Info
        do {
            $PlexHeaders['X-Plex-Container-Start'] = $searchsize
            $PlexHeaders['X-Plex-Container-Size'] = '1000'

            $response = Invoke-WebRequest -Uri "$PlexUrl/library/sections/$($SelectedLib.key)/all" -Headers $PlexHeaders
            [xml]$additionalContent = $response.Content

            if ($totalContentSize -eq 1) {
                $totalContentSize = $additionalContent.MediaContainer.totalSize
            }

            $contentquery = if ($additionalContent.MediaContainer.video) { 'video' } else { 'Directory' }
            foreach ($item in $additionalContent.MediaContainer.$contentquery) {
                $allItems.Add($item)
            }

            $searchsize += [int]$additionalContent.MediaContainer.Size
        } until ($searchsize -ge $totalContentSize)

        Write-Entry -Subtext "Found $($allItems.Count) items. Checking for missing logos..." -Path $global:configLogging -Color Cyan -log Info

        foreach ($item in $allItems) {
            $ratingKey = $item.ratingKey
            $title = $item.title

            # Check if item already has a clearLogo
            $metadataResponse = Invoke-WebRequest -Uri "$PlexUrl/library/metadata/$ratingKey" -Headers $PlexHeaders
            [xml]$metadataXml = $metadataResponse.Content

            $hasLogo = $false

            $mediaItem = if ($metadataXml.MediaContainer.Video) { $metadataXml.MediaContainer.Video } else { $metadataXml.MediaContainer.Directory }

            if ($mediaItem.Image) {
                foreach ($img in $mediaItem.Image) {
                    if ($img.type -eq 'clearLogo') {
                        $hasLogo = $true
                        break
                    }
                }
            }

            if ($hasLogo) {
                if ($LogoRevert) {
                    Write-Entry -Message "[$title] Logo exists. Checking if it's a Posterizarr asset for removal..." -Path $global:configLogging -Color Yellow -log Info

                    # Fetch logos list to find the one to check/delete
                    $logosUrl = "$PlexUrl/library/metadata/$ratingKey/clearLogos"
                    try {
                        $logosResponse = Invoke-RestMethod -Uri $logosUrl -Headers $PlexHeaders

                        $posterizarrLogo = $null
                        $defaultLogo = $null

                        foreach ($logo in $logosResponse.MediaContainer.Photo) {
                            # Capture default fallback logo
                            if ($logo.ratingKey -match "^metadata://" -or $logo.ratingKey -match "^https?://") {
                                if (-not $defaultLogo) { $defaultLogo = $logo }
                            }

                            # Check if uploaded logo is from Posterizarr
                            if ($logo.ratingKey -match "^upload://") {
                                # Sanitize rating key to ensure valid Windows file paths
                                $safeFileName = $logo.ratingKey -replace '[^a-zA-Z0-9]', '_'
                                $checkLogoPath = Join-Path $global:ScriptRoot -ChildPath "temp\check_logo_$safeFileName.png"

                                # Conditionally construct URL to prevent http://plex:32400https://...
                                $logoKey = $logo.key
                                if ($logoKey -match "^https?://") {
                                    $logoDownloadUrl = $logoKey
                                }
                                else {
                                    # Ensure clean relative path concatenation
                                    $logoKey = "/" + $logoKey.TrimStart("/")
                                    $logoDownloadUrl = "$PlexUrl$logoKey"
                                }

                                try {
                                    Invoke-WebRequest -Uri $logoDownloadUrl -Headers $PlexHeaders -OutFile $checkLogoPath -ErrorAction Stop
                                    if (Test-IsPosterizarrAsset -Path $checkLogoPath) {
                                        $posterizarrLogo = $logo
                                    }
                                    Remove-Item $checkLogoPath -Force -ErrorAction SilentlyContinue
                                }
                                catch {
                                    Write-Entry -Subtext "[$title] Error checking logo $($logo.ratingKey): $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }

                        if ($posterizarrLogo) {
                            Write-Entry -Message "[$title] Found Posterizarr Logo. Attempting Revert..." -Path $global:configLogging -Color Yellow -log Info

                            # Reset UI to Default Logo
                            if ($defaultLogo) {
                                Write-Entry -Subtext "[$title] Reverting UI selection to default Plex logo..." -Path $global:configLogging -Color Cyan -log Info
                                $safeDefaultKey = [uri]::EscapeDataString($defaultLogo.ratingKey)
                                $selectUrl = "$PlexUrl/library/metadata/$ratingKey/clearLogo?url=$safeDefaultKey"
                                Invoke-RestMethod -Method Put -Uri $selectUrl -Headers $PlexHeaders
                            }

                            # Attempt API Deletion (and handle the 404 for upload:// schemas gracefully)
                            $safeLogoRatingKey = [uri]::EscapeDataString($posterizarrLogo.ratingKey)
                            $deleteUrl = "$PlexUrl/library/metadata/$ratingKey/clearLogos/$safeLogoRatingKey"

                            try {
                                Invoke-RestMethod -Method Delete -Uri $deleteUrl -Headers $PlexHeaders
                                Write-Entry -Subtext "[$title] Successfully deleted via API." -Path $global:configLogging -Color Green -log Info
                                $global:UploadCount = Increment-GlobalStat 'UploadCount'
                            }
                            catch {
                                if ($_.Exception.Response.StatusCode.value__ -eq 404) {
                                    Write-Entry -Subtext "[$title] Asset unlinked from UI." -Path $global:configLogging -Color Green -log Info
                                    $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                }
                                else {
                                    Write-Entry -Subtext "[$title] Unexpected error during deletion: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                        }
                        else {
                            Write-Entry -Subtext "[$title] No Posterizarr logo found to revert." -Path $global:configLogging -Color Cyan -log Debug
                        }

                    }
                    catch {
                        Write-Entry -Subtext "[$title] Error fetching logos list: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                    }
                    continue # Move to next item
                }

                if ($ForceReplace) {
                    Write-Entry -Message "[$title] Logo exists but ForceReplace is enabled. Attempting to fetch..." -Path $global:configLogging -Color Yellow -log Info
                }
                else {
                    Write-Entry -Subtext "[$title] Logo already exists. Skipping." -Path $global:configLogging -Color Cyan -log Debug
                    continue
                }
            }
            else {
                if ($LogoRevert) {
                    Write-Entry -Subtext "[$title] No Logo found to revert. Skipping." -Path $global:configLogging -Color Cyan -log Debug
                    continue
                }
                Write-Entry -Message "[$title] Missing Logo. Attempting to fetch..." -Path $global:configLogging -Color Yellow -log Info
            }

            # Reset IDs
            $global:tmdbid = $null
            $global:tvdbid = $null
            $global:imdbid = $null
            $global:LogoUrl = $null
            $global:UseClearlogo = 'true'
            $global:UseClearart = 'false'

            # Extract IDs from GUIDs
            if ($mediaItem.Guid) {
                foreach ($guidNode in $mediaItem.Guid) {
                    $guid = $guidNode.id
                    if ($guid -match 'tmdb://(\d+)') { $global:tmdbid = $matches[1] }
                    if ($guid -match 'tvdb://(\d+)') { $global:tvdbid = $matches[1] }
                    if ($guid -match 'imdb://(tt\d+)') { $global:imdbid = $matches[1] }
                }
            }

            if (-not $global:tmdbid -and -not $global:tvdbid -and -not $global:imdbid) {
                Write-Entry -Subtext "[$title] Could not extract any IDs from Plex GUIDs." -Path $global:configLogging -Color Yellow -log Warning
                continue
            }

            $mediaType = if ($SelectedLib.type -eq 'movie') { 'movie' } else { 'tv' }
            $tvdbType = if ($SelectedLib.type -eq 'movie') { 'movies' } else { 'series' }
            $fanartType = if ($SelectedLib.type -eq 'movie') { 'movies' } else { 'tv' }

            # Try fetching logo
            GetTMDBLogo -Type $mediaType | Out-Null
            if (-not $global:LogoUrl) { GetTVDBLogo -Type $tvdbType | Out-Null }
            if (-not $global:LogoUrl) { GetFanartLogo -Type $fanartType | Out-Null }

            if ($global:LogoUrl) {
                Write-Entry -Subtext "[$title] Found Logo URL: $global:LogoUrl" -Path $global:configLogging -Color Green -log Info
                $matched++

                # Download temporarily
                $tempLogo = Join-Path $global:ScriptRoot -ChildPath "temp\logo_$ratingKey.png"
                try {
                    # Download temporarily with fallback for SSL issues
                    try {
                        Invoke-WebRequest -Uri $global:LogoUrl -OutFile $tempLogo -Headers $PlexHeaders -ErrorAction Stop
                    }
                    catch {
                        if ($_.Exception.Message -like "*SSL*" -or $_.Exception.InnerException.Message -like "*SSL*") {
                            Write-Entry -Subtext "[$title] Logo download SSL error. Retrying with explicit HttpClient..." -Path $global:configLogging -Color Yellow -log Warning
                            try {
                                # Ensure TLS is set for this thread
                                [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
                                $handler = New-Object System.Net.Http.HttpClientHandler
                                $handler.ServerCertificateCustomValidationCallback = { $true }
                                $client = New-Object System.Net.Http.HttpClient($handler)
                                $client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
                                $response = $client.GetAsync($global:LogoUrl).GetAwaiter().GetResult()
                                if ($response.IsSuccessStatusCode) {
                                    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                                    [System.IO.File]::WriteAllBytes($tempLogo, $bytes)
                                }
                                else {
                                    throw "HttpClient download failed with status $($response.StatusCode)"
                                }
                            }
                            catch {
                                throw "Download fallback failed: $($_.Exception.Message)"
                            }
                            finally {
                                if ($client) { $client.Dispose() }
                            }
                        }
                        else {
                            throw $_
                        }
                    }

                    # Tag image with Posterizarr metadata
                    if ($magick) {
                        $CommentArguments = "`"$tempLogo`" -set `"comment`" `"created with posterizarr`" `"$tempLogo`""
                        $CommentlogEntry = "`"$magick`" $CommentArguments"
                        $CommentlogEntry | Write-MagickLog
                        InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                    }

                    # Upload to Plex ClearLogo endpoint
                    
                    $uploadUri = "$PlexUrl/library/metadata/$ratingKey/clearLogos"

                    Write-Entry -Subtext "[$title] Uploading Logo to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info

                    $UploadSuccess = $false
                    try {
                        $Upload = Invoke-WebRequest -Uri $uploadUri `
                            -Method Post `
                            -Headers $extraPlexHeaders `
                            -InFile $tempLogo `
-ContentType 'image/jpeg' `
                            -SkipHttpErrorCheck `
                            -ErrorAction Stop

                        if ($Upload.StatusCode -eq 200 -or $Upload.StatusCode -eq 201) {
                            $UploadSuccess = $true
                        }
                        else {
                            Write-Entry -Subtext "[$title] Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                            Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan -log Debug
                        }
                    }
                    catch {
                        if ($_.Exception.Message -like "*SSL*" -or $_.Exception.InnerException.Message -like "*SSL*") {
                            Write-Entry -Subtext "[$title] Upload SSL error. Retrying with explicit HttpClient..." -Path $global:configLogging -Color Yellow -log Warning
                            try {
                                # Ensure TLS is set for this thread
                                [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
                                $handler = New-Object System.Net.Http.HttpClientHandler
                                $handler.ServerCertificateCustomValidationCallback = { $true }
                                $client = New-Object System.Net.Http.HttpClient($handler)
                                $client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")

                                if ($extraPlexHeaders) {
                                    foreach ($key in $extraPlexHeaders.Keys) {
                                        if ($key -ne "Content-Type" -and $key -ne "User-Agent") {
                                            $client.DefaultRequestHeaders.TryAddWithoutValidation($key, $extraPlexHeaders[$key])
                                        }
                                    }
                                }

                                $content = New-Object System.Net.Http.ByteArrayContent($fileContent)
                                $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream")

                                $response = $client.PostAsync($uploadUri, $content).GetAwaiter().GetResult()
                                if ($response.IsSuccessStatusCode) {
                                    $UploadSuccess = $true
                                }
                                else {
                                    $respBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                                    Write-Entry -Subtext "[$title] HttpClient upload failed: $($response.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                    Write-Entry -Subtext "Response: $respBody" -Path $global:configLogging -Color Cyan -log Debug
                                }
                            }
                            catch {
                                Write-Entry -Subtext "[$title] HttpClient upload fallback failed: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                            }
                            finally {
                                if ($client) { $client.Dispose() }
                            }
                        }
                        else {
                            throw $_
                        }
                    }

                    if ($UploadSuccess) {
                        Write-Entry -Subtext "[$title] Logo uploaded successfully!" -Path $global:configLogging -Color Green -log Info
                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                    }
                }
                catch {
                    Write-Entry -Subtext "[$title] Processing failed: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                }
                finally {
                    if (Test-Path $tempLogo) {
                        Remove-Item -LiteralPath $tempLogo -Force
                    }
                }
            }
            else {
                Write-Entry -Subtext "[$title] No Logo found online." -Path $global:configLogging -Color Yellow -log Warning
            }
        }
        }
        Write-Entry -Message "Finished processing library: $LibraryName. Logos processed: $UploadCount" -Path $global:configLogging -Color Green -log Info
    }

    $endTime = Get-Date
    $executionTime = New-TimeSpan -Start $startTime -End $endTime
    # Format the execution time
    $hours = [math]::Floor($executionTime.TotalHours)
    $minutes = $executionTime.Minutes
    $seconds = $executionTime.Seconds
    $FormattedTimespawn = $hours.ToString() + "h " + $minutes.ToString() + "m " + $seconds.ToString() + "s "

    Write-Entry -Message "LogoUpdater/Revert Mode Finished!" -Path $global:configLogging -Color Green -log Info
    Write-Entry -Subtext "Matched items: $matched | Actions taken: $UploadCount | Errors: $global:errorCount" -Path $global:configLogging -Color White -log Info
    Write-Entry -Message "Script execution time: $FormattedTimespawn" -Path $global:configLogging -Color White -log Info

    # Send Notification
    $summaryLibName = if ($OriginalLibraryName -eq "all") { "All Libraries" } else { $LibraryName }
    Send-SummaryNotification -ScriptMode $Mode -FormattedTimespawn $FormattedTimespawn -ErrorCount $global:errorCount -matchedcount $matched -uploadcount $UploadCount -LibName $summaryLibName


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
