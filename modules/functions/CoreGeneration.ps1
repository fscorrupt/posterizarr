function Invoke-MoviePosterCreation {
    param (
        $entry
    )
        if ($null -eq $entry) { return }
        Set-LibraryLanguageOverride -LibraryName $entry.'Library Name' -MediaType 'Movie'
        try {
            if ($($entry.RootFoldername)) {
                # check if item has skip label
                if ($entry.labels -match 'skip_posterizarr') {
                    Write-Entry -Message "Skipping '$($entry.title)' because it has a skip label..." -Path $global:configLogging -Color Yellow -log Warning
                }
                Else {
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

                    if ([string]::IsNullOrWhiteSpace($Titletext)) {
                        # Native Cyrillic/CJK content often has no distinct originalTitle in Plex,
                        # which left Titletext blank above and broke the metadata search entirely.
                        # Fall back to whichever of title/originalTitle actually has a value.
                        if (-not [string]::IsNullOrWhiteSpace($entry.title)) {
                            $Titletext = $entry.title
                        }
                        elseif (-not [string]::IsNullOrWhiteSpace($entry.originalTitle)) {
                            $Titletext = $entry.originalTitle
                        }
                    }

                    if ($LibraryFolders -eq 'true') {
                        $LibraryName = $entry.'Library Name'
                        if ($entry.extraFolder) {
                            $EntryDir = "$AssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                            $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                        }
                        Else {
                            $EntryDir = "$AssetPath\$LibraryName\$($entry.RootFoldername)"
                            $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.RootFoldername)"
                        }
                        $PosterImageoriginal = "$EntryDir\poster.jpg"
                        $TestPath = $EntryDir
                        $ManualTestPath = $ManualEntryDir
                        $Testfile = "poster"

                    }
                    Else {
                        if ($entry.extraFolder) {
                            $PosterImageoriginal = "$AssetPath\$($entry.extraFolder)\$($entry.RootFoldername).jpg"
                        }
                        Else {
                            $PosterImageoriginal = "$AssetPath\$($entry.RootFoldername).jpg"
                        }
                        $TestPath = $AssetPath
                        $ManualTestPath = $ManualPath
                        $Testfile = $($entry.RootFoldername)
                    }

                    if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                        $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                        $PosterImageoriginal = ($PosterImageoriginal).Replace('\', '/').Replace('./', '/')
                        $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    }
                    else {
                        $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                        $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                        if ($fullTestPath) {
                            $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                            $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        }
                        Else {
                            $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                            $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                        }
                    }
                    Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Manual Test Path is: $ManualTestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Manual Test Path is: $Manualtestpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Manual Full Test Path is: $fullManualTestPath" -Path $global:configLogging -Color Cyan -log Debug
                    $PosterImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.ratingKey)_$($entry.RootFoldername).jpg"
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
                            $TakeLocal = $null
                            $LocalAssetMissing = $null
                            $Arturl = $null
                            $LocalAddOverlay = $AddOverlay
                            $LocalAddBorder = $AddBorder

                            if ($entry.PlexPosterUrl -like "/library/*") {
                                $Arturl = $plexurl + $entry.PlexPosterUrl
                            }
                            elseif ($entry.OtherMediaServerPosterUrl) {
                                $Arturl = "$OtherMediaServerUrl/items/$($entry.Id)/images/Primary/"
                            }

                            foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                                $filePath = "$ManualTestPath$ext"
                                if (Test-Path -LiteralPath $filePath) {
                                    Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                    $posterext = $ext
                                    break
                                }
                            }

                            if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                                Write-Entry -Message "Found Manual Poster for: $Titletext" -Path $global:configLogging -Color White -log Info
                                $TakeLocal = $true
                            }
                            Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlinePosterFetch -eq 'true') {
                                $LocalAssetMissing = 'true'
                            }
                            Else {
                                # [Posterizarr TextlessFallback] Pre-check logo availability to revert to text poster if needed.
                                $tempLogoAvailable = $false
                                if ($TextlessPosterBypass -eq 'true' -and $UseLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                    $tempLogoUrl = $null
                                    $searchOrder = @($global:FavProvider) + (@('TMDB', 'FANART', 'TVDB') -ne $global:FavProvider)
                                    foreach ($provider in $searchOrder) {
                                        if (-not [string]::IsNullOrEmpty($tempLogoUrl)) { break }
                                        switch ($provider) {
                                            'TMDB' { if ($entry.tmdbid) { $tempLogoUrl = GetTMDBLogo -Type movie } }
                                            'FANART' { $t = if('movie' -eq 'movie') {'movies'} else {'tv'}; $tempLogoUrl = GetFanartLogo -Type $t }
                                            'TVDB' { if ($entry.tvdbid) { $t = if('movie' -eq 'movie') {'movies'} else {'series'}; $tempLogoUrl = GetTVDBLogo -Type $t } }
                                        }
                                    }
                                    if ($tempLogoUrl) { $tempLogoAvailable = $true }
                                    
                                    if (-not $tempLogoAvailable) {
                                        Write-Entry -Message "TextlessFallback (textposter): No logo available. Forcing standard Text Asset." -Path $global:configLogging -Color Cyan -log Info
                                        $global:OriginalPreferTextless = $global:PosterPreferTextless
                                        $global:OriginalOnlyTextless = $global:PosterOnlyTextless
                                        $global:OriginalPreferredLanguageOrder = $global:PreferredLanguageOrder
                                        $tempOrder = @($global:PreferredLanguageOrder | Where-Object { $_ -ne 'xx' })
                                        if (-not $tempOrder) { $tempOrder = @('en') }
                                        $global:PreferredLanguageOrder = $tempOrder
                                        Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $tempOrder
                                        $global:PosterPreferTextless = $false
                                        $global:PosterOnlyTextless = $false
                                        $global:ForceTextAssetRestoration = '$global:PosterPreferTextless'
                                    }
                                }
                                Write-Entry -Message "Start Poster Search for: $Titletext" -Path $global:configLogging -Color White -log Info
                            if ($global:OverrideProviderOrder) {
                                $global:LoopFallbackPosterUrl = $null
                                foreach ($provider in $global:ProviderOrder) {
                                    if ($global:posterurl -or $global:PlexartworkDownloaded) { break }
                                    switch -Wildcard ($provider) {
                                        'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBMoviePoster } }
                                        'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBMoviePoster } }
                                        'FANART' { $global:posterurl = GetFanartMoviePoster }
                                        'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Movie Poster' -ArtUrl $Arturl -TempImage $PosterImage } }
                                    }

                                    if ($global:posterurl -and $global:PosterPreferTextless -eq $true -and !$global:TextlessPoster) {
                                        if (!$global:LoopFallbackPosterUrl) { $global:LoopFallbackPosterUrl = $global:posterurl }
                                        $global:posterurl = $null
                                        $global:IsFallback = $true
                                    }

                                    if ($global:posterurl -or $global:PlexartworkDownloaded) {
                                        Write-Entry -Subtext "Took image from custom provider loop: $provider" -Path $global:configLogging -Color Cyan -log Info
                                        if ($provider -ne $global:ProviderOrder[0]) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (!$global:posterurl -and $global:LoopFallbackPosterUrl -and $global:PosterOnlyTextless -ne $true) {
                                    $global:posterurl = $global:LoopFallbackPosterUrl
                                    Write-Entry -Subtext "Took fallback image with text from custom provider loop because no textless poster was found." -Path $global:configLogging -Color Cyan -log Info
                                }
                            }
                            Else {
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBMoviePoster }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartMoviePoster } }
                                    'FANART' { $global:posterurl = GetFanartMoviePoster }
                                    'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBMoviePoster }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartMoviePoster } }
                                    'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Movie Poster' -ArtUrl $Arturl -TempImage $PosterImage } }
                                    Default { $global:posterurl = GetFanartMoviePoster }
                                }
                                switch -Wildcard ($global:Fallback) {
                                    'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBMoviePoster } }
                                    'FANART' { $global:posterurl = GetFanartMoviePoster }
                                }
                                if ($global:PosterPreferTextless -eq $true) {
                                    if (!$global:TextlessPoster -and $global:fanartfallbackposterurl) {
                                        $global:posterurl = $global:fanartfallbackposterurl
                                        Write-Entry -Subtext "Took Fanart.tv Fallback poster because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                        $global:IsFallback = $true
                                    }
                                    if (!$global:TextlessPoster -and $global:TMDBfallbackposterurl) {
                                        $global:posterurl = $global:TMDBfallbackposterurl
                                        Write-Entry -Subtext "Took TMDB Fallback poster because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                        $global:IsFallback = $true
                                    }
                                    if (!$global:TextlessPoster -and $global:TVDBfallbackposterurl) {
                                        $global:posterurl = $global:TVDBfallbackposterurl
                                        Write-Entry -Subtext "Took TVDB Fallback poster because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                        $global:IsFallback = $true
                                    }
                                    if ($global:FavProvider -eq 'TVDB' -and !$global:posterurl) {
                                        if ($entry.tmdbid) {
                                            $global:posterurl = GetTMDBMoviePoster
                                            $global:IsFallback = $true
                                        }
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetFanartMoviePoster
                                            $global:IsFallback = $true
                                        }
                                    }
                                }

                                if ($global:PosterOnlyTextless -and !$global:posterurl) {
                                    if ($global:FavProvider -eq 'TVDB') {
                                        if ($entry.tmdbid) {
                                            $global:posterurl = GetTMDBMoviePoster
                                            $global:IsFallback = $true
                                        }
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetFanartMoviePoster
                                            $global:IsFallback = $true
                                        }
                                    }
                                    Elseif ($global:FavProvider -eq 'FANART') {
                                        if ($entry.tmdbid) {
                                            $global:posterurl = GetTMDBMoviePoster
                                            $global:IsFallback = $true
                                        }
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetTVDBMoviePoster
                                            $global:IsFallback = $true
                                        }
                                    }
                                    Else {
                                        $global:posterurl = GetFanartMoviePoster
                                        if (!$global:FavProvider -eq 'FANART') {
                                            $global:IsFallback = $true
                                        }
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetTVDBMoviePoster
                                            $global:IsFallback = $true
                                        }
                                    }
                                }

                                if (!$global:posterurl) {
                                    if ($global:FavProvider -ne 'TVDB' -and !$global:PosterOnlyTextless -and !$global:PosterPreferTextless) {
                                        $global:posterurl = GetTVDBMoviePoster
                                        $global:IsFallback = $true
                                    }
                                    if (!$global:posterurl -and !$global:PosterOnlyTextless) {
                                        if ($ArtUrl) {
                                            GetPlexArtwork -Type ' a Movie Poster' -ArtUrl $Arturl -TempImage $PosterImage
                                            $global:IsFallback = $true
                                        }
                                        Else {
                                            Write-Entry -Subtext "MediaServer Poster Url empty, cannot search on MediaServer, likely there is no artwork..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                    }
                                    if (!$global:posterurl -and $global:imdbid -and !$global:PosterOnlyTextless) {
                                        Write-Entry -Subtext "Searching on IMDB for a movie poster" -Path $global:configLogging -Color Cyan -log Info
                                        $global:posterurl = GetIMDBPoster
                                        $global:IsFallback = $true
                                        if (!$global:posterurl) {
                                            Write-Entry -Subtext "Could not find a poster on any site" -Path $global:configLogging -Color Red -log Error
                                        }
                                    }
                                }
                            }
                            }
                            if ($fontAllCaps -eq 'true') {
                                $joinedTitle = $Titletext.ToUpper()
                            }
                            Else {
                                $joinedTitle = $Titletext
                            }
                            if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                                if ($TakeLocal) {
                                    Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                        Copy-Item -LiteralPath $_.FullName -Destination $PosterImage | Out-Null
                                    }
                                    if ($SkipLocalPosterTextAdd -eq 'true') {
                                        $SkippingText = 'true'
                                    }
                                    Write-Entry -Subtext "Copy local asset to: $PosterImage" -Path $global:configLogging -Color Green -log Info
                                }
                                Else {
                                    try {
                                        if (!$global:PlexartworkDownloaded) {
                                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $PosterImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                        }
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
                                    Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                    if ($global:posterurl -like 'https://image.tmdb.org*') {
                                        if ($global:PosterWithText) {
                                            Write-Entry -Subtext "Downloading Poster with Text from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Textless Poster from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                        }
                                        if ($global:FavProvider -ne 'TMDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    elseif ($global:posterurl -like 'https://assets.fanart.tv*') {
                                        if ($global:PosterWithText) {
                                            Write-Entry -Subtext "Downloading Poster with Text from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:FANARTAssetTextLang
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Textless Poster from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:FANARTAssetTextLang
                                        }
                                        if ($global:FavProvider -ne 'FANART') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    elseif ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                        if ($global:PosterWithText) {
                                            Write-Entry -Subtext "Downloading Poster with Text from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Textless Poster from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                        }
                                        if ($global:FavProvider -ne 'TVDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    elseif ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                        Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        if ($global:FavProvider -ne 'PLEX') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Poster from 'IMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:IsFallback = $true
                                    }
                                }
                                $global:IsTruncated = $null
                                if ($global:ForceTextAssetRestoration -ne $null) {
                                    if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                        $global:PosterPreferTextless = $global:OriginalPreferTextless
                                        $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                            $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                            $global:OriginalPreferredLanguageOrder = $null
                                        }
                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                        $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                        $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                            $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                            $global:OriginalPreferredBackgroundLanguageOrder = $null
                                        }
                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                        $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                        $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                            $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                            $global:OriginalPreferredSeasonLanguageOrder = $null
                                        }
                                    }
                                    $global:ForceTextAssetRestoration = $null
                                }
                                if ($global:ImageProcessing -eq 'true') {
                                    Write-Entry -Subtext "Processing Poster for: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                    $CommentArguments = "`"$PosterImage`" -set `"comment`" `"created with posterizarr`" `"$PosterImage`""
                                    $CommentlogEntry = "`"$magick`" $CommentArguments"
                                    $CommentlogEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                    if ($global:ImageMagickError -ne 'true') {
                                        if ($UsePosterResolutionOverlays -eq 'true') {
                                            switch ($entry.Resolution) {
                                                '4K DoVi/HDR10' { $Posteroverlay = $4KDoViHDR10 }
                                                '4K DoVi' { $Posteroverlay = $4KDoVi }
                                                '4K HDR10' { $Posteroverlay = $4KHDR10 }
                                                '4K' { $Posteroverlay = $4kposter }
                                                '1080p' { $Posteroverlay = $1080pPoster }
                                                Default { $Posteroverlay = $DefaultPosteroverlay }
                                            }
                                        }
                                        Else {
                                            $Posteroverlay = $DefaultPosteroverlay
                                        }
                                        # Logic for SkipAddTextAndOverlay (Skip Overlay, keep Border)
                                        if (($SkipAddTextAndOverlay -eq 'true') -and $global:PosterWithText) {
                                            $LocalAddOverlay = 'false'
                                        }

                                        # Logic for SkipAddTextAndBorder (Skip Border, keep Overlay)
                                        if (($SkipAddTextAndBorder -eq 'true') -and $global:PosterWithText) {
                                            $LocalAddBorder = 'false'
                                        }

                                        # Logic for "If both are true, only resize"
                                        if ($SkipAddTextAndOverlay -eq 'true' -and $SkipAddTextAndBorder -eq 'true' -and $global:PosterWithText) {
                                            $LocalAddBorder = 'false'
                                            $LocalAddOverlay = 'false'
                                        }
                                        # Calculate the height to maintain the aspect ratio with a width of 1000 pixels
                                        if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                            $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Posteroverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$borderwidthsecond`"  -bordercolor `"$bordercolor`" -border `"$borderwidth`" `"$PosterImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                        }
                                        elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                            $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" -shave `"$borderwidthsecond`"  -bordercolor `"$bordercolor`" -border `"$borderwidth`" `"$PosterImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                        }
                                        elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                            $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Posteroverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                        }
                                        else {
                                            $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                                            Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                        }
                                        $logEntry = "`"$magick`" $Arguments"
                                        $logEntry | Write-MagickLog
                                        InvokeMagickCommand -Command $magick -Arguments $Arguments
                                        if (($SkipAddText -eq 'true' -or $SkipAddTextAndOverlay -eq 'true') -and $global:PosterWithText) {
                                            $SkippingText = 'true'
                                            Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                        }
                                        # ONLY proceed with Logo or Text application if SkippingText is NOT true
                                        if ($SkippingText -ne 'true') {
                                            if ($UseLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                                $ApplyTextInsteadOfLogo = $null
                                                $global:LogoUrl = $null
                                                $global:LogoLanguage = $null
                                                $allProviders = @('TMDB', 'FANART', 'TVDB')
                                                $searchOrder = @($global:FavProvider) + ($allProviders -ne $global:FavProvider)

                                                foreach ($provider in $searchOrder) {
                                                    if (-not [string]::IsNullOrEmpty($global:LogoUrl)) { break }
                                                    switch ($provider) {
                                                        'TMDB' { if ($entry.tmdbid) { $global:LogoUrl = GetTMDBLogo -Type movie } }
                                                        'FANART' { $global:LogoUrl = GetFanartLogo -Type movies }
                                                        'TVDB' { if ($entry.tvdbid) { $global:LogoUrl = GetTVDBLogo -Type movies } }
                                                    }
                                                }
                                                if (-not [string]::IsNullOrEmpty($global:LogoUrl)) {
                                                    $global:IsFallback = $false
                                                    switch ($global:FavProvider) {
                                                        'TMDB' {
                                                            if (-not ($global:LogoUrl.StartsWith("https://image.tmdb.org"))) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        'TVDB' {
                                                            if (-not ($global:LogoUrl.StartsWith("https://artworks.thetvdb.com"))) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        'FANART' {
                                                            if (-not ($global:LogoUrl.StartsWith("https://assets.fanart.tv"))) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                    }
                                                    if ($global:IsFallback) {
                                                        Write-Entry -Subtext "Logo Source: Fallback (URL did not match $global:FavProvider)" -Path $global:configLogging -Color Yellow -log Debug
                                                    }
                                                }
                                                if ([string]::IsNullOrEmpty($global:LogoUrl)) {
                                                    Write-Entry -Subtext "Could not find a logo on any provider (Tried: $($searchOrder -join ', '))" -Path $global:configLogging -Color Yellow -log Warning
                                                }
                                                if (!$global:LogoUrl -and $TextFallback -eq 'true') {
                                                    $ApplyTextInsteadOfLogo = 'true'
                                                    Write-Entry -Subtext "Falling back to text as no logo was found." -Path $global:configLogging -Color Yellow -log Warning
                                                    $global:IsFallback = $true
                                                }
                                                ElseIf ($global:LogoUrl) {
                                                    $urlExtension = [System.IO.Path]::GetExtension($global:LogoUrl).Split('?')[0]
                                                    if ([string]::IsNullOrWhiteSpace($urlExtension)) { $urlExtension = ".png" }
                                                                                                                    $LogoImage = Join-Path $TempPath ("$($entry.RootFoldername)_logo" + $urlExtension); Write-Entry -Message "Logo Used: $global:LogoUrl" -Path $global:configLogging -Color Cyan -log Debug
                                                    try {
                                                        $response = Invoke-WebRequest -Uri $global:LogoUrl -OutFile $LogoImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
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
                                                    # Only apply color if enabled AND color is defined
                                                    $colorEffect = ""
                                                    if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                                                        $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                                                        $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                                                        if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                                                        else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                                                    }
                                                    if ($urlExtension -match "(?i)\.svg") {
                                                        Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                                                        $Arguments = "`"$PosterImage`" ( -background none -density 300 `"$LogoImage`" $colorEffect -resize `"$boxsize`" `) -gravity `"$textgravity`" -geometry +0+`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                    }
                                                    else {
                                                        $Arguments = "`"$PosterImage`" ( -background none `"$LogoImage`" $colorEffect -resize `"$boxsize`" `) -gravity `"$textgravity`" -geometry +0+`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                    }
                                                    Write-Entry -Subtext "Applying Logo..." -Path $global:configLogging -Color White -log Info
                                                    $logEntry = "`"$magick`" $Arguments"
                                                    $logEntry | Write-MagickLog
                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments

                                                    Remove-Item -LiteralPath $LogoImage -Force -ErrorAction SilentlyContinue | out-null
                                                }
                                            }
                                            if ($ApplyTextInsteadOfLogo -eq 'true' -or $UseLogo -eq 'false') {
                                                if ($AddText -eq 'true' -and $SkippingText -eq 'false') {
                                                    if ($global:direction -eq "RTL") {
                                                        $fontImagemagick = $RTLfontImagemagick
                                                    }
                                                    $joinedTitle = $joinedTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                    $joinedTitle = $joinedTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                    # Loop through each symbol and replace it with a newline
                                                    if ($NewLineOnSpecificSymbols -eq 'true') {
                                                        foreach ($symbol in $NewLineSymbols) {
                                                            # Replace the symbol with a newline
                                                            $replacementString = "`n"

                                                            # Check if the symbol should be kept
                                                            $keepThisSymbol = $false
                                                            if ($null -ne $SymbolsToKeepOnNewLine) {
                                                                # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                                foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                    # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                    if ($symbol -like "*$k*") {
                                                                        $keepThisSymbol = $true
                                                                        break # Match found, no need to keep checking
                                                                    }
                                                                }
                                                            }

                                                            # If it's a "keep" symbol, change the replacement string
                                                            if ($keepThisSymbol) {
                                                                # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                                $replacementString = $symbol + "`n"
                                                            }
                                                            $joinedTitle = $joinedTitle -replace [regex]::Escape($symbol), $replacementString
                                                        }
                                                    }
                                                    if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                        $properties = $NewLineWords.PSObject.Properties.Name

                                                        # Check if properties exist and the list is not empty
                                                        if ($null -ne $properties -and $properties.Count -gt 0) {
                                                            foreach ($wordKey in $properties) {
                                                                $replacementValue = $NewLineWords.$wordKey

                                                                # Using [regex]::Escape handles any special characters in the word keys
                                                                $joinedTitle = $joinedTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                            }
                                                        }
                                                    }
                                                    $joinedTitlePointSize = $joinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                    $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $fontImagemagick -box_width $MaxWidth  -box_height $MaxHeight -min_pointsize $minPointSize -max_pointsize $maxPointSize -lineSpacing $lineSpacing

                                                    if ($global:IsTruncated -ne $true) {
                                                        Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                        $cleanTitle = $joinedTitle -replace 'Â³', '' -replace 'Â²', ''
                                                        $cleanTitle = $joinedTitle -replace 'Â³', '' -replace 'Â²', ''
                                                        $supChar = if ($joinedTitle -match 'Â³') { "3" } elseif ($joinedTitle -match 'Â²') { "2" } else { "" }
                                                        $superSize = [int]($optimalFontSize * 0.55)
                                                        $yNudge = [int]($optimalFontSize * 0.3)
                                                        $gap = 20

                                                        if ($supChar -ne "" -and $AddTextStroke -eq 'true') {
                                                            # SUPERSCRIPT + STROKE MODE
                                                            $Arguments = "`"$PosterImage`" ( -background none " +
                                                            "( ( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" label:`"$cleanTitle`" ) " +
                                                            "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                            "( ( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$fontcolor`" -stroke none label:`"$cleanTitle`" ) " +
                                                            "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$fontcolor`" -stroke none label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                            "-gravity center -composite ) -gravity south -geometry +0`"$text_offset`" -composite `"$PosterImage`""
                                                        }
                                                        elseif ($supChar -ne "") {
                                                            # SUPERSCRIPT ONLY MODE (No Stroke)
                                                            $Arguments = "`"$PosterImage`" ( -background none " +
                                                            "( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$fontcolor`" label:`"$cleanTitle`" ) " +
                                                            "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$fontcolor`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap " +
                                                            ") -gravity south -geometry +0`"$text_offset`" -composite `"$PosterImage`""
                                                        }
                                                        else {
                                                            # STANDARD MODE (Normal caption logic)
                                                            if ($AddTextStroke -eq 'true') {
                                                                $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$boxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$fontcolor`" -stroke none -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$boxsize`" `) -gravity south -geometry +0`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                            }
                                                            Else {
                                                                $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten ( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$fontcolor`" -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$boxsize`" ) -gravity south -geometry +0`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                            }
                                                        }

                                                        Write-Entry -Subtext "Applying Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                                        $logEntry = "`"$magick`" $Arguments"
                                                        $logEntry | Write-MagickLog
                                                        InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Else {
                                    $Resizeargument = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                                    Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                    $logEntry = "`"$magick`" $Resizeargument"
                                    $logEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                                }
                                # Move file back to original naming with Brackets.
                                if ($global:ImageMagickError -ne 'true') {
                                    if (Get-ChildItem -LiteralPath $PosterImage -ErrorAction SilentlyContinue) {
                                        if ($global:IsTruncated -ne $true) {
                                            if ($UseOtherMediaServer -eq 'true' -and $entry.Id) {
                                                Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($entry.Id)" -Path $global:configLogging -Color Cyan -log Debug
                                                UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Primary" -imagePath $PosterImage
                                            }
                                            if ($Upload2Plex -eq 'true') {
                                                try {
                                                    Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                    
                                                    # Verify variables before uploading
                                                    Write-Entry -Subtext "PosterImage: $PosterImage" -Path $global:configLogging -Color Cyan -log Debug
                                                    Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                    Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                    $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/posters"
                                                    Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                    # Try uploading, capturing the response in detail
                                                    $Upload = Invoke-WebRequest -Uri $uri `
                                                        -Method Post `
                                                        -Headers $extraPlexHeaders `
                                                        -InFile $PosterImage `
-ContentType 'image/jpeg' `
                                                        -SkipHttpErrorCheck `
                                                        -ErrorAction Stop

                                                    if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                        Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                        Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                    }
                                                    else {
                                                        Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                        Write-Entry -Subtext "$Titletext | Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                        $null = Increment-GlobalStat 'PlexRootPosterUploads'
                                                    }
                                                }
                                                catch {
                                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                                }
                                            }
                                            try {
                                                $PosterTargetDir = Split-Path -Path $PosterImageoriginal -Parent
                                                if ($PosterTargetDir -and -not (Test-Path -LiteralPath $PosterTargetDir)) {
                                                    New-Item -ItemType Directory -Path $PosterTargetDir -Force | Out-Null
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
                                        Else {
                                            Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        $movietemp = New-Object psobject
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Movie'
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback) { 'true' } else { 'false' })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $PosterImage } Else { $global:posterurl })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                        $movietemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                        switch -Wildcard ($global:FavProvider) {
                                            'TMDB' { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                            'FANART' { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                            'TVDB' { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                            Default { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                        }

                                        # Export the array to a CSV file
                                        $movietemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                        if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $movietemp.Type -title $movietemp.Title -Lib $movietemp.LibraryName -DLSource $movietemp.'Download Source' -lang $movietemp.Language -favurl $movietemp.'Fav Provider Link' -fallback $movietemp.Fallback -Truncated $movietemp.TextTruncated }
                                    }
                                }
                            }
                            Elseif ($LocalAssetMissing -eq 'true') {
                                Write-Entry -Subtext "Skipping [$Titletext] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                            }
                            Else {
                                Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                $movietemp = New-Object psobject
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Movie'
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                $movietemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                                $movietemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                                $movietemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                $movietemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                $movietemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                $movietemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                    'FANART' { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                    'TVDB' { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                    Default { $movietemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                }

                                # Export the array to a CSV file
                                $movietemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $movietemp.Type -title $movietemp.Title -Lib $movietemp.LibraryName -DLSource $movietemp.'Download Source' -lang $movietemp.Language -favurl $movietemp.'Fav Provider Link' -fallback $movietemp.Fallback -Truncated $movietemp.TextTruncated }
                            }
                        }
                        else {
                            if ($global:UploadExistingAssets -eq 'true') {
                                if ($entry.PlexPosterUrl -like "/library/*") {
                                    $Arturl = $plexurl + $entry.PlexPosterUrl
                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                    try {
                                        GetPlexArtwork -Type "$Titletext Artwork." -ArtUrl $Arturl -TempImage $PosterImage
                                        if ($global:PlexartworkDownloaded -eq 'true') {
                                            Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                            
                                            # Verify variables before uploading
                                            Write-Entry -Subtext "PosterImage: $PosterImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                            Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                            Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                            $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/posters"
                                            Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                            # Try uploading, capturing the response in detail
                                            $Upload = Invoke-WebRequest -Uri $uri `
                                                -Method Post `
                                                -Headers $extraPlexHeaders `
                                                -InFile $PosterImageoriginal `
-ContentType 'image/jpeg' `
                                                -SkipHttpErrorCheck `
                                                -ErrorAction Stop
    
                                            if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                            }
                                            else {
                                                Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                Write-Entry -Subtext "$Titletext | Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                $null = Increment-GlobalStat 'PlexRootPosterUploads'
                                            }
                                            $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                        }
                                    }
                                    catch {
                                        Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                        $global:errorCount = Increment-GlobalStat 'errorCount'
                                        Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                                elseif ($entry.Id) {
                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                    Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                    UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Primary" -imagePath $PosterImageoriginal
                                }
                                if (Test-Path $PosterImage -ErrorAction SilentlyContinue) {
                                    Remove-Item -LiteralPath $PosterImage | Out-Null
                                    Write-Entry -Message "Deleting Temp Image: $PosterImage" -Path $global:configLogging -Color White -log Info
                                }
                            }
                            Else {
                                if ($show_skipped -eq 'true' ) {
                                    Write-Entry -Subtext "Already exists: $PosterImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                                }
                            }
                        }
                    }
                    # Now we can start the Background Poster Part
                    if ($global:BackgroundPosters -eq 'true') {
                        if ($LibraryFolders -eq 'true') {
                            $LibraryName = $entry.'Library Name'
                            if ($entry.extraFolder) {
                                $EntryDir = "$AssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                                $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                            }
                            Else {
                                $EntryDir = "$AssetPath\$LibraryName\$($entry.RootFoldername)"
                                $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.RootFoldername)"
                            }
                            $backgroundImageoriginal = "$EntryDir\background.jpg"
                            $TestPath = $EntryDir
                            $ManualTestPath = $ManualEntryDir
                            $Testfile = "background"

                        }
                        Else {
                            if ($entry.extraFolder) {
                                $backgroundImageoriginal = "$AssetPath\$($entry.extraFolder)\$($entry.RootFoldername)_background.jpg"
                            }
                            Else {
                                $backgroundImageoriginal = "$AssetPath\$($entry.RootFoldername)_background.jpg"
                            }
                            $TestPath = $AssetPath
                            $ManualTestPath = $ManualPath
                            $Testfile = "$($entry.RootFoldername)_background"
                        }

                        if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                            $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                            $backgroundImageoriginal = ($backgroundImageoriginal).Replace('\', '/').Replace('./', '/')
                            $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                        }
                        else {
                            $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                            $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                            if ($fullTestPath) {
                                $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                                $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                            }
                            Else {
                                $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                                $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                            }
                        }

                        $backgroundImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.ratingKey)_$($entry.RootFoldername)_background.jpg"
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
                            $global:TMDBfallbackposterurl = $null
                            $global:fanartfallbackposterurl = $null
                            $TakeLocal = $null
                            $LocalAssetMissing = $null
                            $Arturl = $null
                            $LocalAddOverlay = $AddBackgroundOverlay
                            $LocalAddBorder = $AddBackgroundBorder

                            if ($entry.PlexBackgroundUrl -like "/library/*") {
                                $Arturl = $plexurl + $entry.PlexBackgroundUrl
                            }
                            elseif ($entry.OtherMediaServerBackgroundUrl) {
                                $Arturl = "$OtherMediaServerUrl/items/$($entry.Id)/images/backdrop/"
                            }

                            foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                                $filePath = "$ManualTestPath$ext"
                                if (Test-Path -LiteralPath $filePath) {
                                    Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                    $posterext = $ext
                                    break
                                }
                            }

                            if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                                Write-Entry -Message "Found Manual Background for: $Titletext" -Path $global:configLogging -Color White -log Info
                                $TakeLocal = $true
                            }
                            Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlineBackgroundFetch -eq 'true') {
                                $LocalAssetMissing = 'true'
                            }
                            Else {
                                # [Posterizarr TextlessFallback] Pre-check logo availability to revert to text poster if needed.
                                $tempLogoAvailable = $false
                                if ($TextlessPosterBypass -eq 'true' -and $UseBGLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                    $tempLogoUrl = $null
                                    $searchOrder = @($global:FavProvider) + (@('TMDB', 'FANART', 'TVDB') -ne $global:FavProvider)
                                    foreach ($provider in $searchOrder) {
                                        if (-not [string]::IsNullOrEmpty($tempLogoUrl)) { break }
                                        switch ($provider) {
                                            'TMDB' { if ($entry.tmdbid) { $tempLogoUrl = GetTMDBLogo -Type movie } }
                                            'FANART' { $t = if('movie' -eq 'movie') {'movies'} else {'tv'}; $tempLogoUrl = GetFanartLogo -Type $t }
                                            'TVDB' { if ($entry.tvdbid) { $t = if('movie' -eq 'movie') {'movies'} else {'series'}; $tempLogoUrl = GetTVDBLogo -Type $t } }
                                        }
                                    }
                                    if ($tempLogoUrl) { $tempLogoAvailable = $true }
                                    
                                    if (-not $tempLogoAvailable) {
                                        Write-Entry -Message "TextlessFallback (textposter): No logo available. Forcing standard Text Asset." -Path $global:configLogging -Color Cyan -log Info
                                        $global:OriginalPreferTextless = $global:BackgroundPreferTextless
                                        $global:OriginalOnlyTextless = $global:BackgroundOnlyTextless
                                        $global:OriginalPreferredBackgroundLanguageOrder = $global:PreferredBackgroundLanguageOrder
                                        $tempOrder = @($global:PreferredBackgroundLanguageOrder | Where-Object { $_ -ne 'xx' })
                                        if (-not $tempOrder) { $tempOrder = @('en') }
                                        $global:PreferredBackgroundLanguageOrder = $tempOrder
                                        Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $tempOrder
                                        $global:BackgroundPreferTextless = $false
                                        $global:BackgroundOnlyTextless = $false
                                        $global:ForceTextAssetRestoration = '$global:BackgroundPreferTextless'
                                    }
                                }
                                Write-Entry -Message "Start Background Search for: $Titletext" -Path $global:configLogging -Color White -log Info
                            if ($global:OverrideProviderOrder) {
                                $global:LoopFallbackPosterUrl = $null
                                foreach ($provider in $global:ProviderOrder) {
                                    if ($global:posterurl -or $global:PlexartworkDownloaded) { break }
                                    switch -Wildcard ($provider) {
                                        'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBMovieBackground } }
                                        'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBMovieBackground } }
                                        'FANART' { $global:posterurl = GetFanartMovieBackground }
                                        'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Movie Background' -ArtUrl $Arturl -TempImage $backgroundImage } }
                                    }

                                    if ($global:posterurl -and $global:BackgroundPreferTextless -eq 'true' -and !$global:TextlessPoster) {
                                        if (!$global:LoopFallbackPosterUrl) { $global:LoopFallbackPosterUrl = $global:posterurl }
                                        $global:posterurl = $null
                                        $global:IsFallback = $true
                                    }

                                    if ($global:posterurl -or $global:PlexartworkDownloaded) {
                                        Write-Entry -Subtext "Took image from custom provider loop: $provider" -Path $global:configLogging -Color Cyan -log Info
                                        if ($provider -ne $global:ProviderOrder[0]) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (!$global:posterurl -and $global:LoopFallbackPosterUrl -and $global:BackgroundOnlyTextless -ne $true) {
                                    $global:posterurl = $global:LoopFallbackPosterUrl
                                    Write-Entry -Subtext "Took fallback image with text from custom provider loop because no textless background was found." -Path $global:configLogging -Color Cyan -log Info
                                }
                            }
                            Else {
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBMovieBackground }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartMovieBackground } }
                                    'FANART' { $global:posterurl = GetFanartMovieBackground }
                                    'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBMovieBackground }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartMovieBackground } }
                                    'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Movie Background' -ArtUrl $Arturl -TempImage $backgroundImage } }
                                    Default { $global:posterurl = GetFanartMovieBackground }
                                }
                                switch -Wildcard ($global:Fallback) {
                                    'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBMovieBackground } }
                                    'FANART' { $global:posterurl = GetFanartMovieBackground }
                                }
                                if ($global:BackgroundPreferTextless -eq $true) {
                                    if (!$global:TextlessPoster -and $global:fanartfallbackposterurl) {
                                        $global:posterurl = $global:fanartfallbackposterurl
                                        Write-Entry -Subtext "Took Fanart.tv Fallback background because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                        $global:IsFallback = $true
                                    }
                                    if (!$global:TextlessPoster -and $global:TMDBfallbackposterurl) {
                                        $global:posterurl = $global:TMDBfallbackposterurl
                                        Write-Entry -Subtext "Took TMDB Fallback background because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                        $global:IsFallback = $true
                                    }
                                    if ($global:FavProvider -eq 'TVDB' -and !$global:posterurl) {
                                        if ($entry.tmdbid) {
                                            $global:posterurl = GetTMDBMovieBackground
                                            $global:IsFallback = $true
                                        }
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetFanartMovieBackground
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if ($global:BackgroundOnlyTextless -and !$global:posterurl) {
                                    if ($global:FavProvider -eq 'TVDB') {
                                        if ($entry.tmdbid) {
                                            $global:posterurl = GetTMDBMovieBackground
                                            $global:IsFallback = $true
                                        }
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetFanartMovieBackground
                                            $global:IsFallback = $true
                                        }
                                    }
                                    Else {
                                        $global:posterurl = GetFanartMovieBackground
                                        if (!$global:FavProvider -eq 'FANART') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (!$global:posterurl) {
                                    if ($global:FavProvider -ne 'TVDB') {
                                        $global:posterurl = GetTVDBMovieBackground
                                        if ($global:posterurl) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if (!$global:posterurl) {
                                        if ($ArtUrl) {
                                            GetPlexArtwork -Type ' a Movie Background' -ArtUrl $Arturl -TempImage $backgroundImage
                                            if ($global:posterurl) {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        Else {
                                            Write-Entry -Subtext "MediaServer Background Url empty, cannot search on MediaServer, likely there is no artwork on MediaServer..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if (!$global:posterurl) {
                                            Write-Entry -Subtext "Could not find a Background on any site" -Path $global:configLogging -Color Red -log Error
                                        }
                                    }
                                }

                            }
                                if ($BackgroundfontAllCaps -eq 'true') {
                                    $joinedTitle = $Titletext.ToUpper()
                                }
                                Else {
                                    $joinedTitle = $Titletext
                                }
                            }
                            if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                                if ($TakeLocal) {
                                    Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                        Copy-Item -LiteralPath $_.FullName -Destination $BackgroundImage | Out-Null
                                    }
                                    if ($SkipLocalBackgroundTextAdd -eq 'true') {
                                        $SkippingText = 'true'
                                    }
                                    Write-Entry -Subtext "Copy local asset to: $BackgroundImage" -Path $global:configLogging -Color Green -log Info
                                }
                                Else {
                                    try {
                                        if (!$global:PlexartworkDownloaded) {
                                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $BackgroundImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                        }
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
                                    Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                    if ($global:posterurl -like 'https://image.tmdb.org*') {
                                        if ($global:PosterWithText) {
                                            Write-Entry -Subtext "Downloading background with Text from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Textless background from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                        }
                                        if ($global:FavProvider -ne 'TMDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    elseif ($global:posterurl -like 'https://assets.fanart.tv*') {
                                        if ($global:PosterWithText) {
                                            Write-Entry -Subtext "Downloading background with Text from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:FANARTAssetTextLang
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Textless background from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:FANARTAssetTextLang
                                        }
                                        if ($global:FavProvider -ne 'FANART') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    elseif ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                        if ($global:PosterWithText) {
                                            Write-Entry -Subtext "Downloading background with Text from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Textless background from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                        }
                                        if ($global:FavProvider -ne 'TVDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    elseif ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                        Write-Entry -Subtext "Downloading Background from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        if ($global:FavProvider -ne 'PLEX') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading background from 'IMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:IsFallback = $true
                                    }
                                }
                                $global:IsTruncated = $null
                                if ($global:ForceTextAssetRestoration -ne $null) {
                                    if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                        $global:PosterPreferTextless = $global:OriginalPreferTextless
                                        $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                            $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                            $global:OriginalPreferredLanguageOrder = $null
                                        }
                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                        $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                        $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                            $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                            $global:OriginalPreferredBackgroundLanguageOrder = $null
                                        }
                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                        $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                        $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                            $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                            $global:OriginalPreferredSeasonLanguageOrder = $null
                                        }
                                    }
                                    $global:ForceTextAssetRestoration = $null
                                }
                                if ($global:ImageProcessing -eq 'true') {
                                    Write-Entry -Subtext "Processing background for: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                    $CommentArguments = "`"$backgroundImage`" -set `"comment`" `"created with posterizarr`" `"$backgroundImage`""
                                    $CommentlogEntry = "`"$magick`" $CommentArguments"
                                    $CommentlogEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                    if ($global:ImageMagickError -ne 'true') {
                                        if ($UseBackgroundResolutionOverlays -eq 'true') {
                                            switch ($entry.Resolution) {
                                                '4K DoVi/HDR10' { $backgroundoverlay = $4KDoViHDR10Background }
                                                '4K DoVi' { $backgroundoverlay = $4KDoViBackground }
                                                '4K HDR10' { $backgroundoverlay = $4KHDR10Background }
                                                '4K' { $backgroundoverlay = $4kBackground }
                                                '1080p' { $backgroundoverlay = $1080pBackground }
                                                Default { $backgroundoverlay = $Defaultbackgroundoverlay }
                                            }
                                        }
                                        Else {
                                            $backgroundoverlay = $Defaultbackgroundoverlay
                                        }
                                        # Logic for SkipAddTextAndOverlay (Skip Overlay, keep Border)
                                        if (($SkipAddTextAndOverlay -eq 'true') -and $global:PosterWithText) {
                                            $LocalAddOverlay = 'false'
                                        }

                                        # Logic for SkipAddTextAndBorder (Skip Border, keep Overlay)
                                        if (($SkipAddTextAndBorder -eq 'true') -and $global:PosterWithText) {
                                            $LocalAddBorder = 'false'
                                        }

                                        # Logic for "If both are true, only resize"
                                        if ($SkipAddTextAndOverlay -eq 'true' -and $SkipAddTextAndBorder -eq 'true' -and $global:PosterWithText) {
                                            $LocalAddBorder = 'false'
                                            $LocalAddOverlay = 'false'
                                        }
                                        # Calculate the height to maintain the aspect ratio with a width of 1000 pixels
                                        if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                            $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$backgroundoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$Backgroundborderwidthsecond`"  -bordercolor `"$Backgroundbordercolor`" -border `"$Backgroundborderwidth`" `"$backgroundImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                        }
                                        elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                            $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$Backgroundborderwidthsecond`"  -bordercolor `"$Backgroundbordercolor`" -border `"$Backgroundborderwidth`" `"$backgroundImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                        }
                                        elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                            $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$Backgroundoverlay`" -gravity south -quality $global:outputQuality -composite `"$backgroundImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                        }
                                        else {
                                            $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$backgroundImage`""
                                            Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                        }
                                        $logEntry = "`"$magick`" $Arguments"
                                        $logEntry | Write-MagickLog
                                        InvokeMagickCommand -Command $magick -Arguments $Arguments
                                        if (($SkipAddText -eq 'true' -or $SkipAddTextAndOverlay -eq 'true') -and $global:PosterWithText) {
                                            $SkippingText = 'true'
                                            Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                        }
                                        # ONLY proceed with Logo or Text application if SkippingText is NOT true
                                        if ($SkippingText -ne 'true') {
                                            if ($UseBGLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                                $ApplyTextInsteadOfLogo = $null
                                                $global:LogoUrl = $null
                                                $global:LogoLanguage = $null
                                                $allProviders = @('TMDB', 'FANART', 'TVDB')
                                                $searchOrder = @($global:FavProvider) + ($allProviders -ne $global:FavProvider)

                                                foreach ($provider in $searchOrder) {
                                                    if (-not [string]::IsNullOrEmpty($global:LogoUrl)) { break }
                                                    switch ($provider) {
                                                        'TMDB' { if ($entry.tmdbid) { $global:LogoUrl = GetTMDBLogo -Type movie } }
                                                        'FANART' { $global:LogoUrl = GetFanartLogo -Type movies }
                                                        'TVDB' { if ($entry.tvdbid) { $global:LogoUrl = GetTVDBLogo -Type movies } }
                                                    }
                                                }
                                                if (-not [string]::IsNullOrEmpty($global:LogoUrl)) {
                                                    $global:IsFallback = $false
                                                    switch ($global:FavProvider) {
                                                        'TMDB' {
                                                            if (-not ($global:LogoUrl.StartsWith("https://image.tmdb.org"))) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        'TVDB' {
                                                            if (-not ($global:LogoUrl.StartsWith("https://artworks.thetvdb.com"))) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        'FANART' {
                                                            if (-not ($global:LogoUrl.StartsWith("https://assets.fanart.tv"))) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                    }
                                                    if ($global:IsFallback) {
                                                        Write-Entry -Subtext "Logo Source: Fallback (URL did not match $global:FavProvider)" -Path $global:configLogging -Color Yellow -log Debug
                                                    }
                                                }
                                                if ([string]::IsNullOrEmpty($global:LogoUrl)) {
                                                    Write-Entry -Subtext "Could not find a logo on any provider (Tried: $($searchOrder -join ', '))" -Path $global:configLogging -Color Yellow -log Warning
                                                }
                                                if (!$global:LogoUrl -and $TextFallback -eq 'true') {
                                                    $ApplyTextInsteadOfLogo = 'true'
                                                    Write-Entry -Subtext "Falling back to text as no logo was found." -Path $global:configLogging -Color Yellow -log Warning
                                                    $global:IsFallback = $true
                                                }
                                                ElseIf ($global:LogoUrl) {
                                                    $urlExtension = [System.IO.Path]::GetExtension($global:LogoUrl).Split('?')[0]
                                                    if ([string]::IsNullOrWhiteSpace($urlExtension)) { $urlExtension = ".png" }
                                                                                                                    $LogoImage = Join-Path $TempPath ("$($entry.RootFoldername)_logo" + $urlExtension); Write-Entry -Message "Logo Used: $global:LogoUrl" -Path $global:configLogging -Color Cyan -log Debug
                                                    try {
                                                        $response = Invoke-WebRequest -Uri $global:LogoUrl -OutFile $LogoImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
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
                                                    # Only apply color if enabled AND color is defined
                                                    $colorEffect = ""
                                                    if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                                                        $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                                                        $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                                                        if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                                                        else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                                                    }
                                                    if ($urlExtension -match "(?i)\.svg") {
                                                        Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                                                        $Arguments = "`"$backgroundImage`" ( -background none -density 300 `"$LogoImage`" $colorEffect -resize `"$Backgroundboxsize`" `) -gravity `"$Backgroundtextgravity`" -geometry +0+`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                    }
                                                    else {
                                                        $Arguments = "`"$backgroundImage`" ( -background none `"$LogoImage`" $colorEffect -resize `"$Backgroundboxsize`" `) -gravity `"$Backgroundtextgravity`" -geometry +0+`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                    }
                                                    Write-Entry -Subtext "Applying Logo..." -Path $global:configLogging -Color White -log Info
                                                    $logEntry = "`"$magick`" $Arguments"
                                                    $logEntry | Write-MagickLog
                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments

                                                    Remove-Item -LiteralPath $LogoImage -Force -ErrorAction SilentlyContinue | out-null
                                                }
                                            }
                                            if ($ApplyTextInsteadOfLogo -eq 'true' -or $UseBGLogo -eq 'false') {
                                                if ($AddBackgroundText -eq 'true' -and $SkippingText -eq 'false') {
                                                    if ($global:direction -eq "RTL") {
                                                        $backgroundfontImagemagick = $RTLfontImagemagick
                                                    }
                                                    $joinedTitle = $joinedTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                    $joinedTitle = $joinedTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                    # Loop through each symbol and replace it with a newline
                                                    if ($NewLineOnSpecificSymbols -eq 'true') {
                                                        foreach ($symbol in $NewLineSymbols) {
                                                            # Replace the symbol with a newline
                                                            $replacementString = "`n"

                                                            # Check if the symbol should be kept
                                                            $keepThisSymbol = $false
                                                            if ($null -ne $SymbolsToKeepOnNewLine) {
                                                                # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                                foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                    # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                    if ($symbol -like "*$k*") {
                                                                        $keepThisSymbol = $true
                                                                        break # Match found, no need to keep checking
                                                                    }
                                                                }
                                                            }

                                                            # If it's a "keep" symbol, change the replacement string
                                                            if ($keepThisSymbol) {
                                                                # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                                $replacementString = $symbol + "`n"
                                                            }
                                                            $joinedTitle = $joinedTitle -replace [regex]::Escape($symbol), $replacementString
                                                        }
                                                    }
                                                    if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                        $properties = $NewLineWords.PSObject.Properties.Name

                                                        # Check if properties exist and the list is not empty
                                                        if ($null -ne $properties -and $properties.Count -gt 0) {
                                                            foreach ($wordKey in $properties) {
                                                                $replacementValue = $NewLineWords.$wordKey

                                                                # Using [regex]::Escape handles any special characters in the word keys
                                                                $joinedTitle = $joinedTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                            }
                                                        }
                                                    }
                                                    $joinedTitlePointSize = $joinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                    $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $backgroundfontImagemagick -box_width $BackgroundMaxWidth  -box_height $BackgroundMaxHeight -min_pointsize $BackgroundminPointSize -max_pointsize $BackgroundmaxPointSize -lineSpacing $BackgroundlineSpacing
                                                    if ($global:IsTruncated -ne $true) {
                                                        Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                        $cleanTitle = $joinedTitle -replace 'Â³', '' -replace 'Â²', ''
                                                        $cleanTitle = $joinedTitle -replace 'Â³', '' -replace 'Â²', ''
                                                        $supChar = if ($joinedTitle -match 'Â³') { "3" } elseif ($joinedTitle -match 'Â²') { "2" } else { "" }
                                                        $superSize = [int]($optimalFontSize * 0.55)
                                                        $yNudge = [int]($optimalFontSize * 0.3)
                                                        $gap = 20

                                                        if ($supChar -ne "" -and $AddTextStroke -eq 'true') {
                                                            # SUPERSCRIPT + STROKE MODE
                                                            $Arguments = "`"$backgroundImage`" ( -background none " +
                                                            "( ( -font `"$backgroundfontImagemagick`" -pointsize $optimalFontSize -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" label:`"$cleanTitle`" ) " +
                                                            "( -font `"$backgroundfontImagemagick`" -pointsize $superSize -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                            "( ( -font `"$backgroundfontImagemagick`" -pointsize $optimalFontSize -fill `"$Backgroundfontcolor`" -stroke none label:`"$cleanTitle`" ) " +
                                                            "( -font `"$backgroundfontImagemagick`" -pointsize $superSize -fill `"$Backgroundfontcolor`" -stroke none label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                            "-gravity center -composite ) -gravity south -geometry +0`"$Backgroundtext_offset`" -composite `"$backgroundImage`""
                                                        }
                                                        elseif ($supChar -ne "") {
                                                            # SUPERSCRIPT ONLY MODE (No Stroke)
                                                            $Arguments = "`"$backgroundImage`" ( -background none " +
                                                            "( -font `"$backgroundfontImagemagick`" -pointsize $optimalFontSize -fill `"$Backgroundfontcolor`" label:`"$cleanTitle`" ) " +
                                                            "( -font `"$backgroundfontImagemagick`" -pointsize $superSize -fill `"$Backgroundfontcolor`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap " +
                                                            ") -gravity south -geometry +0`"$Backgroundtext_offset`" -composite `"$backgroundImage`""
                                                        }
                                                        else {
                                                            # STANDARD MODE (Normal caption logic)
                                                            if ($AddTextStroke -eq 'true') {
                                                                $Arguments = "`"$backgroundImage`" -gravity center -background None -layers Flatten `( -size `"$Backgroundboxsize`" -background none `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" `) `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundfontcolor`" -stroke none -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Backgroundboxsize`" `) -gravity south -geometry +0`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                            }
                                                            Else {
                                                                $Arguments = "`"$backgroundImage`" -gravity center -background None -layers Flatten ( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundfontcolor`" -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$Backgroundboxsize`" ) -gravity south -geometry +0`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                            }
                                                        }

                                                        Write-Entry -Subtext "Applying Background text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                                        $logEntry = "`"$magick`" $Arguments"
                                                        $logEntry | Write-MagickLog
                                                        InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Else {
                                    $Resizeargument = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$backgroundImage`""
                                    Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                    $logEntry = "`"$magick`" $Resizeargument"
                                    $logEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                                }
                                if ($global:ImageMagickError -ne 'true') {
                                    # Move file back to original naming with Brackets.
                                    if (Get-ChildItem -LiteralPath $backgroundImage -ErrorAction SilentlyContinue) {
                                        if ($global:IsTruncated -ne $true) {
                                            if ($UseOtherMediaServer -eq 'true' -and $entry.Id) {
                                                Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($entry.Id)" -Path $global:configLogging -Color Cyan -log Debug
                                                UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Backdrop" -imagePath $backgroundImage
                                            }
                                            if ($Upload2Plex -eq 'true') {
                                                try {
                                                    Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                    
                                                    # Verify variables before uploading
                                                    Write-Entry -Subtext "BackgroundImage: $backgroundImage" -Path $global:configLogging -Color Cyan -log Debug
                                                    Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                    Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                    $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/arts"
                                                    Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                    # Try uploading, capturing the response in detail
                                                    $Upload = Invoke-WebRequest -Uri $uri `
                                                        -Method Post `
                                                        -Headers $extraPlexHeaders `
                                                        -InFile $backgroundImage `
-ContentType 'image/jpeg' `
                                                        -SkipHttpErrorCheck `
                                                        -ErrorAction Stop

                                                    if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                        Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                        Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                    }
                                                    else {
                                                        Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                        Write-Entry -Subtext "$Titletext | Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                    }
                                                }
                                                catch {
                                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                                }
                                            }
                                            try {
                                                $BackgroundTargetDir = Split-Path -Path $backgroundImageoriginal -Parent
                                                if ($BackgroundTargetDir -and -not (Test-Path -LiteralPath $BackgroundTargetDir)) {
                                                    New-Item -ItemType Directory -Path $BackgroundTargetDir -Force | Out-Null
                                                }
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
                                        Else {
                                            Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        $moviebackgroundtemp = New-Object psobject
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Movie Background'
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback) { 'true' } else { 'false' })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $backgroundImage } Else { $global:posterurl })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                        $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                        switch -Wildcard ($global:FavProvider) {
                                            'TMDB' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                            'FANART' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                            'TVDB' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                            Default { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                        }
                                        # Export the array to a CSV file
                                        $moviebackgroundtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                        if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $moviebackgroundtemp.Type -title $moviebackgroundtemp.Title -Lib $moviebackgroundtemp.LibraryName -DLSource $moviebackgroundtemp.'Download Source' -lang $moviebackgroundtemp.Language -favurl $moviebackgroundtemp.'Fav Provider Link' -fallback $moviebackgroundtemp.Fallback -Truncated $moviebackgroundtemp.TextTruncated }
                                    }
                                }
                            }
                            Elseif ($LocalAssetMissing -eq 'true') {
                                Write-Entry -Subtext "Skipping [$Titletext] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                            }
                            Else {
                                Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                $moviebackgroundtemp = New-Object psobject
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Movie Background'
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                    'FANART' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                    'TVDB' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                    Default { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                }

                                # Export the array to a CSV file
                                $moviebackgroundtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $moviebackgroundtemp.Type -title $moviebackgroundtemp.Title -Lib $moviebackgroundtemp.LibraryName -DLSource $moviebackgroundtemp.'Download Source' -lang $moviebackgroundtemp.Language -favurl $moviebackgroundtemp.'Fav Provider Link' -fallback $moviebackgroundtemp.Fallback -Truncated $moviebackgroundtemp.TextTruncated }
                            }
                        }
                        else {
                            if ($global:UploadExistingAssets -eq 'true') {
                                if ($entry.PlexBackgroundUrl -like "/library/*") {
                                    $Arturl = $plexurl + $entry.PlexBackgroundUrl
                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                    try {
                                        GetPlexArtwork -Type " $Titletext | Backgound Artwork." -ArtUrl $Arturl -TempImage $backgroundImage
                                        if ($global:PlexartworkDownloaded -eq 'true') {
                                            Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                            
                                            # Verify variables before uploading
                                            Write-Entry -Subtext "BackgroundImage: $backgroundImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                            Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                            Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                            $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/arts"
                                            Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                            # Try uploading, capturing the response in detail
                                            $Upload = Invoke-WebRequest -Uri $uri `
                                                -Method Post `
                                                -Headers $extraPlexHeaders `
                                                -InFile $backgroundImageoriginal `
-ContentType 'image/jpeg' `
                                                -SkipHttpErrorCheck `
                                                -ErrorAction Stop
    
                                            if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                            }
                                            else {
                                                Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                Write-Entry -Subtext "$Titletext | Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                            }
                                            $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                        }
                                    }
                                    catch {
                                        Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                        $global:errorCount = Increment-GlobalStat 'errorCount'
                                        Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                                elseif ($entry.Id) {
                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                    Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                    UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Backdrop" -imagePath $backgroundImageoriginal
                                }
                                if (Test-Path $backgroundImage -ErrorAction SilentlyContinue) {
                                    Remove-Item -LiteralPath $backgroundImage | Out-Null
                                    Write-Entry -Message "Deleting Temp Image: $backgroundImage" -Path $global:configLogging -Color White -log Info
                                }
                            }
                            Else {
                                if ($show_skipped -eq 'true' ) {
                                    Write-Entry -Subtext "Already exists: $backgroundImageoriginal" -Path $global:configLogging -Color Cyan -log Info
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
        catch {
            Write-Entry -Subtext "Error processing movie '$($entry.title)': $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            write-Entry -Subtext "At line $($_.InvocationInfo.ScriptLineNumber)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            if ($global:PosterOnlyTextless) {
                $moviebackgroundtemp = New-Object psobject
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Movie Background'
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                switch -Wildcard ($global:FavProvider) {
                    'TMDB' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                    'FANART' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                    'TVDB' { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                    Default { $moviebackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                }

                # Export the array to a CSV file
                $moviebackgroundtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $moviebackgroundtemp.Type -title $moviebackgroundtemp.Title -Lib $moviebackgroundtemp.LibraryName -DLSource $moviebackgroundtemp.'Download Source' -lang $moviebackgroundtemp.Language -favurl $moviebackgroundtemp.'Fav Provider Link' -fallback $moviebackgroundtemp.Fallback -Truncated $moviebackgroundtemp.TextTruncated }
            }

        }
    }

function Invoke-ShowPosterCreation {
    param (
        $entry
    )
        if ($null -eq $entry) { return }
        Set-LibraryLanguageOverride -LibraryName $entry.'Library Name' -MediaType 'Show'

        if ($($entry.RootFoldername)) {
            # check if item has skip label
            if ($entry.labels -match 'skip_posterizarr') {
                Write-Entry -Message "Skipping '$($entry.title)' because it has a skip label..." -Path $global:configLogging -Color Yellow -log Warning
            }
            Else {
                # Define Global Variables
                $SkippingText = 'false'
                $global:tmdbsearched = $null
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
                $TakeLocal = $null
                $LocalAssetMissing = $null
                $LocalAddOverlay = $AddOverlay
                $LocalAddBorder = $AddBorder

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

                if ([string]::IsNullOrWhiteSpace($Titletext)) {
                    # Native Cyrillic/CJK content often has no distinct originalTitle in Plex,
                    # which left Titletext blank above and broke the metadata search entirely.
                    # Fall back to whichever of title/originalTitle actually has a value.
                    if (-not [string]::IsNullOrWhiteSpace($entry.title)) {
                        $Titletext = $entry.title
                    }
                    elseif (-not [string]::IsNullOrWhiteSpace($entry.originalTitle)) {
                        $Titletext = $entry.originalTitle
                    }
                }

                if ($LibraryFolders -eq 'true') {
                    $LibraryName = $entry.'Library Name'
                    if ($entry.extraFolder) {
                        $EntryDir = "$AssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                        $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                    }
                    Else {
                        $EntryDir = "$AssetPath\$LibraryName\$($entry.RootFoldername)"
                        $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.RootFoldername)"
                    }
                    $PosterImageoriginal = "$EntryDir\poster.jpg"
                    $TestPath = $EntryDir
                    $ManualTestPath = $ManualEntryDir
                    $Testfile = "poster"

                }
                Else {
                    if ($entry.extraFolder) {
                        $PosterImageoriginal = "$AssetPath\$($entry.extraFolder)\$($entry.RootFoldername).jpg"
                    }
                    Else {
                        $PosterImageoriginal = "$AssetPath\$($entry.RootFoldername).jpg"
                    }
                    $TestPath = $AssetPath
                    $ManualTestPath = $ManualPath
                    $Testfile = $($entry.RootFoldername)
                }

                if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                    $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    $PosterImageoriginal = ($PosterImageoriginal).Replace('\', '/').Replace('./', '/')
                    $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                }
                else {
                    $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                    $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                    if ($fullTestPath) {
                        $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                    }
                    Else {
                        $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                        $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                    }
                }

                Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Manual Test Path is: $ManualTestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Manual Test Path is: $Manualtestpath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Manual Full Test Path is: $fullManualTestPath" -Path $global:configLogging -Color Cyan -log Debug

                $PosterImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.ratingKey)_$($entry.RootFoldername).jpg"
                $PosterImage = $PosterImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')

                # Now we can start the Poster Part
                if ($global:Posters -eq 'true') {
                    $checkedItems.Add($hashtestpath)
                    if (-not $directoryHashtable.ContainsKey("$hashtestpath")) {
                        $Arturl = $null
                        if ($entry.PlexPosterUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexPosterUrl
                        }
                        elseif ($entry.OtherMediaServerPosterUrl) {
                            $Arturl = "$OtherMediaServerUrl/items/$($entry.Id)/images/Primary/"
                        }
                        foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                            $filePath = "$ManualTestPath$ext"
                            if (Test-Path -LiteralPath $filePath) {
                                Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                $posterext = $ext
                                break
                            }
                        }
                        if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                            Write-Entry -Message "Found Manual Poster for: $Titletext" -Path $global:configLogging -Color White -log Info
                            $TakeLocal = $true
                        }
                        Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlinePosterFetch -eq 'true') {
                            $LocalAssetMissing = 'true'
                        }
                        Else {
                            # [Posterizarr TextlessFallback] Pre-check logo availability to revert to text poster if needed.
                            $tempLogoAvailable = $false
                            if ($TextlessPosterBypass -eq 'true' -and $UseLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                $tempLogoUrl = $null
                                $searchOrder = @($global:FavProvider) + (@('TMDB', 'FANART', 'TVDB') -ne $global:FavProvider)
                                foreach ($provider in $searchOrder) {
                                    if (-not [string]::IsNullOrEmpty($tempLogoUrl)) { break }
                                    switch ($provider) {
                                        'TMDB' { if ($entry.tmdbid) { $tempLogoUrl = GetTMDBLogo -Type tv } }
                                        'FANART' { $t = if('tv' -eq 'movie') {'movies'} else {'tv'}; $tempLogoUrl = GetFanartLogo -Type $t }
                                        'TVDB' { if ($entry.tvdbid) { $t = if('tv' -eq 'movie') {'movies'} else {'series'}; $tempLogoUrl = GetTVDBLogo -Type $t } }
                                    }
                                }
                                if ($tempLogoUrl) { $tempLogoAvailable = $true }
                                
                                if (-not $tempLogoAvailable) {
                                    Write-Entry -Message "TextlessFallback (textposter): No logo available. Forcing standard Text Asset." -Path $global:configLogging -Color Cyan -log Info
                                    $global:OriginalPreferTextless = $global:PosterPreferTextless
                                    $global:OriginalOnlyTextless = $global:PosterOnlyTextless
                                    $global:OriginalPreferredLanguageOrder = $global:PreferredLanguageOrder
                                    $tempOrder = @($global:PreferredLanguageOrder | Where-Object { $_ -ne 'xx' })
                                    if (-not $tempOrder) { $tempOrder = @('en') }
                                    $global:PreferredLanguageOrder = $tempOrder
                                    Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $tempOrder
                                    $global:PosterPreferTextless = $false
                                    $global:PosterOnlyTextless = $false
                                    $global:ForceTextAssetRestoration = '$global:PosterPreferTextless'
                                }
                            }
                            Write-Entry -Message "Start Poster Search for: $Titletext" -Path $global:configLogging -Color White -log Info
                            if ($global:OverrideProviderOrder) {
                                $global:LoopFallbackPosterUrl = $null
                                foreach ($provider in $global:ProviderOrder) {
                                    if ($global:posterurl -or $global:PlexartworkDownloaded) { break }
                                    switch -Wildcard ($provider) {
                                        'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowPoster } }
                                        'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBShowPoster } }
                                        'FANART' { $global:posterurl = GetFanartShowPoster }
                                        'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Show Poster' -ArtUrl $Arturl -TempImage $PosterImage } }
                                    }

                                    if ($global:posterurl -and $global:PosterPreferTextless -eq $true -and !$global:TextlessPoster) {
                                        if (!$global:LoopFallbackPosterUrl) { $global:LoopFallbackPosterUrl = $global:posterurl }
                                        $global:posterurl = $null
                                        $global:IsFallback = $true
                                    }

                                    if ($global:posterurl -or $global:PlexartworkDownloaded) {
                                        Write-Entry -Subtext "Took image from custom provider loop: $provider" -Path $global:configLogging -Color Cyan -log Info
                                        if ($provider -ne $global:ProviderOrder[0]) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (!$global:posterurl -and $global:LoopFallbackPosterUrl -and $global:PosterOnlyTextless -ne $true) {
                                    $global:posterurl = $global:LoopFallbackPosterUrl
                                    Write-Entry -Subtext "Took fallback image with text from custom provider loop because no textless poster was found." -Path $global:configLogging -Color Cyan -log Info
                                }
                            }
                            Else {
                            switch -Wildcard ($global:FavProvider) {
                                'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowPoster }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowPoster } }
                                'FANART' { $global:posterurl = GetFanartShowPoster }
                                'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBShowPoster }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowPoster } }
                                'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Show Poster' -ArtUrl $Arturl -TempImage $PosterImage } }
                                Default { $global:posterurl = GetFanartShowPoster }
                            }
                            if (!$global:posterurl) {
                                Write-Entry -Subtext "Could not find a poster on: $global:FavProvider" -Path $global:configLogging -Color White -log Info
                            }
                            switch -Wildcard ($global:Fallback) {
                                'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowPoster } Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning } }
                                'FANART' { $global:posterurl = GetFanartShowPoster }
                            }
                            if ($global:PosterPreferTextless -eq $true) {
                                if (!$global:TextlessPoster -and $global:fanartfallbackposterurl) {
                                    $global:posterurl = $global:fanartfallbackposterurl
                                    Write-Entry -Subtext "Took Fanart.tv Fallback poster because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                    $global:IsFallback = $true
                                }
                                if (!$global:TextlessPoster -and $global:TMDBfallbackposterurl) {
                                    $global:posterurl = $global:TMDBfallbackposterurl
                                    Write-Entry -Subtext "Took TMDB Fallback poster because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                    $global:IsFallback = $true
                                }
                                if (!$global:TextlessPoster -and $global:TVDBfallbackposterurl) {
                                    $global:posterurl = $global:TVDBfallbackposterurl
                                    Write-Entry -Subtext "Took TVDB Fallback poster because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                    $global:IsFallback = $true
                                }
                                # try to find textless on TVDB
                                if ($global:TextlessPoster -ne 'true' -and $entry.tvdbid -and $global:FavProvider -ne 'TVDB') {
                                    $global:posterurl = GetTVDBShowPoster
                                    $global:IsFallback = $true
                                    $global:tvdbalreadysearched = $true
                                }
                                if ($global:FavProvider -eq 'TVDB' -and $global:TextlessPoster -ne 'true') {
                                    $global:posterurl = GetFanartMoviePoster
                                    $global:IsFallback = $true
                                }
                            }

                            if (!$global:TextlessPoster -eq 'true' -and $global:posterurl) {
                                $global:PosterWithText = $true
                            }

                            if (!$global:posterurl -and $global:tvdbalreadysearched -ne "True") {
                                $global:posterurl = GetTVDBShowPoster
                                $global:IsFallback = $true
                                if (!$global:posterurl -and !$global:TMDBfallbackposterurl -and !$global:fanartfallbackposterurl) {
                                    if ($ArtUrl -and !$global:PosterOnlyTextless) {
                                        GetPlexArtwork -Type ' a Show Poster' -ArtUrl $Arturl -TempImage $PosterImage
                                        $global:plexalreadysearched = $True
                                    }
                                    Else {
                                        Write-Entry -Subtext "MediaServer Poster Url empty, cannot search on MediaServer, likely there is no artwork..." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                    if (!$global:posterurl) {
                                        Write-Entry -Subtext "Could not find a poster on any site" -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                            }
                            if (!$global:posterurl -and !$global:plexalreadysearched -eq 'true') {
                                $global:IsFallback = $true
                                if ($ArtUrl -and !$global:PosterOnlyTextless) {
                                    GetPlexArtwork -Type ' a Show Poster' -ArtUrl $Arturl -TempImage $PosterImage
                                    $global:plexalreadysearched = $True
                                }
                                Else {
                                    Write-Entry -Subtext "MediaServer Poster Url empty, cannot search on MediaServer, likely there is no artwork..." -Path $global:configLogging -Color Yellow -log Warning
                                }
                                if (!$global:posterurl) {
                                    Write-Entry -Subtext "Could not find a poster on any site" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                            if (!$global:TextlessPoster -eq 'true' -and $global:TMDBfallbackposterurl) {
                                $global:posterurl = $global:TMDBfallbackposterurl
                            }
                            if (!$global:TextlessPoster -eq 'true' -and $global:fanartfallbackposterurl) {
                                $global:posterurl = $global:fanartfallbackposterurl
                            }
                        }
                            }
                        if ($fontAllCaps -eq 'true') {
                            $joinedTitle = $Titletext.ToUpper()
                        }
                        Else {
                            $joinedTitle = $Titletext
                        }
                        if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                            if ($TakeLocal) {
                                Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                    Copy-Item -LiteralPath $_.FullName -Destination $PosterImage | Out-Null
                                }
                                if ($SkipLocalPosterTextAdd -eq 'true') {
                                    $SkippingText = 'true'
                                }
                                Write-Entry -Subtext "Copy local asset to: $PosterImage" -Path $global:configLogging -Color Green -log Info
                            }
                            Else {
                                try {
                                    if (!$global:PlexartworkDownloaded) {
                                        $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $PosterImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                    }
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
                                Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                if ($global:posterurl -like 'https://image.tmdb.org*') {
                                    if ($global:PosterWithText) {
                                        Write-Entry -Subtext "Downloading Poster with Text from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Textless Poster from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                    }
                                    if ($global:FavProvider -ne 'TMDB') {
                                        $global:IsFallback = $true
                                    }
                                }
                                elseif ($global:posterurl -like 'https://assets.fanart.tv*') {
                                    if ($global:PosterWithText) {
                                        Write-Entry -Subtext "Downloading Poster with Text from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:FANARTAssetTextLang
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Textless Poster from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:FANARTAssetTextLang
                                    }
                                    if ($global:FavProvider -ne 'Fanart') {
                                        $global:IsFallback = $true
                                    }
                                }
                                elseif ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                    if ($global:PosterWithText) {
                                        Write-Entry -Subtext "Downloading Poster with Text from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Textless Poster from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                    }
                                    if ($global:FavProvider -ne 'TVDB') {
                                        $global:IsFallback = $true
                                    }
                                }
                                elseif ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                    Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    if ($global:FavProvider -ne 'PLEX') {
                                        $global:IsFallback = $true
                                    }
                                }
                                Else {
                                    Write-Entry -Subtext "Downloading Poster from 'IMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    $global:IsFallback = $true
                                }
                            }
                            $global:IsTruncated = $null
                            if ($global:ForceTextAssetRestoration -ne $null) {
                                if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                    $global:PosterPreferTextless = $global:OriginalPreferTextless
                                    $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                        $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                        $global:OriginalPreferredLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                    $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                    $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                        $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                        $global:OriginalPreferredBackgroundLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                    $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                    $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                        $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                        $global:OriginalPreferredSeasonLanguageOrder = $null
                                    }
                                }
                                $global:ForceTextAssetRestoration = $null
                            }
                            if ($global:ImageProcessing -eq 'true') {
                                Write-Entry -Subtext "Processing Poster for: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                $CommentArguments = "`"$PosterImage`" -set `"comment`" `"created with posterizarr`" `"$PosterImage`""
                                $CommentlogEntry = "`"$magick`" $CommentArguments"
                                $CommentlogEntry | Write-MagickLog
                                InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                if ($global:ImageMagickError -ne 'true') {
                                    if ($UsePosterResolutionOverlays -eq 'true') {
                                        switch ($entry.Resolution) {
                                            '4K DoVi/HDR10' { $Posteroverlay = $4KDoViHDR10 }
                                            '4K DoVi' { $Posteroverlay = $4KDoVi }
                                            '4K HDR10' { $Posteroverlay = $4KHDR10 }
                                            '4K' { $Posteroverlay = $4kposter }
                                            '1080p' { $Posteroverlay = $1080pPoster }
                                            Default { $Posteroverlay = $DefaultShowPosteroverlay }
                                        }
                                    }
                                    Else {
                                        $Posteroverlay = $DefaultShowPosteroverlay
                                    }
                                    # Logic for SkipAddTextAndOverlay (Skip Overlay, keep Border)
                                    if (($SkipAddTextAndOverlay -eq 'true') -and $global:PosterWithText) {
                                        $LocalAddOverlay = 'false'
                                    }

                                    # Logic for SkipAddTextAndBorder (Skip Border, keep Overlay)
                                    if (($SkipAddTextAndBorder -eq 'true') -and $global:PosterWithText) {
                                        $LocalAddBorder = 'false'
                                    }

                                    # Logic for "If both are true, only resize"
                                    if ($SkipAddTextAndOverlay -eq 'true' -and $SkipAddTextAndBorder -eq 'true' -and $global:PosterWithText) {
                                        $LocalAddBorder = 'false'
                                        $LocalAddOverlay = 'false'
                                    }
                                    # Calculate the height to maintain the aspect ratio with a width of 1000 pixels
                                    if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                        $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Posteroverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$borderwidthsecond`"  -bordercolor `"$bordercolor`" -border `"$borderwidth`" `"$PosterImage`""
                                        Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                    }
                                    elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                        $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" -shave `"$borderwidthsecond`"  -bordercolor `"$bordercolor`" -border `"$borderwidth`" `"$PosterImage`""
                                        Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                    }
                                    elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                        $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Posteroverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                                        Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                    }
                                    else {
                                        $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                                        Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                    }
                                    $logEntry = "`"$magick`" $Arguments"
                                    $logEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                    if (($SkipAddText -eq 'true' -or $SkipAddTextAndOverlay -eq 'true') -and $global:PosterWithText) {
                                        $SkippingText = 'true'
                                        Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                    }
                                    # ONLY proceed with Logo or Text application if SkippingText is NOT true
                                    if ($SkippingText -ne 'true') {
                                        if ($UseLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                            $ApplyTextInsteadOfLogo = $null
                                            $global:LogoUrl = $null
                                            $global:LogoLanguage = $null
                                            $allProviders = @('TMDB', 'FANART', 'TVDB')
                                            $searchOrder = @($global:FavProvider) + ($allProviders -ne $global:FavProvider)

                                            foreach ($provider in $searchOrder) {
                                                if (-not [string]::IsNullOrEmpty($global:LogoUrl)) { break }
                                                switch ($provider) {
                                                    'TMDB' { if ($entry.tmdbid) { $global:LogoUrl = GetTMDBLogo -Type tv } }
                                                    'FANART' { $global:LogoUrl = GetFanartLogo -Type tv }
                                                    'TVDB' { if ($entry.tvdbid) { $global:LogoUrl = GetTVDBLogo -Type series } }
                                                }
                                            }
                                            if (-not [string]::IsNullOrEmpty($global:LogoUrl)) {
                                                $global:IsFallback = $false
                                                switch ($global:FavProvider) {
                                                    'TMDB' {
                                                        if (-not ($global:LogoUrl.StartsWith("https://image.tmdb.org"))) {
                                                            $global:IsFallback = $true
                                                        }
                                                    }
                                                    'TVDB' {
                                                        if (-not ($global:LogoUrl.StartsWith("https://artworks.thetvdb.com"))) {
                                                            $global:IsFallback = $true
                                                        }
                                                    }
                                                    'FANART' {
                                                        if (-not ($global:LogoUrl.StartsWith("https://assets.fanart.tv"))) {
                                                            $global:IsFallback = $true
                                                        }
                                                    }
                                                }
                                                if ($global:IsFallback) {
                                                    Write-Entry -Subtext "Logo Source: Fallback (URL did not match $global:FavProvider)" -Path $global:configLogging -Color Yellow -log Debug
                                                }
                                            }
                                            if ([string]::IsNullOrEmpty($global:LogoUrl)) {
                                                Write-Entry -Subtext "Could not find a logo on any provider (Tried: $($searchOrder -join ', '))" -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            if (!$global:LogoUrl -and $TextFallback -eq 'true') {
                                                $ApplyTextInsteadOfLogo = 'true'
                                                Write-Entry -Subtext "Falling back to text as no logo was found." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                            }
                                            ElseIf ($global:LogoUrl) {
                                                $urlExtension = [System.IO.Path]::GetExtension($global:LogoUrl).Split('?')[0]
                                                if ([string]::IsNullOrWhiteSpace($urlExtension)) { $urlExtension = ".png" }
                                                                                                                $LogoImage = Join-Path $TempPath ("$($entry.RootFoldername)_logo" + $urlExtension); Write-Entry -Message "Logo Used: $global:LogoUrl" -Path $global:configLogging -Color Cyan -log Debug
                                                try {
                                                    $response = Invoke-WebRequest -Uri $global:LogoUrl -OutFile $LogoImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
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
                                                # Only apply color if enabled AND color is defined
                                                $colorEffect = ""
                                                if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                                                    $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                                                    $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                                                    if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                                                    else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                                                }
                                                if ($urlExtension -match "(?i)\.svg") {
                                                    Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                                                    $Arguments = "`"$PosterImage`" ( -background none -density 300 `"$LogoImage`" $colorEffect -resize `"$boxsize`" `) -gravity `"$textgravity`" -geometry +0+`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                }
                                                else {
                                                    $Arguments = "`"$PosterImage`" ( -background none `"$LogoImage`" $colorEffect -resize `"$boxsize`" `) -gravity `"$textgravity`" -geometry +0+`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                }
                                                Write-Entry -Subtext "Applying Logo..." -Path $global:configLogging -Color White -log Info
                                                $logEntry = "`"$magick`" $Arguments"
                                                $logEntry | Write-MagickLog
                                                InvokeMagickCommand -Command $magick -Arguments $Arguments

                                                Remove-Item -LiteralPath $LogoImage -Force -ErrorAction SilentlyContinue | out-null
                                            }
                                        }
                                        if ($ApplyTextInsteadOfLogo -eq 'true' -or $UseLogo -eq 'false') {
                                            if ($AddText -eq 'true' -and $SkippingText -eq 'false') {
                                                if ($global:direction -eq "RTL") {
                                                    $fontImagemagick = $RTLfontImagemagick
                                                }
                                                $joinedTitle = $joinedTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''

                                                # Loop through each symbol and replace it with a newline
                                                if ($NewLineOnSpecificSymbols -eq 'true') {
                                                    foreach ($symbol in $NewLineSymbols) {
                                                        # Replace the symbol with a newline
                                                        $replacementString = "`n"

                                                        # Check if the symbol should be kept
                                                        $keepThisSymbol = $false
                                                        if ($null -ne $SymbolsToKeepOnNewLine) {
                                                            # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                            foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                if ($symbol -like "*$k*") {
                                                                    $keepThisSymbol = $true
                                                                    break # Match found, no need to keep checking
                                                                }
                                                            }
                                                        }

                                                        # If it's a "keep" symbol, change the replacement string
                                                        if ($keepThisSymbol) {
                                                            # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                            $replacementString = $symbol + "`n"
                                                        }
                                                        $joinedTitle = $joinedTitle -replace [regex]::Escape($symbol), $replacementString
                                                    }
                                                }
                                                if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                    $properties = $NewLineWords.PSObject.Properties.Name

                                                    # Check if properties exist and the list is not empty
                                                    if ($null -ne $properties -and $properties.Count -gt 0) {
                                                        foreach ($wordKey in $properties) {
                                                            $replacementValue = $NewLineWords.$wordKey

                                                            # Using [regex]::Escape handles any special characters in the word keys
                                                            $joinedTitle = $joinedTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                        }
                                                    }
                                                }
                                                $joinedTitlePointSize = $joinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $fontImagemagick -box_width $MaxWidth  -box_height $MaxHeight -min_pointsize $minPointSize -max_pointsize $maxPointSize -lineSpacing $lineSpacing
                                                if ($global:IsTruncated -ne $true) {
                                                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                    $cleanTitle = $joinedTitle -replace 'Â³', '' -replace 'Â²', ''
                                                    $supChar = if ($joinedTitle -match 'Â³') { "3" } elseif ($joinedTitle -match 'Â²') { "2" } else { "" }

                                                    $superSize = [int]($optimalFontSize * 0.55)
                                                    $yNudge = [int]($optimalFontSize * 0.3)
                                                    $gap = 20

                                                    if ($supChar -ne "" -and $AddTextStroke -eq 'true') {
                                                        # SUPERSCRIPT + STROKE MODE
                                                        $Arguments = "`"$PosterImage`" ( -background none " +
                                                        "( ( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" label:`"$cleanTitle`" ) " +
                                                        "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                        "( ( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$fontcolor`" -stroke none label:`"$cleanTitle`" ) " +
                                                        "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$fontcolor`" -stroke none label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                        "-gravity center -composite ) -gravity south -geometry +0`"$text_offset`" -composite `"$PosterImage`""
                                                    }
                                                    elseif ($supChar -ne "") {
                                                        # SUPERSCRIPT ONLY MODE (No Stroke)
                                                        $Arguments = "`"$PosterImage`" ( -background none " +
                                                        "( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$fontcolor`" label:`"$cleanTitle`" ) " +
                                                        "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$fontcolor`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap " +
                                                        ") -gravity south -geometry +0`"$text_offset`" -composite `"$PosterImage`""
                                                    }
                                                    else {
                                                        # STANDARD MODE (Normal caption logic)
                                                        if ($AddTextStroke -eq 'true') {
                                                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$boxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$fontcolor`" -stroke none -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$boxsize`" `) -gravity south -geometry +0`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                        }
                                                        Else {
                                                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten ( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$fontcolor`" -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$boxsize`" ) -gravity south -geometry +0`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                                                        }
                                                    }

                                                    Write-Entry -Subtext "Applying Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                                    $logEntry = "`"$magick`" $Arguments"
                                                    $logEntry | Write-MagickLog
                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Else {
                                $Resizeargument = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                                Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                $logEntry = "`"$magick`" $Resizeargument"
                                $logEntry | Write-MagickLog
                                InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                            }
                            if ($global:ImageMagickError -ne 'true') {
                                if (Get-ChildItem -LiteralPath $PosterImage -ErrorAction SilentlyContinue) {
                                    # Move file back to original naming with Brackets.
                                    if ($global:IsTruncated -ne $true) {
                                        if ($UseOtherMediaServer -eq 'true' -and $entry.Id) {
                                            Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($entry.Id)" -Path $global:configLogging -Color Cyan -log Debug
                                            UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Primary" -imagePath $PosterImage
                                        }
                                        if ($Upload2Plex -eq 'true') {
                                            try {
                                                Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                
                                                # Verify variables before uploading
                                                Write-Entry -Subtext "PosterImage: $PosterImage" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/posters"
                                                Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                # Try uploading, capturing the response in detail
                                                $Upload = Invoke-WebRequest -Uri $uri `
                                                    -Method Post `
                                                    -Headers $extraPlexHeaders `
                                                    -InFile $PosterImage `
-ContentType 'image/jpeg' `
                                                    -SkipHttpErrorCheck `
                                                    -ErrorAction Stop

                                                if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                    Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                    Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                }
                                                else {
                                                    Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                    Write-Entry -Subtext "$Titletext | Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                    $null = Increment-GlobalStat 'PlexRootPosterUploads'
                                                }
                                            }
                                            catch {
                                                Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                $global:errorCount = Increment-GlobalStat 'errorCount'
                                                Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                            }
                                        }
                                        try {
                                            $PosterTargetDir = Split-Path -Path $PosterImageoriginal -Parent
                                            if ($PosterTargetDir -and -not (Test-Path -LiteralPath $PosterTargetDir)) {
                                                New-Item -ItemType Directory -Path $PosterTargetDir -Force | Out-Null
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
                                    Else {
                                        Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                    $showtemp = New-Object psobject
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Show'
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback) { 'true' } else { 'false' })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $PosterImage } Else { $global:posterurl })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                    $showtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                    switch -Wildcard ($global:FavProvider) {
                                        'TMDB' { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                        'FANART' { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                        'TVDB' { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                        Default { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                    }
                                    # Export the array to a CSV file
                                    $showtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                    if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $showtemp.Type -title $showtemp.Title -Lib $showtemp.LibraryName -DLSource $showtemp.'Download Source' -lang $showtemp.Language -favurl $showtemp.'Fav Provider Link' -fallback $showtemp.Fallback -Truncated $showtemp.TextTruncated }
                                }
                            }
                        }
                        Elseif ($LocalAssetMissing -eq 'true') {
                            Write-Entry -Subtext "Skipping [$Titletext] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                        }
                        Else {
                            Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            $showtemp = New-Object psobject
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Show'
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                            $showtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                            $showtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                            $showtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                            $showtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                            $showtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                            $showtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                            switch -Wildcard ($global:FavProvider) {
                                'TMDB' { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                'FANART' { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                'TVDB' { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                Default { $showtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                            }

                            # Export the array to a CSV file
                            $showtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                            if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $showtemp.Type -title $showtemp.Title -Lib $showtemp.LibraryName -DLSource $showtemp.'Download Source' -lang $showtemp.Language -favurl $showtemp.'Fav Provider Link' -fallback $showtemp.Fallback -Truncated $showtemp.TextTruncated }
                        }
                    }
                    else {
                        if ($global:UploadExistingAssets -eq 'true') {
                            if ($entry.PlexPosterUrl -like "/library/*") {
                                $Arturl = $plexurl + $entry.PlexPosterUrl
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                try {
                                    GetPlexArtwork -Type "$Titletext Artwork." -ArtUrl $Arturl -TempImage $PosterImage
                                    if ($global:PlexartworkDownloaded -eq 'true') {
                                        Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                        
                                        # Verify variables before uploading
                                        Write-Entry -Subtext "PosterImage: $PosterImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                        $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/posters"
                                        Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                        # Try uploading, capturing the response in detail
                                        $Upload = Invoke-WebRequest -Uri $uri `
                                            -Method Post `
                                            -Headers $extraPlexHeaders `
                                            -InFile $PosterImageoriginal `
-ContentType 'image/jpeg' `
                                            -SkipHttpErrorCheck `
                                            -ErrorAction Stop
    
                                        if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                            Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                            Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                        }
                                        else {
                                            Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                            Write-Entry -Subtext "$Titletext | Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                            $null = Increment-GlobalStat 'PlexRootPosterUploads'
                                        }
                                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                    }
                                }
                                catch {
                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                            elseif ($entry.Id) {
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Primary" -imagePath $PosterImageoriginal
                            }
                            if (Test-Path $PosterImage -ErrorAction SilentlyContinue) {
                                Remove-Item -LiteralPath $PosterImage | Out-Null
                                Write-Entry -Message "Deleting Temp Image: $PosterImage" -Path $global:configLogging -Color White -log Info
                            }
                        }
                        Else {
                            if ($show_skipped -eq 'true' ) {
                                Write-Entry -Subtext "Already exists: $PosterImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                            }
                        }
                    }
                }
                # Now we can start the Background Part
                if ($global:BackgroundPosters -eq 'true') {
                    if ($LibraryFolders -eq 'true') {
                        $LibraryName = $entry.'Library Name'
                        if ($entry.extraFolder) {
                            $EntryDir = "$AssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                            $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.extraFolder)\$($entry.RootFoldername)"
                        }
                        Else {
                            $EntryDir = "$AssetPath\$LibraryName\$($entry.RootFoldername)"
                            $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($entry.RootFoldername)"
                        }
                        $backgroundImageoriginal = "$EntryDir\background.jpg"
                        $TestPath = $EntryDir
                        $ManualTestPath = $ManualEntryDir
                        $Testfile = "background"

                    }
                    Else {
                        if ($entry.extraFolder) {
                            $backgroundImageoriginal = "$AssetPath\$($entry.extraFolder)\$($entry.RootFoldername)_background.jpg"
                        }
                        Else {
                            $backgroundImageoriginal = "$AssetPath\$($entry.RootFoldername)_background.jpg"
                        }
                        $TestPath = $AssetPath
                        $ManualTestPath = $ManualPath
                        $Testfile = "$($entry.RootFoldername)_background"
                    }

                    if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                        $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                        $backgroundImageoriginal = ($backgroundImageoriginal).Replace('\', '/').Replace('./', '/')
                        $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    }
                    else {
                        $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                        $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                        if ($fullTestPath) {
                            $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                            $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        }
                        Else {
                            $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                            $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                        }
                    }

                    Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Manual Test Path is: $ManualTestPath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Manual Test Path is: $Manualtestpath" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Message "Resolved Manual Full Test Path is: $fullManualTestPath" -Path $global:configLogging -Color Cyan -log Debug

                    $backgroundImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.ratingKey)_$($entry.RootFoldername)_background.jpg"
                    $backgroundImage = $backgroundImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                    $checkedItems.Add($hashtestpath)

                    if (-not $directoryHashtable.ContainsKey("$hashtestpath")) {
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
                        $global:TMDBfallbackposterurl = $null
                        $global:fanartfallbackposterurl = $null
                        $TakeLocal = $null
                        $LocalAssetMissing = $null
                        $Arturl = $null
                        $LocalAddOverlay = $AddBackgroundOverlay
                        $LocalAddBorder = $AddBackgroundBorder

                        if ($entry.PlexBackgroundUrl -like "/library/*") {
                            $Arturl = $plexurl + $entry.PlexBackgroundUrl
                        }
                        elseif ($entry.OtherMediaServerBackgroundUrl) {
                            $Arturl = "$OtherMediaServerUrl/items/$($entry.Id)/images/backdrop/"
                        }

                        foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                            $filePath = "$ManualTestPath$ext"
                            if (Test-Path -LiteralPath $filePath) {
                                Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                $posterext = $ext
                                break
                            }
                        }
                        if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                            Write-Entry -Message "Found Manual Background for: $Titletext" -Path $global:configLogging -Color White -log Info
                            $TakeLocal = $true
                        }
                        Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlineBackgroundFetch -eq 'true') {
                            $LocalAssetMissing = 'true'
                        }
                        Else {
                            # [Posterizarr TextlessFallback] Pre-check logo availability to revert to text poster if needed.
                            $tempLogoAvailable = $false
                            if ($TextlessPosterBypass -eq 'true' -and $UseBGLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                $tempLogoUrl = $null
                                $searchOrder = @($global:FavProvider) + (@('TMDB', 'FANART', 'TVDB') -ne $global:FavProvider)
                                foreach ($provider in $searchOrder) {
                                    if (-not [string]::IsNullOrEmpty($tempLogoUrl)) { break }
                                    switch ($provider) {
                                        'TMDB' { if ($entry.tmdbid) { $tempLogoUrl = GetTMDBLogo -Type tv } }
                                        'FANART' { $t = if('tv' -eq 'movie') {'movies'} else {'tv'}; $tempLogoUrl = GetFanartLogo -Type $t }
                                        'TVDB' { if ($entry.tvdbid) { $t = if('tv' -eq 'movie') {'movies'} else {'series'}; $tempLogoUrl = GetTVDBLogo -Type $t } }
                                    }
                                }
                                if ($tempLogoUrl) { $tempLogoAvailable = $true }
                                
                                if (-not $tempLogoAvailable) {
                                    Write-Entry -Message "TextlessFallback (textposter): No logo available. Forcing standard Text Asset." -Path $global:configLogging -Color Cyan -log Info
                                    $global:OriginalPreferTextless = $global:BackgroundPreferTextless
                                    $global:OriginalOnlyTextless = $global:BackgroundOnlyTextless
                                    $global:OriginalPreferredBackgroundLanguageOrder = $global:PreferredBackgroundLanguageOrder
                                    $tempOrder = @($global:PreferredBackgroundLanguageOrder | Where-Object { $_ -ne 'xx' })
                                    if (-not $tempOrder) { $tempOrder = @('en') }
                                    $global:PreferredBackgroundLanguageOrder = $tempOrder
                                    Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $tempOrder
                                    $global:BackgroundPreferTextless = $false
                                    $global:BackgroundOnlyTextless = $false
                                    $global:ForceTextAssetRestoration = '$global:BackgroundPreferTextless'
                                }
                            }
                            Write-Entry -Message "Start Background Search for: $Titletext" -Path $global:configLogging -Color White -log Info
                            if ($global:OverrideProviderOrder) {
                                $global:LoopFallbackPosterUrl = $null
                                foreach ($provider in $global:ProviderOrder) {
                                    if ($global:posterurl -or $global:PlexartworkDownloaded) { break }
                                    switch -Wildcard ($provider) {
                                        'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowBackground } }
                                        'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBShowBackground } }
                                        'FANART' { $global:posterurl = GetFanartShowBackground }
                                        'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Show Background' -ArtUrl $Arturl -TempImage $backgroundImage } }
                                    }

                                    if ($global:posterurl -and $global:BackgroundPreferTextless -eq 'true' -and !$global:TextlessPoster) {
                                        if (!$global:LoopFallbackPosterUrl) { $global:LoopFallbackPosterUrl = $global:posterurl }
                                        $global:posterurl = $null
                                        $global:IsFallback = $true
                                    }

                                    if ($global:posterurl -or $global:PlexartworkDownloaded) {
                                        Write-Entry -Subtext "Took image from custom provider loop: $provider" -Path $global:configLogging -Color Cyan -log Info
                                        if ($provider -ne $global:ProviderOrder[0]) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (!$global:posterurl -and $global:LoopFallbackPosterUrl -and $global:BackgroundOnlyTextless -ne $true) {
                                    $global:posterurl = $global:LoopFallbackPosterUrl
                                    Write-Entry -Subtext "Took fallback image with text from custom provider loop because no textless background was found." -Path $global:configLogging -Color Cyan -log Info
                                }
                            }
                            Else {
                            switch -Wildcard ($global:FavProvider) {
                                'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowBackground }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowBackground } }
                                'FANART' { $global:posterurl = GetFanartShowBackground }
                                'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBShowBackground }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowBackground } }
                                'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Show Background' -ArtUrl $Arturl -TempImage $backgroundImage } }
                                Default { $global:posterurl = GetFanartShowBackground }
                            }
                            switch -Wildcard ($global:Fallback) {
                                'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowBackground } }
                                'FANART' { $global:posterurl = GetFanartShowBackground }
                            }
                            if ($global:BackgroundPreferTextless -eq $true) {
                                if (!$global:TextlessPoster -and $global:fanartfallbackposterurl) {
                                    $global:posterurl = $global:fanartfallbackposterurl
                                    Write-Entry -Subtext "Took Fanart.tv Fallback background because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                    $global:IsFallback = $true
                                }
                                if (!$global:TextlessPoster -and $global:TMDBfallbackposterurl) {
                                    $global:posterurl = $global:TMDBfallbackposterurl
                                    Write-Entry -Subtext "Took TMDB Fallback background because it is your Fav Provider" -Path $global:configLogging -Color Cyan -log Info
                                    $global:IsFallback = $true
                                }
                                if ($global:FavProvider -eq 'TVDB' -and !$global:posterurl) {
                                    if ($entry.tmdbid) {
                                        $global:posterurl = GetTMDBShowBackground
                                        if ($global:posterurl) {
                                            $global:IsFallback = $true
                                        }
                                        $global:FallbackText = 'True-Background'
                                    }
                                    if (!$global:posterurl) {
                                        $global:posterurl = GetFanartShowBackground
                                        if ($global:posterurl) {
                                            $global:IsFallback = $true
                                        }
                                        $global:FallbackText = 'True-Background'
                                    }
                                }
                            }
                            if ($global:BackgroundOnlyTextless -and !$global:posterurl) {
                                if ($global:FavProvider -eq 'TVDB') {
                                    if ($entry.tmdbid) {
                                        $global:posterurl = GetTMDBShowBackground
                                        $global:IsFallback = $true
                                        $global:FallbackText = 'True-Background'
                                    }
                                    if (!$global:posterurl) {
                                        $global:posterurl = GetFanartShowBackground
                                        $global:IsFallback = $true
                                        $global:FallbackText = 'True-Background'
                                    }
                                }
                                Else {
                                    $global:posterurl = GetFanartShowBackground
                                }
                            }
                            if (!$global:posterurl) {
                                if ($global:FavProvider -ne 'TVDB') {
                                    $global:posterurl = GetTVDBShowBackground
                                    if ($global:posterurl) {
                                        $global:IsFallback = $true
                                    }
                                }
                                $global:FallbackText = 'True-Background'
                                if (!$global:posterurl) {
                                    if ($ArtUrl) {
                                        GetPlexArtwork -Type ' a Show Background' -ArtUrl $Arturl -TempImage $backgroundImage
                                        if ($global:posterurl) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    Else {
                                        Write-Entry -Subtext "Plex Background Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                    if (!$global:posterurl) {
                                        Write-Entry -Subtext "Could not find a background on any site" -Path $global:configLogging -Color Red -log Error
                                    }
                                }

                            }
                        }
                            }
                        if ($BackgroundfontAllCaps -eq 'true') {
                            $joinedTitle = $Titletext.ToUpper()
                        }
                        Else {
                            $joinedTitle = $Titletext
                        }
                        if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                            if ($TakeLocal) {
                                Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                    Copy-Item -LiteralPath $_.FullName -Destination $BackgroundImage | Out-Null
                                }
                                if ($SkipLocalBackgroundTextAdd -eq 'true') {
                                    $SkippingText = 'true'
                                }
                                Write-Entry -Subtext "Copy local asset to: $BackgroundImage" -Path $global:configLogging -Color Green -log Info
                            }
                            Else {
                                try {
                                    if (!$global:PlexartworkDownloaded) {
                                        $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $BackgroundImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                    }
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
                                Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                if ($global:posterurl -like 'https://image.tmdb.org*') {
                                    if ($global:PosterWithText) {
                                        Write-Entry -Subtext "Downloading background with Text from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Textless background from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                    }
                                    if ($global:FavProvider -ne 'TMDB') {
                                        $global:IsFallback = $true
                                    }
                                }
                                elseif ($global:posterurl -like 'https://assets.fanart.tv*') {
                                    if ($global:PosterWithText) {
                                        Write-Entry -Subtext "Downloading background with Text from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:FANARTAssetTextLang
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Textless background from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:FANARTAssetTextLang
                                    }
                                    if ($global:FavProvider -ne 'FANART') {
                                        $global:IsFallback = $true
                                    }
                                }
                                elseif ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                    if ($global:PosterWithText) {
                                        Write-Entry -Subtext "Downloading background with Text from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                    }
                                    Else {
                                        Write-Entry -Subtext "Downloading Textless background from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                    }
                                    if ($global:FavProvider -ne 'TVDB') {
                                        $global:IsFallback = $true
                                    }
                                }
                                elseif ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                    Write-Entry -Subtext "Downloading Background from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    if ($global:FavProvider -ne 'PLEX') {
                                        $global:IsFallback = $true
                                    }
                                }
                                Else {
                                    Write-Entry -Subtext "Downloading background from 'IMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    $global:IsFallback = $true
                                }
                            }
                            $global:IsTruncated = $null
                            if ($global:ForceTextAssetRestoration -ne $null) {
                                if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                    $global:PosterPreferTextless = $global:OriginalPreferTextless
                                    $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                        $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                        $global:OriginalPreferredLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                    $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                    $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                        $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                        $global:OriginalPreferredBackgroundLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                    $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                    $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                        $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                        $global:OriginalPreferredSeasonLanguageOrder = $null
                                    }
                                }
                                $global:ForceTextAssetRestoration = $null
                            }
                            if ($global:ImageProcessing -eq 'true') {
                                Write-Entry -Subtext "Processing background for: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                $CommentArguments = "`"$backgroundImage`" -set `"comment`" `"created with posterizarr`" `"$backgroundImage`""
                                $CommentlogEntry = "`"$magick`" $CommentArguments"
                                $CommentlogEntry | Write-MagickLog
                                InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                if ($global:ImageMagickError -ne 'true') {
                                    if ($UseBackgroundResolutionOverlays -eq 'true') {
                                        switch ($entry.Resolution) {
                                            '4K DoVi/HDR10' { $backgroundoverlay = $4KDoViHDR10Background }
                                            '4K DoVi' { $backgroundoverlay = $4KDoViBackground }
                                            '4K HDR10' { $backgroundoverlay = $4KHDR10Background }
                                            '4K' { $backgroundoverlay = $4kBackground }
                                            '1080p' { $backgroundoverlay = $1080pBackground }
                                            Default { $backgroundoverlay = $DefaultShowBackgroundoverlay }
                                        }
                                    }
                                    Else {
                                        $backgroundoverlay = $DefaultShowBackgroundoverlay
                                    }
                                    $settings = Get-OverlayAndBorderSettings -AddBorder $LocalAddBorder -AddOverlay $LocalAddOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                                    $LocalAddBorder = $settings.Border
                                    $LocalAddOverlay = $settings.Overlay
                                    # Calculate the height to maintain the aspect ratio with a width of 1000 pixels
                                    if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                        $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$Backgroundoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$Backgroundborderwidthsecond`"  -bordercolor `"$Backgroundbordercolor`" -border `"$Backgroundborderwidth`" `"$backgroundImage`""
                                        Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                    }
                                    elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                        $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$Backgroundborderwidthsecond`"  -bordercolor `"$Backgroundbordercolor`" -border `"$Backgroundborderwidth`" `"$backgroundImage`""
                                        Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                    }
                                    elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                        $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$Backgroundoverlay`" -gravity south -quality $global:outputQuality -composite `"$backgroundImage`""
                                        Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                    }
                                    else {
                                        $Arguments = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$backgroundImage`""
                                        Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                    }
                                    $logEntry = "`"$magick`" $Arguments"
                                    $logEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                    $SkippingText = Get-SkipTextSetting -SkipAddText $SkipAddText -SkipAddTextAndOverlay $SkipAddTextAndOverlay -PosterWithText $global:PosterWithText
                                    if ($SkippingText -eq 'true') {
                                        Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                    }
                                    # ONLY proceed with Logo or Text application if SkippingText is NOT true
                                    if ($SkippingText -ne 'true') {
                                        if ($UseBGLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                            $ApplyTextInsteadOfLogo = $null
                                            $global:LogoUrl = $null
                                            $global:LogoLanguage = $null
                                            $allProviders = @('TMDB', 'FANART', 'TVDB')
                                            $searchOrder = @($global:FavProvider) + ($allProviders -ne $global:FavProvider)

                                            foreach ($provider in $searchOrder) {
                                                if (-not [string]::IsNullOrEmpty($global:LogoUrl)) { break }
                                                switch ($provider) {
                                                    'TMDB' { if ($entry.tmdbid) { $global:LogoUrl = GetTMDBLogo -Type tv } }
                                                    'FANART' { $global:LogoUrl = GetFanartLogo -Type tv }
                                                    'TVDB' { if ($entry.tvdbid) { $global:LogoUrl = GetTVDBLogo -Type series } }
                                                }
                                            }
                                            if (-not [string]::IsNullOrEmpty($global:LogoUrl)) {
                                                $global:IsFallback = $false
                                                switch ($global:FavProvider) {
                                                    'TMDB' {
                                                        if (-not ($global:LogoUrl.StartsWith("https://image.tmdb.org"))) {
                                                            $global:IsFallback = $true
                                                        }
                                                    }
                                                    'TVDB' {
                                                        if (-not ($global:LogoUrl.StartsWith("https://artworks.thetvdb.com"))) {
                                                            $global:IsFallback = $true
                                                        }
                                                    }
                                                    'FANART' {
                                                        if (-not ($global:LogoUrl.StartsWith("https://assets.fanart.tv"))) {
                                                            $global:IsFallback = $true
                                                        }
                                                    }
                                                }
                                                if ($global:IsFallback) {
                                                    Write-Entry -Subtext "Logo Source: Fallback (URL did not match $global:FavProvider)" -Path $global:configLogging -Color Yellow -log Debug
                                                }
                                            }
                                            if ([string]::IsNullOrEmpty($global:LogoUrl)) {
                                                Write-Entry -Subtext "Could not find a logo on any provider (Tried: $($searchOrder -join ', '))" -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            if (!$global:LogoUrl -and $TextFallback -eq 'true') {
                                                $ApplyTextInsteadOfLogo = 'true'
                                                Write-Entry -Subtext "Falling back to text as no logo was found." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                            }
                                            ElseIf ($global:LogoUrl) {
                                                $urlExtension = [System.IO.Path]::GetExtension($global:LogoUrl).Split('?')[0]
                                                if ([string]::IsNullOrWhiteSpace($urlExtension)) { $urlExtension = ".png" }
                                                                                                                $LogoImage = Join-Path $TempPath ("$($entry.RootFoldername)_logo" + $urlExtension); Write-Entry -Message "Logo Used: $global:LogoUrl" -Path $global:configLogging -Color Cyan -log Debug
                                                try {
                                                    $response = Invoke-WebRequest -Uri $global:LogoUrl -OutFile $LogoImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
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
                                                # Only apply color if enabled AND color is defined
                                                $colorEffect = ""
                                                if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                                                    $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                                                    $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                                                    if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                                                    else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                                                }
                                                if ($urlExtension -match "(?i)\.svg") {
                                                    Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                                                    $Arguments = "`"$backgroundImage`" ( -background none -density 300 `"$LogoImage`" $colorEffect -resize `"$Backgroundboxsize`" `) -gravity `"$Backgroundtextgravity`" -geometry +0+`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                }
                                                else {
                                                    $Arguments = "`"$backgroundImage`" ( -background none `"$LogoImage`" $colorEffect -resize `"$Backgroundboxsize`" `) -gravity `"$Backgroundtextgravity`" -geometry +0+`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                }
                                                Write-Entry -Subtext "Applying Logo..." -Path $global:configLogging -Color White -log Info
                                                $logEntry = "`"$magick`" $Arguments"
                                                $logEntry | Write-MagickLog
                                                InvokeMagickCommand -Command $magick -Arguments $Arguments

                                                Remove-Item -LiteralPath $LogoImage -Force -ErrorAction SilentlyContinue | out-null
                                            }
                                        }
                                        if ($ApplyTextInsteadOfLogo -eq 'true' -or $UseBGLogo -eq 'false') {
                                            if ($AddBackgroundText -eq 'true' -and $SkippingText -eq 'false') {
                                                if ($global:direction -eq "RTL") {
                                                    $backgroundfontImagemagick = $RTLfontImagemagick
                                                }
                                                $joinedTitle = $joinedTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''

                                                # Loop through each symbol and replace it with a newline
                                                if ($NewLineOnSpecificSymbols -eq 'true') {
                                                    foreach ($symbol in $NewLineSymbols) {
                                                        # Replace the symbol with a newline
                                                        $replacementString = "`n"

                                                        # Check if the symbol should be kept
                                                        $keepThisSymbol = $false
                                                        if ($null -ne $SymbolsToKeepOnNewLine) {
                                                            # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                            foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                if ($symbol -like "*$k*") {
                                                                    $keepThisSymbol = $true
                                                                    break # Match found, no need to keep checking
                                                                }
                                                            }
                                                        }

                                                        # If it's a "keep" symbol, change the replacement string
                                                        if ($keepThisSymbol) {
                                                            # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                            $replacementString = $symbol + "`n"
                                                        }
                                                        $joinedTitle = $joinedTitle -replace [regex]::Escape($symbol), $replacementString
                                                    }
                                                }
                                                if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                    $properties = $NewLineWords.PSObject.Properties.Name

                                                    # Check if properties exist and the list is not empty
                                                    if ($null -ne $properties -and $properties.Count -gt 0) {
                                                        foreach ($wordKey in $properties) {
                                                            $replacementValue = $NewLineWords.$wordKey

                                                            # Using [regex]::Escape handles any special characters in the word keys
                                                            $joinedTitle = $joinedTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                        }
                                                    }
                                                }
                                                $joinedTitlePointSize = $joinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $backgroundfontImagemagick -box_width $BackgroundMaxWidth  -box_height $BackgroundMaxHeight -min_pointsize $BackgroundminPointSize -max_pointsize $BackgroundmaxPointSize -lineSpacing $BackgroundlineSpacing
                                                if ($global:IsTruncated -ne $true) {
                                                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                    $cleanTitle = $joinedTitle -replace 'Â³', '' -replace 'Â²', ''
                                                    $supChar = if ($joinedTitle -match 'Â³') { "3" } elseif ($joinedTitle -match 'Â²') { "2" } else { "" }

                                                    $superSize = [int]($optimalFontSize * 0.55)
                                                    $yNudge = [int]($optimalFontSize * 0.3)
                                                    $gap = 20

                                                    if ($supChar -ne "" -and $AddTextStroke -eq 'true') {
                                                        # SUPERSCRIPT + STROKE MODE
                                                        $Arguments = "`"$backgroundImage`" ( -background none " +
                                                        "( ( -font `"$backgroundfontImagemagick`" -pointsize $optimalFontSize -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" label:`"$cleanTitle`" ) " +
                                                        "( -font `"$backgroundfontImagemagick`" -pointsize $superSize -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                        "( ( -font `"$backgroundfontImagemagick`" -pointsize $optimalFontSize -fill `"$Backgroundfontcolor`" -stroke none label:`"$cleanTitle`" ) " +
                                                        "( -font `"$backgroundfontImagemagick`" -pointsize $superSize -fill `"$Backgroundfontcolor`" -stroke none label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                        "-gravity center -composite ) -gravity south -geometry +0`"$Backgroundtext_offset`" -composite `"$backgroundImage`""
                                                    }
                                                    elseif ($supChar -ne "") {
                                                        # SUPERSCRIPT ONLY MODE (No Stroke)
                                                        $Arguments = "`"$backgroundImage`" ( -background none " +
                                                        "( -font `"$backgroundfontImagemagick`" -pointsize $optimalFontSize -fill `"$Backgroundfontcolor`" label:`"$cleanTitle`" ) " +
                                                        "( -font `"$backgroundfontImagemagick`" -pointsize $superSize -fill `"$Backgroundfontcolor`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap " +
                                                        ") -gravity south -geometry +0`"$Backgroundtext_offset`" -composite `"$backgroundImage`""
                                                    }
                                                    else {
                                                        # STANDARD MODE (Normal caption logic)
                                                        if ($AddTextStroke -eq 'true') {
                                                            $Arguments = "`"$backgroundImage`" -gravity center -background None -layers Flatten `( -size `"$Backgroundboxsize`" -background none `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" `) `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundfontcolor`" -stroke none -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Backgroundboxsize`" `) -gravity south -geometry +0`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                        }
                                                        Else {
                                                            $Arguments = "`"$backgroundImage`" -gravity center -background None -layers Flatten ( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundfontcolor`" -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$Backgroundboxsize`" ) -gravity south -geometry +0`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$backgroundImage`""
                                                        }
                                                    }

                                                    Write-Entry -Subtext "Applying Background text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                                                    $logEntry = "`"$magick`" $Arguments"
                                                    $logEntry | Write-MagickLog
                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Else {
                                $Resizeargument = "`"$backgroundImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$backgroundImage`""
                                Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                $logEntry = "`"$magick`" $Resizeargument"
                                $logEntry | Write-MagickLog
                                InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                            }
                            if ($global:ImageMagickError -ne 'true') {
                                # Move file back to original naming with Brackets.
                                if (Get-ChildItem -LiteralPath $backgroundImage -ErrorAction SilentlyContinue) {
                                    if ($global:IsTruncated -ne $true) {
                                        if ($UseOtherMediaServer -eq 'true' -and $entry.Id) {
                                            Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($entry.Id)" -Path $global:configLogging -Color Cyan -log Debug
                                            UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Backdrop" -imagePath $backgroundImage
                                        }
                                        if ($Upload2Plex -eq 'true') {
                                            try {
                                                Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                
                                                # Verify variables before uploading
                                                Write-Entry -Subtext "BackgroundImage: $backgroundImage" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/arts"
                                                Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                # Try uploading, capturing the response in detail
                                                $Upload = Invoke-WebRequest -Uri $uri `
                                                    -Method Post `
                                                    -Headers $extraPlexHeaders `
                                                    -InFile $backgroundImage `
-ContentType 'image/jpeg' `
                                                    -SkipHttpErrorCheck `
                                                    -ErrorAction Stop

                                                if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                    Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                    Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                }
                                                else {
                                                    Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                    Write-Entry -Subtext "$Titletext | Background successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                }
                                            }
                                            catch {
                                                Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                $global:errorCount = Increment-GlobalStat 'errorCount'
                                                Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                            }
                                        }
                                        try {
                                            $BackgroundTargetDir = Split-Path -Path $backgroundImageoriginal -Parent
                                            if ($BackgroundTargetDir -and -not (Test-Path -LiteralPath $BackgroundTargetDir)) {
                                                New-Item -ItemType Directory -Path $BackgroundTargetDir -Force | Out-Null
                                            }
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
                                        $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
                                        Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                        $global:posterCount = Increment-GlobalStat 'posterCount'
                                    }
                                    Else {
                                        Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                    $showbackgroundtemp = New-Object psobject
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Show Background'
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback) { 'true' } else { 'false' })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $backgroundImage } Else { $global:posterurl })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                    $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                    switch -Wildcard ($global:FavProvider) {
                                        'TMDB' { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                        'FANART' { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                        'TVDB' { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                        Default { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                    }
                                    # Export the array to a CSV file
                                    $showbackgroundtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                    if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $showbackgroundtemp.Type -title $showbackgroundtemp.Title -Lib $showbackgroundtemp.LibraryName -DLSource $showbackgroundtemp.'Download Source' -lang $showbackgroundtemp.Language -favurl $showbackgroundtemp.'Fav Provider Link' -fallback $showbackgroundtemp.Fallback -Truncated $showbackgroundtemp.TextTruncated }
                                }
                            }
                        }
                        Elseif ($LocalAssetMissing -eq 'true') {
                            Write-Entry -Subtext "Skipping [$Titletext] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                        }
                        Else {
                            Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                            $showbackgroundtemp = New-Object psobject
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $Titletext
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Show Background'
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                            $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                            switch -Wildcard ($global:FavProvider) {
                                'TMDB' { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                'FANART' { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                'TVDB' { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                Default { $showbackgroundtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                            }

                            # Export the array to a CSV file
                            $showbackgroundtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                            if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $showbackgroundtemp.Type -title $showbackgroundtemp.Title -Lib $showbackgroundtemp.LibraryName -DLSource $showbackgroundtemp.'Download Source' -lang $showbackgroundtemp.Language -favurl $showbackgroundtemp.'Fav Provider Link' -fallback $showbackgroundtemp.Fallback -Truncated $showbackgroundtemp.TextTruncated }
                        }
                    }
                    else {
                        if ($global:UploadExistingAssets -eq 'true') {
                            if ($entry.PlexBackgroundUrl -like "/library/*") {
                                $Arturl = $plexurl + $entry.PlexBackgroundUrl
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                try {
                                    GetPlexArtwork -Type " $Titletext | Backgound Artwork." -ArtUrl $Arturl -TempImage $backgroundImage
                                    if ($global:PlexartworkDownloaded -eq 'true') {
                                        Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                        
                                        # Verify variables before uploading
                                        Write-Entry -Subtext "BackgroundImage: $backgroundImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "RatingKey: $($entry.ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                        $uri = "$PlexUrl/library/metadata/$($entry.ratingkey)/arts"
                                        Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                        # Try uploading, capturing the response in detail
                                        $Upload = Invoke-WebRequest -Uri $uri `
                                            -Method Post `
                                            -Headers $extraPlexHeaders `
                                            -InFile $backgroundImageoriginal `
-ContentType 'image/jpeg' `
                                            -SkipHttpErrorCheck `
                                            -ErrorAction Stop
    
                                        if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                            Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                            Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                        }
                                        else {
                                            Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                            Write-Entry -Subtext "$Titletext | Background successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                        }
                                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                    }
                                }
                                catch {
                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                            elseif ($entry.Id) {
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                UploadOtherMediaServerArtwork -itemId $entry.Id -imageType "Backdrop" -imagePath $backgroundImageoriginal
                            }
                            if (Test-Path $backgroundImage -ErrorAction SilentlyContinue) {
                                Remove-Item -LiteralPath $backgroundImage | Out-Null
                                Write-Entry -Message "Deleting Temp Image: $backgroundImage" -Path $global:configLogging -Color White -log Info
                            }
                        }
                        Else {
                            if ($show_skipped -eq 'true' ) {
                                Write-Entry -Subtext "Already exists: $backgroundImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                            }
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
                    if ($null -ne $entry.OtherMediaServerSeasonUrls) { $global:OtherMediaServerSeasonUrls = $entry.OtherMediaServerSeasonUrls.Split(",") } else { $global:OtherMediaServerSeasonUrls = @() }
                    for ($i = 0; $i -lt $global:seasonNames.Count; $i++) {
                        $SkippingText = 'false'
                        $Seasonpostersearchtext = $null
                        $global:seasontmp = $null
                        $global:TextlessPoster = $null
                        $global:tmdbsearched = $null
                        $global:posterurl = $null
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
                        $TakeLocal = $null
                        $LocalAssetMissing = $null
                        $LocalAddOverlay = $AddSeasonOverlay
                        $LocalAddBorder = $AddSeasonBorder
                        if ($SeasonfontAllCaps -eq 'true') {
                            if ($OverrideSeasonName -eq 'true') {
                                if ($global:seasonNumbers[$i] -eq '0') {
                                    $global:seasonTitle = $SpecialSeasonOverrideText.ToUpper()
                                }
                                Else {
                                    $global:seasonTitle = $SeasonOverrideText.ToUpper() + " " + $global:seasonNumbers[$i]
                                }
                            }
                            Else {
                                $global:seasonTitle = $global:seasonNames[$i].ToUpper()
                            }
                        }
                        Else {
                            if ($OverrideSeasonName -eq 'true') {
                                if ($global:seasonNumbers[$i] -eq '0') {
                                    $global:seasonTitle = $SpecialSeasonOverrideText
                                }
                                Else {
                                    $global:seasonTitle = $SeasonOverrideText + " " + $global:seasonNumbers[$i]
                                }
                            }
                            Else {
                                $global:seasonTitle = $global:seasonNames[$i]
                            }
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
                            $ManualTestPath = $ManualEntryDir
                            $Testfile = "$global:seasontmp"
                            $TestfileTemplate = "SeasonTemplate"
                        }
                        Else {
                            if ($entry.extraFolder) {
                                $SeasonImageoriginal = "$AssetPath\$($entry.extraFolder)\$($entry.RootFoldername)_$global:seasontmp.jpg"
                            }
                            Else {
                                $SeasonImageoriginal = "$AssetPath\$($entry.RootFoldername)_$global:seasontmp.jpg"
                            }
                            $TestPath = $AssetPath
                            $ManualTestPath = $ManualPath
                            $Testfile = "$($entry.RootFoldername)_$global:seasontmp"
                            $TestfileTemplate = "$($entry.RootFoldername)_SeasonTemplate"
                        }

                        if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                            $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                            $SeasonImageoriginal = ($SeasonImageoriginal).Replace('\', '/').Replace('./', '/')
                            $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                            $Templatetestpath = ($ManualEntryDir + "/" + $TestfileTemplate).Replace('\', '/').Replace('./', '/')
                        }
                        else {
                            $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                            $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                            if ($fullTestPath) {
                                $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                                $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                                $Templatetestpath = ($fullManualTestPath.ProviderPath + "\" + $TestfileTemplate).Replace('/', '\')
                            }
                            Else {
                                $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                                $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                                $Templatetestpath = ($ManualEntryDir + "\" + $TestfileTemplate).Replace('/', '\')
                            }
                        }

                        Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Message "Manual Test Path is: $ManualTestPath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Message "Resolved Manual Test Path is: $Manualtestpath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Message "Resolved Manual Full Test Path is: $fullManualTestPath" -Path $global:configLogging -Color Cyan -log Debug

                        $SeasonImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($entry.ratingKey)_$($entry.RootFoldername)_$global:seasontmp.jpg"
                        $SeasonImage = $SeasonImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                        $checkedItems.Add($hashtestpath)

                        if (-not $directoryHashtable.ContainsKey("$hashtestpath")) {
                            $Arturl = $null
                            if ($global:PlexSeasonUrl -like "/library/*") {
                                $Arturl = $plexurl + $global:PlexSeasonUrl
                            }
                            elseif ($global:OtherMediaServerSeasonUrls.Count -gt $i -and $global:OtherMediaServerSeasonUrls[$i]) {
                                $Arturl = $global:OtherMediaServerSeasonUrls[$i]
                            }
                            foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                                $manualFile = "$ManualTestPath$ext"
                                $templateFile = "$Templatetestpath$ext"
                                $filePath = $null

                                if (Test-Path -LiteralPath $manualFile) {
                                    $filePath = $manualFile
                                }
                                elseif (Test-Path -LiteralPath $templateFile) {
                                    $filePath = $templateFile
                                }

                                if ($filePath) {
                                    Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                    $posterext = $ext
                                    break
                                }
                            }
                            if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                                Write-Entry -Message "Found Manual Season Poster for: $Titletext" -Path $global:configLogging -Color White -log Info
                                $TakeLocal = $true
                            }
                            elseif ((Test-Path -LiteralPath "$($Templatetestpath)$posterext") -and $Templatetestpath -ne '\') {
                                Write-Entry -Message "Found Template Poster..." -Path $global:configLogging -Color White -log Info
                                $ManualTestPath = $Templatetestpath
                                $TakeLocal = $true
                            }
                            Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlinePosterFetch -eq 'true') {
                                $LocalAssetMissing = 'true'
                            }
                            Else {
                                if (!$Seasonpostersearchtext) {
                                    # [Posterizarr TextlessFallback] Pre-check logo availability to revert to text poster if needed.
                                    $tempLogoAvailable = $false
                                    if ($TextlessPosterBypass -eq 'true' -and $UseLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                        $tempLogoUrl = $null
                                        $searchOrder = @($global:FavProvider) + (@('TMDB', 'FANART', 'TVDB') -ne $global:FavProvider)
                                        foreach ($provider in $searchOrder) {
                                            if (-not [string]::IsNullOrEmpty($tempLogoUrl)) { break }
                                            switch ($provider) {
                                                'TMDB' { if ($entry.tmdbid) { $tempLogoUrl = GetTMDBLogo -Type tv } }
                                                'FANART' { $t = if('tv' -eq 'movie') {'movies'} else {'tv'}; $tempLogoUrl = GetFanartLogo -Type $t }
                                                'TVDB' { if ($entry.tvdbid) { $t = if('tv' -eq 'movie') {'movies'} else {'series'}; $tempLogoUrl = GetTVDBLogo -Type $t } }
                                            }
                                        }
                                        if ($tempLogoUrl) { $tempLogoAvailable = $true }
                                        
                                        if (-not $tempLogoAvailable) {
                                            Write-Entry -Message "TextlessFallback (textposter): No logo available. Forcing standard Text Asset." -Path $global:configLogging -Color Cyan -log Info
                                            $global:OriginalPreferTextless = $global:SeasonPosterPreferTextless
                                            $global:OriginalOnlyTextless = $global:SeasonPosterOnlyTextless
                                            $global:OriginalPreferredSeasonLanguageOrder = $global:PreferredSeasonLanguageOrder
                                            $tempOrder = @($global:PreferredSeasonLanguageOrder | Where-Object { $_ -ne 'xx' })
                                            if (-not $tempOrder) { $tempOrder = @('en') }
                                            $global:PreferredSeasonLanguageOrder = $tempOrder
                                            Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $tempOrder
                                            $global:SeasonPosterPreferTextless = $false
                                            $global:SeasonPosterOnlyTextless = $false
                                            $global:ForceTextAssetRestoration = '$global:SeasonPosterPreferTextless'
                                        }
                                    }
                                    Write-Entry -Message "Start Season Poster Search for: $Titletext | $global:seasonTitle" -Path $global:configLogging -Color White -log Info
                                if ($global:OverrideProviderOrder) {
                                    $global:LoopFallbackPosterUrl = $null
                                    foreach ($provider in $global:ProviderOrder) {
                                        if ($global:posterurl -or $global:PlexartworkDownloaded) { break }
                                        switch -Wildcard ($provider) {
                                            'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBSeasonPoster } }
                                            'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBSeasonPoster } }
                                            'FANART' { $global:posterurl = GetFanartSeasonPoster }
                                            'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Season Poster' -ArtUrl $Arturl -TempImage $SeasonImage } }
                                        }

                                        if ($global:posterurl -and $global:SeasonPreferTextless -eq $true -and !$global:TextlessPoster) {
                                            if (!$global:LoopFallbackPosterUrl) { $global:LoopFallbackPosterUrl = $global:posterurl }
                                            $global:posterurl = $null
                                            $global:IsFallback = $true
                                        }

                                        if ($global:posterurl -or $global:PlexartworkDownloaded) {
                                            Write-Entry -Subtext "Took image from custom provider loop: $provider" -Path $global:configLogging -Color Cyan -log Info
                                            if ($provider -ne $global:ProviderOrder[0]) {
                                                $global:IsFallback = $true
                                            }
                                        }
                                    }
                                    if (!$global:posterurl -and $global:LoopFallbackPosterUrl -and $global:SeasonOnlyTextless -ne $true) {
                                        $global:posterurl = $global:LoopFallbackPosterUrl
                                        Write-Entry -Subtext "Took fallback image with text from custom provider loop because no textless poster was found." -Path $global:configLogging -Color Cyan -log Info
                                    }
                                }
                                Else {
                                    $Seasonpostersearchtext = $true
                                }
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBSeasonPoster }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning } }
                                    'FANART' { $global:posterurl = GetFanartSeasonPoster }
                                    'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBSeasonPoster }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning } }
                                    'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Season Poster' -ArtUrl $Arturl -TempImage $SeasonImage } }
                                    Default { $global:posterurl = GetFanartSeasonPoster }
                                }
                                # do a specific order
                                if ($global:SeasonPreferTextless -eq $true) {
                                    if (!$global:posterurl -or !$global:TextlessPoster) {
                                        if (!$entry.tmdbid -and $global:FavProvider -ne 'TMDB') {
                                            Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if (!$entry.tvdbid -and $global:FavProvider -ne 'TVDB') {
                                            Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if ($global:FavProvider -ne 'TMDB' -and $entry.tmdbid) {
                                            $global:posterurl = GetTMDBSeasonPoster
                                            $global:IsFallback = $true
                                            Write-Entry -Subtext "Function GetTMDBSeasonPoster called..." -Path $global:configLogging -Color Cyan -log Debug
                                        }
                                        if (!$global:posterurl -or !$global:TextlessPoster) {
                                            if ($global:FavProvider -ne 'FANART') {
                                                $global:posterurl = GetFanartSeasonPoster
                                                Write-Entry -Subtext "Function GetFanartSeasonPoster called..." -Path $global:configLogging -Color Cyan -log Debug
                                                if ($global:posterurl) {
                                                    $global:IsFallback = $true
                                                }
                                                Write-Entry -Subtext "IsFallback: $global:IsFallback" -Path $global:configLogging -Color Cyan -log Debug
                                            }
                                        }
                                        if ((!$global:posterurl -or !$global:TextlessPoster) -and $entry.tvdbid) {
                                            if ($global:FavProvider -ne 'TVDB') {
                                                $global:posterurl = GetTVDBSeasonPoster
                                                if ($global:posterurl) {
                                                    $global:IsFallback = $true
                                                }
                                                Write-Entry -Subtext "Function GetTVDBSeasonPoster called..." -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "IsFallback: $global:IsFallback" -Path $global:configLogging -Color Cyan -log Debug
                                            }
                                        }
                                    }
                                    if (!$global:posterurl) {
                                        Write-Entry -Subtext "Could not find a season poster on any site" -Path $global:configLogging -Color Red -log Error
                                    }
                                    if (!$global:TextlessPoster -and $ShowFallback -eq 'true') {
                                        # Lets just try to grab a show poster.
                                        Write-Entry -Subtext "Fallback to Show Poster..." -Path $global:configLogging -Color DarkMagenta -log Info
                                        switch -Wildcard ($global:FavProvider) {
                                            'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowPoster }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowPoster } }
                                            'FANART' { $global:posterurl = GetFanartShowPoster }
                                            'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBShowPoster }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowPoster } }
                                            'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Show Poster' -ArtUrl $Arturl -TempImage $PosterImage } }
                                            Default { $global:posterurl = GetFanartShowPoster }
                                        }
                                        if ($global:posterurl) {
                                            Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                            $global:IsFallback = $true
                                            $global:FallbackText = 'True-Show'
                                        }
                                        Else {
                                            if ($global:FavProvider -ne 'TMDB') {
                                                $global:posterurl = GetTMDBShowPoster
                                                if ($global:posterurl) {
                                                    Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                    $global:IsFallback = $true
                                                    $global:FallbackText = 'True-Show'
                                                }
                                            }
                                            if ($global:FavProvider -ne 'TVDB' -and !$global:posterurl) {
                                                $global:posterurl = GetTVDBShowPoster
                                                if ($global:posterurl) {
                                                    Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                    $global:IsFallback = $true
                                                    $global:FallbackText = 'True-Show'
                                                }
                                            }
                                            if ($global:FavProvider -ne 'FANART' -and !$global:posterurl) {
                                                $global:posterurl = GetFanartShowPoster
                                                if ($global:posterurl) {
                                                    Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                    $global:IsFallback = $true
                                                    $global:FallbackText = 'True-Show'
                                                }
                                            }
                                        }
                                    }
                                }
                                Else {
                                    if (!$global:posterurl) {
                                        if ($global:FavProvider -ne 'TMDB' -and $entry.tmdbid) {
                                            $global:posterurl = GetTMDBSeasonPoster
                                            if ($global:posterurl) {
                                                $global:IsFallback = $true
                                            }
                                            Write-Entry -Subtext "Function GetTMDBSeasonPoster called..." -Path $global:configLogging -Color Cyan -log Debug
                                        }
                                        if (!$global:posterurl) {
                                            if ($global:FavProvider -ne 'FANART') {
                                                $global:posterurl = GetFanartSeasonPoster
                                                Write-Entry -Subtext "Function GetFanartSeasonPoster called..." -Path $global:configLogging -Color Cyan -log Debug
                                                if ($global:posterurl) {
                                                    $global:IsFallback = $true
                                                }
                                                Write-Entry -Subtext "IsFallback: $global:IsFallback" -Path $global:configLogging -Color Cyan -log Debug
                                            }
                                        }
                                        if (!$global:posterurl -and $entry.tvdbid) {
                                            if ($global:FavProvider -ne 'TVDB') {
                                                $global:posterurl = GetTVDBSeasonPoster
                                                if ($global:posterurl) {
                                                    $global:IsFallback = $true
                                                }
                                                Write-Entry -Subtext "Function GetTVDBSeasonPoster called..." -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "IsFallback: $global:IsFallback" -Path $global:configLogging -Color Cyan -log Debug
                                            }
                                        }
                                        if ($ArtUrl) {
                                            if ($global:FavProvider -ne 'PLEX') {
                                                GetPlexArtwork -Type ' a Season Poster' -ArtUrl $Arturl -TempImage $SeasonImage
                                                if ($global:posterurl) {
                                                    $global:IsFallback = $true
                                                }
                                                Write-Entry -Subtext "Function GetPlexArtwork called..." -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "IsFallback: $global:IsFallback" -Path $global:configLogging -Color Cyan -log Debug
                                            }
                                        }
                                        Else {
                                            Write-Entry -Subtext "Plex Season Poster Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                    }
                                    if (!$global:posterurl) {
                                        Write-Entry -Subtext "Could not find a season poster on any site" -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                                if (!$global:posterurl -and $ShowFallback -eq 'true') {
                                    # Lets just try to grab a show poster.
                                    Write-Entry -Subtext "Fallback to Show Poster..." -Path $global:configLogging -Color DarkMagenta -log Info
                                    switch -Wildcard ($global:FavProvider) {
                                        'TMDB' { if ($entry.tmdbid) { $global:posterurl = GetTMDBShowPoster }Else { Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowPoster } }
                                        'FANART' { $global:posterurl = GetFanartShowPoster }
                                        'TVDB' { if ($entry.tvdbid) { $global:posterurl = GetTVDBShowPoster }Else { Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning; $global:posterurl = GetFanartShowPoster } }
                                        'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ' a Show Poster' -ArtUrl $Arturl -TempImage $PosterImage } }
                                        Default { $global:posterurl = GetFanartShowPoster }
                                    }
                                    if ($global:posterurl) {
                                        Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                        $global:IsFallback = $true
                                        $global:FallbackText = 'True-Show'
                                    }
                                    Else {
                                        if ($global:FavProvider -ne 'TMDB') {
                                            $global:posterurl = GetTMDBShowPoster
                                            if ($global:posterurl) {
                                                Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                                $global:FallbackText = 'True-Show'
                                            }
                                        }
                                        if ($global:FavProvider -ne 'TVDB' -and !$global:posterurl) {
                                            $global:posterurl = GetTVDBShowPoster
                                            if ($global:posterurl) {
                                                Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                                $global:FallbackText = 'True-Show'
                                            }
                                        }
                                        if ($global:FavProvider -ne 'FANART' -and !$global:posterurl) {
                                            $global:posterurl = GetFanartShowPoster
                                            if ($global:posterurl) {
                                                Write-Entry -Subtext "Using the Show Poster as Season Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                                $global:FallbackText = 'True-Show'
                                            }
                                        }
                                    }
                                }
                                if ($global:TMDBSeasonFallback -and $global:PosterWithText -and $global:FavProvider -eq 'TMDB') {
                                    $global:posterurl = $global:TMDBSeasonFallback
                                    Write-Entry -Subtext "Taking Season Poster with text as fallback from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    $global:IsFallback = $true
                                }
                                if ($global:FANARTSeasonFallback -and $global:PosterWithText -and $global:FavProvider -eq 'FANART') {
                                    $global:posterurl = $global:FANARTSeasonFallback
                                    Write-Entry -Subtext "Taking Season Poster with text as fallback from 'FANART'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    $global:IsFallback = $true
                                }
                                if ($global:TVDBSeasonFallback -and $global:PosterWithText -and $global:FavProvider -eq 'TVDB') {
                                    $global:posterurl = $global:TVDBSeasonFallback
                                    Write-Entry -Subtext "Taking Season Poster with text as fallback from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                    $global:IsFallback = $true
                                }

                            }
                                }
                            if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                                $global:IsTruncated = $null
                                if ($global:ForceTextAssetRestoration -ne $null) {
                                    if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                        $global:PosterPreferTextless = $global:OriginalPreferTextless
                                        $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                            $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                            $global:OriginalPreferredLanguageOrder = $null
                                        }
                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                        $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                        $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                            $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                            $global:OriginalPreferredBackgroundLanguageOrder = $null
                                        }
                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                        $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                        $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                        if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                            $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                            Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                            $global:OriginalPreferredSeasonLanguageOrder = $null
                                        }
                                    }
                                    $global:ForceTextAssetRestoration = $null
                                }
                                if ($global:ImageProcessing -eq 'true') {
                                    if ($TakeLocal) {
                                        Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                            Copy-Item -LiteralPath $_.FullName -Destination $SeasonImage
                                        }
                                        if ($SkipLocalSeasonTextAdd -eq 'true') {
                                            $SkippingText = 'true'
                                        }
                                        Write-Entry -Subtext "Copy local asset to: $SeasonImage" -Path $global:configLogging -Color Green -log Info
                                    }
                                    Else {
                                        try {
                                            if (!$global:PlexartworkDownloaded) {
                                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $SeasonImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                            }
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
                                        Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                        if ($global:posterurl -like 'https://image.tmdb.org*') {
                                            Write-Entry -Subtext "Downloading Poster from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                            if ($global:FavProvider -ne 'TMDB') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        elseif ($global:posterurl -like 'https://assets.fanart.tv*') {
                                            Write-Entry -Subtext "Downloading Poster from 'Fanart.tv'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:FANARTAssetTextLang
                                            if ($global:FavProvider -ne 'FANART') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        elseif ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                            Write-Entry -Subtext "Downloading Poster from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                            if ($global:FavProvider -ne 'TVDB') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        elseif ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                            Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            if ($global:FavProvider -ne 'PLEX') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Poster from 'IMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $PosterUnknownCount++
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if (Get-ChildItem -LiteralPath $SeasonImage -ErrorAction SilentlyContinue) {
                                        $CommentArguments = "`"$SeasonImage`" -set `"comment`" `"created with posterizarr`" `"$SeasonImage`""
                                        $CommentlogEntry = "`"$magick`" $CommentArguments"
                                        $CommentlogEntry | Write-MagickLog
                                        InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                        if ($global:ImageMagickError -ne 'true') {
                                            $settings = Get-OverlayAndBorderSettings -AddBorder $LocalAddBorder -AddOverlay $LocalAddOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                                            $LocalAddBorder = $settings.Border
                                            $LocalAddOverlay = $settings.Overlay
                                            # Resize Image to 2000x3000 and apply Border and overlay
                                            if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                                $Arguments = "`"$SeasonImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Seasonoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$Seasonborderwidthsecond`"  -bordercolor `"$Seasonbordercolor`" -border `"$Seasonborderwidth`" `"$SeasonImage`""
                                                Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                            }
                                            elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                                $Arguments = "`"$SeasonImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" -shave `"$Seasonborderwidthsecond`"  -bordercolor `"$Seasonbordercolor`" -border `"$Seasonborderwidth`" `"$SeasonImage`""
                                                Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                            }
                                            elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                                $Arguments = "`"$SeasonImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Seasonoverlay`" -gravity south -quality $global:outputQuality -composite `"$SeasonImage`""
                                                Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                            }
                                            else {
                                                $Arguments = "`"$SeasonImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$SeasonImage`""
                                                Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                            }

                                            $logEntry = "`"$magick`" $Arguments"
                                            $logEntry | Write-MagickLog
                                            InvokeMagickCommand -Command $magick -Arguments $Arguments
                                            $SkippingText = Get-SkipTextSetting -SkipAddText $SkipAddText -SkipAddTextAndOverlay $SkipAddTextAndOverlay -PosterWithText $global:PosterWithText
                                            if ($SkippingText -eq 'true') {
                                                Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                            }
                                            if ($AddSeasonText -eq 'true' -and $SkippingText -eq 'false') {
                                                $global:seasonTitle = $global:seasonTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                if ($ShowOnSeasonfontAllCaps -eq 'true') {
                                                    $global:ShowTitleOnSeason = $titletext.ToUpper() -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                }
                                                Else {
                                                    $global:ShowTitleOnSeason = $titletext -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                }
                                                # Loop through each symbol and replace it with a newline
                                                if ($NewLineOnSpecificSymbols -eq 'true') {
                                                    foreach ($symbol in $NewLineSymbols) {
                                                        # Replace the symbol with a newline
                                                        $replacementString = "`n"

                                                        # Check if the symbol should be kept
                                                        $keepThisSymbol = $false
                                                        if ($null -ne $SymbolsToKeepOnNewLine) {
                                                            # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                            foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                if ($symbol -like "*$k*") {
                                                                    $keepThisSymbol = $true
                                                                    break # Match found, no need to keep checking
                                                                }
                                                            }
                                                        }

                                                        # If it's a "keep" symbol, change the replacement string
                                                        if ($keepThisSymbol) {
                                                            # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                            $replacementString = $symbol + "`n"
                                                        }
                                                        $global:seasonTitle = $global:seasonTitle -replace [regex]::Escape($symbol), $replacementString
                                                        if ($AddShowTitletoSeason -eq 'true') {
                                                            $global:ShowTitleOnSeason = $global:ShowTitleOnSeason -replace [regex]::Escape($symbol), $replacementString
                                                        }
                                                    }
                                                }
                                                if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                    $properties = $NewLineWords.PSObject.Properties.Name

                                                    # Check if properties exist and the list is not empty
                                                    if ($null -ne $properties -and $properties.Count -gt 0) {
                                                        foreach ($wordKey in $properties) {
                                                            $replacementValue = $NewLineWords.$wordKey

                                                            # Using [regex]::Escape handles any special characters in the word keys
                                                            $global:seasonTitle = $global:seasonTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                            if ($AddShowTitletoSeason -eq 'true') {
                                                                $global:ShowTitleOnSeason = $global:ShowTitleOnSeason -replace [regex]::Escape($wordKey), $replacementValue
                                                            }
                                                        }
                                                    }
                                                }
                                                $joinedTitlePointSize = $global:seasonTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                $joinedShowTitlePointSize = $global:ShowTitleOnSeason -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                if ($AddShowTitletoSeason -eq 'true') {
                                                    $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $fontImagemagick -box_width $SeasonMaxWidth  -box_height $SeasonMaxHeight -min_pointsize $SeasonminPointSize -max_pointsize $SeasonmaxPointSize -lineSpacing $SeasonlineSpacing
                                                    $ShowoptimalFontSize = Get-OptimalPointSize -text $joinedShowTitlePointSize -font $fontImagemagick -box_width $ShowOnSeasonMaxWidth  -box_height $ShowOnSeasonMaxHeight -min_pointsize $ShowOnSeasonminPointSize -max_pointsize $ShowOnSeasonmaxPointSize -lineSpacing $ShowOnSeasonlineSpacing

                                                    if ($global:IsTruncated -ne $true) {
                                                        Write-Entry -Subtext ("Optimal Season font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                        Write-Entry -Subtext ("Optimal Show font size set to: '{0}' [{1}]" -f $showoptimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info

                                                        # Season Text Part
                                                        $cleanTitle = $global:seasonTitle -replace 'Â³', '' -replace 'Â²', ''
                                                        $supChar = if ($global:seasonTitle -match 'Â³') { "3" } elseif ($global:seasonTitle -match 'Â²') { "2" } else { "" }

                                                        $superSize = [int]($optimalFontSize * 0.55)
                                                        $yNudge = [int]($optimalFontSize * 0.3)
                                                        $gap = 20

                                                        if ($supChar -ne "" -and $AddSeasonTextStroke -eq 'true') {
                                                            $SeasonArguments = "`"$SeasonImage`" ( -background none " +
                                                            "( ( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$Seasonstrokecolor`" -stroke `"$Seasonstrokecolor`" -strokewidth `"$Seasonstrokewidth`" label:`"$cleanTitle`" ) " +
                                                            "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$Seasonstrokecolor`" -stroke `"$Seasonstrokecolor`" -strokewidth `"$Seasonstrokewidth`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                            "( ( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$Seasonfontcolor`" -stroke none label:`"$cleanTitle`" ) " +
                                                            "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$Seasonfontcolor`" -stroke none label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap ) " +
                                                            "-gravity center -composite ) -gravity south -geometry +0`"$Seasontext_offset`" -composite `"$SeasonImage`""
                                                        }
                                                        elseif ($supChar -ne "") {
                                                            $SeasonArguments = "`"$SeasonImage`" ( -background none " +
                                                            "( -font `"$fontImagemagick`" -pointsize $optimalFontSize -fill `"$Seasonfontcolor`" label:`"$cleanTitle`" ) " +
                                                            "( -font `"$fontImagemagick`" -pointsize $superSize -fill `"$Seasonfontcolor`" label:`"$supChar`" -repage +0-$yNudge ) +smush +$gap " +
                                                            ") -gravity south -geometry +0`"$Seasontext_offset`" -composite `"$SeasonImage`""
                                                        }
                                                        else {
                                                            if ($AddSeasonTextStroke -eq 'true') {
                                                                $SeasonArguments = "`"$SeasonImage`" -gravity center -background None -layers Flatten `( -size `"$Seasonboxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonstrokecolor`" -stroke `"$Seasonstrokecolor`" -strokewidth `"$Seasonstrokewidth`" -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$global:seasonTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonfontcolor`" -stroke none -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$global:seasonTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Seasonboxsize`" `) -gravity south -geometry +0`"$Seasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                            }
                                                            Else {
                                                                $SeasonArguments = "`"$SeasonImage`" -gravity center -background None -layers Flatten `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonfontcolor`" -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$global:seasonTitle`" -trim +repage -extent `"$Seasonboxsize`" `) -gravity south -geometry +0`"$Seasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                            }
                                                        }

                                                        Write-Entry -Subtext "Applying seasonTitle text: `"$global:seasonTitle`"" -Path $global:configLogging -Color White -log Info
                                                        $logEntry = "`"$magick`" $SeasonArguments"
                                                        $logEntry | Write-MagickLog
                                                        InvokeMagickCommand -Command $magick -Arguments $SeasonArguments

                                                        # Show Part (Logo vs Text)
                                                        $ApplyTextInsteadOfLogo = $null

                                                        if ($UseLogo -eq 'true' -and ($global:UseClearlogo -eq 'true' -or $global:UseClearart -eq 'true')) {
                                                            $global:LogoUrl = $null
                                                            $global:LogoLanguage = $null
                                                            $allProviders = @('TMDB', 'FANART', 'TVDB')
                                                            $searchOrder = @($global:FavProvider) + ($allProviders -ne $global:FavProvider)

                                                            foreach ($provider in $searchOrder) {
                                                                if (-not [string]::IsNullOrEmpty($global:LogoUrl)) { break }
                                                                switch ($provider) {
                                                                    'TMDB' { if ($entry.tmdbid) { $global:LogoUrl = GetTMDBLogo -Type tv } }
                                                                    'FANART' { $global:LogoUrl = GetFanartLogo -Type tv }
                                                                    'TVDB' { if ($entry.tvdbid) { $global:LogoUrl = GetTVDBLogo -Type series } }
                                                                }
                                                            }

                                                            if (-not [string]::IsNullOrEmpty($global:LogoUrl)) {
                                                                $global:IsFallback = $false
                                                                switch ($global:FavProvider) {
                                                                    'TMDB' { if (-not ($global:LogoUrl.StartsWith("https://image.tmdb.org"))) { $global:IsFallback = $true } }
                                                                    'TVDB' { if (-not ($global:LogoUrl.StartsWith("https://artworks.thetvdb.com"))) { $global:IsFallback = $true } }
                                                                    'FANART' { if (-not ($global:LogoUrl.StartsWith("https://assets.fanart.tv"))) { $global:IsFallback = $true } }
                                                                }
                                                                if ($global:IsFallback) {
                                                                    Write-Entry -Subtext "Logo Source: Fallback (URL did not match $global:FavProvider)" -Path $global:configLogging -Color Yellow -log Debug
                                                                }
                                                            }

                                                            if ([string]::IsNullOrEmpty($global:LogoUrl)) {
                                                                Write-Entry -Subtext "Could not find a logo on any provider (Tried: $($searchOrder -join ', '))" -Path $global:configLogging -Color Yellow -log Warning
                                                            }

                                                            if (!$global:LogoUrl -and $TextFallback -eq 'true') {
                                                                $ApplyTextInsteadOfLogo = 'true'
                                                                Write-Entry -Subtext "Falling back to text as no logo was found." -Path $global:configLogging -Color Yellow -log Warning
                                                                $global:IsFallback = $true
                                                            }
                                                            ElseIf ($global:LogoUrl) {
                                                                $urlExtension = [System.IO.Path]::GetExtension($global:LogoUrl).Split('?')[0]
                                                                if ([string]::IsNullOrWhiteSpace($urlExtension)) { $urlExtension = ".png" }
                                                                                                                                $LogoImage = Join-Path $TempPath ("$($entry.RootFoldername)_logo" + $urlExtension); Write-Entry -Message "Logo Used: $global:LogoUrl" -Path $global:configLogging -Color Cyan -log Debug

                                                                try {
                                                                    $response = Invoke-WebRequest -Uri $global:LogoUrl -OutFile $LogoImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
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

                                                                $colorEffect = ""
                                                                if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                                                                    $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }
                                                                    $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                                                                    if ([double]$_chromaStd -lt 0.25) {
                                                                        $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"
                                                                        Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info
                                                                    }
                                                                    else {
                                                                        $colorEffect = ""
                                                                        Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info
                                                                    }
                                                                }

                                                                if ($urlExtension -match "(?i)\.svg") {
                                                                    Write-Entry -Subtext "Detected SVG. Applying High-Res settings for Season Show Logo." -Path $global:configLogging -Color Cyan -log Info
                                                                    $ShowOnSeasonArguments = "`"$SeasonImage`" ( -background none -density 300 `"$LogoImage`" $colorEffect -resize `"$ShowOnSeasonboxsize`" `) -gravity `"$ShowOnSeasontextgravity`" -geometry +0+`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                                }
                                                                else {
                                                                    $ShowOnSeasonArguments = "`"$SeasonImage`" ( -background none `"$LogoImage`" $colorEffect -resize `"$ShowOnSeasonboxsize`" `) -gravity `"$ShowOnSeasontextgravity`" -geometry +0+`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                                }

                                                                Write-Entry -Subtext "Applying Show Logo to Season..." -Path $global:configLogging -Color White -log Info
                                                                $logEntry = "`"$magick`" $ShowOnSeasonArguments"
                                                                $logEntry | Write-MagickLog
                                                                InvokeMagickCommand -Command $magick -Arguments $ShowOnSeasonArguments

                                                                Remove-Item -LiteralPath $LogoImage -Force -ErrorAction SilentlyContinue | out-null
                                                            }
                                                        }

                                                        # Fallback Text Logic
                                                        if ($ApplyTextInsteadOfLogo -eq 'true' -or $UseLogo -eq 'false') {
                                                            if ($AddShowOnSeasonTextStroke -eq 'true') {
                                                                $ShowOnSeasonArguments = "`"$SeasonImage`" -gravity center -background None -layers Flatten `( -size `"$ShowOnSeasonboxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$ShowoptimalFontSize`" -fill `"$ShowOnSeasonstrokecolor`" -stroke `"$ShowOnSeasonstrokecolor`" -strokewidth `"$ShowOnSeasonstrokewidth`" -size `"$ShowOnSeasonboxsize`" -background none -interline-spacing `"$ShowOnSeasonlineSpacing`" -gravity `"$ShowOnSeasontextgravity`" caption:`"$global:ShowTitleOnSeason`" `) `( -font `"$fontImagemagick`" -pointsize `"$ShowoptimalFontSize`" -fill `"$ShowOnSeasonfontcolor`" -stroke none -size `"$ShowOnSeasonboxsize`" -background none -interline-spacing `"$ShowOnSeasonlineSpacing`" -gravity `"$ShowOnSeasontextgravity`" caption:`"$global:ShowTitleOnSeason`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$ShowOnSeasonboxsize`" `) -gravity south -geometry +0`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                            }
                                                            Else {
                                                                $ShowOnSeasonArguments = "`"$SeasonImage`" -gravity center -background None -layers Flatten `( -font `"$fontImagemagick`" -pointsize `"$ShowoptimalFontSize`" -fill `"$ShowOnSeasonfontcolor`" -size `"$ShowOnSeasonboxsize`" -background none -interline-spacing `"$ShowOnSeasonlineSpacing`" -gravity `"$ShowOnSeasontextgravity`" caption:`"$global:ShowTitleOnSeason`" -trim +repage -extent `"$ShowOnSeasonboxsize`" `) -gravity south -geometry +0`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                            }

                                                            Write-Entry -Subtext "Applying showTitle text: `"$global:ShowTitleOnSeason`"" -Path $global:configLogging -Color White -log Info
                                                            $logEntry = "`"$magick`" $ShowOnSeasonArguments"
                                                            $logEntry | Write-MagickLog
                                                            InvokeMagickCommand -Command $magick -Arguments $ShowOnSeasonArguments
                                                        }
                                                    }
                                                }
                                                Else {
                                                    $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $fontImagemagick -box_width $SeasonMaxWidth  -box_height $SeasonMaxHeight -min_pointsize $SeasonminPointSize -max_pointsize $SeasonmaxPointSize -lineSpacing $SeasonlineSpacing
                                                    if ($global:IsTruncated -ne $true) {
                                                        Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                        # Add Stroke
                                                        if ($AddSeasonTextStroke -eq 'true') {
                                                            $Arguments = "`"$SeasonImage`" -gravity center -background None -layers Flatten `( -size `"$Seasonboxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonstrokecolor`" -stroke `"$Seasonstrokecolor`" -strokewidth `"$Seasonstrokewidth`" -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$global:seasonTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonfontcolor`" -stroke none -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$global:seasonTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Seasonboxsize`" `) -gravity south -geometry +0`"$Seasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                        }
                                                        Else {
                                                            $Arguments = "`"$SeasonImage`" -gravity center -background None -layers Flatten `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonfontcolor`" -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$global:seasonTitle`" -trim +repage -extent `"$Seasonboxsize`" `) -gravity south -geometry +0`"$Seasontext_offset`" -quality $global:outputQuality -composite `"$SeasonImage`""
                                                        }

                                                        Write-Entry -Subtext "Applying seasonTitle text: `"$global:seasonTitle`"" -Path $global:configLogging -Color White -log Info
                                                        $logEntry = "`"$magick`" $Arguments"
                                                        $logEntry | Write-MagickLog
                                                        InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Else {
                                    if ($TakeLocal) {
                                        Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                            Copy-Item -LiteralPath $_.FullName -Destination $SeasonImage
                                        }
                                        if ($SkipLocalSeasonTextAdd -eq 'true') {
                                            $SkippingText = 'true'
                                        }
                                        Write-Entry -Subtext "Copy local asset to: $SeasonImage" -Path $global:configLogging -Color Green -log Info
                                    }
                                    Else {
                                        try {
                                            if (!$global:PlexartworkDownloaded) {
                                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $SeasonImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                            }
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
                                        Write-Entry -Subtext "Poster url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                        if ($global:posterurl -like 'https://image.tmdb.org*') {
                                            Write-Entry -Subtext "Downloading Poster from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                            if ($global:FavProvider -ne 'TMDB') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        elseif ($global:posterurl -like 'https://assets.fanart.tv*') {
                                            Write-Entry -Subtext "Downloading Poster from 'Fanart.tv'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:FANARTAssetTextLang
                                            $PosterUnknownCount++
                                            if ($global:FavProvider -ne 'FANART') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        elseif ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                            Write-Entry -Subtext "Downloading Poster from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                            if ($global:FavProvider -ne 'TVDB') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        elseif ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                            Write-Entry -Subtext "Downloading Poster from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            if ($global:FavProvider -ne 'PLEX') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        Else {
                                            Write-Entry -Subtext "Downloading Poster from 'IMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $PosterUnknownCount++
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if (Get-ChildItem -LiteralPath $SeasonImage -ErrorAction SilentlyContinue) {
                                        # Resize Image to 2000x3000
                                        $Resizeargument = "`"$SeasonImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$SeasonImage`""
                                        Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                        $logEntry = "`"$magick`" $Resizeargument"
                                        $logEntry | Write-MagickLog
                                        InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                                    }
                                }
                                if ($global:ImageMagickError -ne 'true') {
                                    if (Get-ChildItem -LiteralPath $SeasonImage -ErrorAction SilentlyContinue) {
                                        # Move file back to original naming with Brackets.
                                        if ($global:IsTruncated -ne $true) {
                                            if ($UseOtherMediaServer -eq 'true' -and $global:SeasonRatingKey) {
                                                Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($global:SeasonRatingKey)" -Path $global:configLogging -Color Cyan -log Debug
                                                UploadOtherMediaServerArtwork -itemId $global:SeasonRatingKey -imageType "Primary" -imagePath $SeasonImage
                                            }
                                            if ($Upload2Plex -eq 'true') {
                                                try {
                                                    Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                    
                                                    # Verify variables before uploading
                                                    Write-Entry -Subtext "SeasonImage: $SeasonImage" -Path $global:configLogging -Color Cyan -log Debug
                                                    Write-Entry -Subtext "RatingKey: $($global:SeasonRatingKey)" -Path $global:configLogging -Color Cyan -log Debug
                                                    Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                    $uri = "$PlexUrl/library/metadata/$($global:SeasonRatingKey)/posters"
                                                    Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                    # Try uploading, capturing the response in detail
                                                    $Upload = Invoke-WebRequest -Uri $uri `
                                                        -Method Post `
                                                        -Headers $extraPlexHeaders `
                                                        -InFile $SeasonImage `
-ContentType 'image/jpeg' `
                                                        -SkipHttpErrorCheck `
                                                        -ErrorAction Stop

                                                    if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                        Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                        Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                    }
                                                    else {
                                                        Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                        Write-Entry -Subtext "$Titletext | Season Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                        $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                                    }
                                                }
                                                catch {
                                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                                }
                                            }
                                            try {
                                                $SeasonTargetDir = Split-Path -Path $SeasonImageoriginal -Parent
                                                if ($SeasonTargetDir -and -not (Test-Path -LiteralPath $SeasonTargetDir)) {
                                                    New-Item -ItemType Directory -Path $SeasonTargetDir -Force | Out-Null
                                                }
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
                                        Else {
                                            Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        $seasontemp = New-Object psobject
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($Titletext + " | Season " + $global:SeasonNumber)
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Season'
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback) { 'true' } else { 'false' })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $SeasonImage } Else { $global:posterurl })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                        $seasontemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                        switch -Wildcard ($global:FavProvider) {
                                            'TMDB' { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                            'FANART' { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                            'TVDB' { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                            Default { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                        }
                                        # Export the array to a CSV file
                                        $seasontemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                        if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $seasontemp.Type -title $seasontemp.Title -Lib $seasontemp.LibraryName -DLSource $seasontemp.'Download Source' -lang $seasontemp.Language -favurl $seasontemp.'Fav Provider Link' -fallback $seasontemp.Fallback -Truncated $seasontemp.TextTruncated }
                                    }
                                }
                            }
                            Elseif ($LocalAssetMissing -eq 'true') {
                                Write-Entry -Subtext "Skipping [$Titletext] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                            }
                            Else {
                                Write-Entry -Subtext "Missing poster URL for: $($entry.title)" -Path $global:configLogging  -Color Red -log Error
                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                $seasontemp = New-Object psobject
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($Titletext + " | Season " + $global:SeasonNumber)
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Season'
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($entry.RootFoldername)
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($entry.'Library Name')
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($entry.tmdbid) { $entry.tmdbid } Else { "false" })
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($entry.tvdbid) { $entry.tvdbid } Else { "false" })
                                $seasontemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($entry.imdbid) { $entry.imdbid } Else { "false" })
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                    'FANART' { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                    'TVDB' { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                    Default { $seasontemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                }

                                # Export the array to a CSV file
                                $seasontemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $seasontemp.Type -title $seasontemp.Title -Lib $seasontemp.LibraryName -DLSource $seasontemp.'Download Source' -lang $seasontemp.Language -favurl $seasontemp.'Fav Provider Link' -fallback $seasontemp.Fallback -Truncated $seasontemp.TextTruncated }
                            }
                        }
                        else {
                            if ($global:UploadExistingAssets -eq 'true') {
                                if ($global:PlexSeasonUrl -like "/library/*") {
                                    $Arturl = $plexurl + $global:PlexSeasonUrl
                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                    try {
                                        GetPlexArtwork -Type " $Titletext | $global:seasontmp Artwork."  -ArtUrl $Arturl -TempImage $SeasonImage
                                        if ($global:PlexartworkDownloaded -eq 'true') {
                                            Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                            
                                            # Verify variables before uploading
                                            Write-Entry -Subtext "SeasonImage: $SeasonImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                            Write-Entry -Subtext "RatingKey: $($global:SeasonRatingKey)" -Path $global:configLogging -Color Cyan -log Debug
                                            Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                            $uri = "$PlexUrl/library/metadata/$($global:SeasonRatingKey)/posters"
                                            Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                            # Try uploading, capturing the response in detail
                                            $Upload = Invoke-WebRequest -Uri $uri `
                                                -Method Post `
                                                -Headers $extraPlexHeaders `
                                                -InFile $SeasonImageoriginal `
-ContentType 'image/jpeg' `
                                                -SkipHttpErrorCheck `
                                                -ErrorAction Stop
    
                                            if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                            }
                                            else {
                                                Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                Write-Entry -Subtext "$Titletext | Season Poster successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                            }
                                            $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                        }
                                    }
                                    catch {
                                        Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                        $global:errorCount = Increment-GlobalStat 'errorCount'
                                        Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                    }
                                }
                                elseif ($global:seasonId) {
                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                    Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                    UploadOtherMediaServerArtwork -itemId $global:seasonId -imageType "Primary" -imagePath $SeasonImageoriginal
                                }
                                if (Test-Path $SeasonImage -ErrorAction SilentlyContinue) {
                                    Remove-Item -LiteralPath $SeasonImage | Out-Null
                                    Write-Entry -Message "Deleting Temp Image: $SeasonImage" -Path $global:configLogging -Color White -log Info
                                }
                            }
                            Else {
                                if ($show_skipped -eq 'true' ) {
                                    Write-Entry -Subtext "Already exists: $SeasonImageoriginal" -Path $global:configLogging -Color Cyan -log Info
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
function Invoke-TitleCardCreation {
    param (
        $episode
    )
        if ($null -eq $episode) { return }
        Set-LibraryLanguageOverride -LibraryName $episode.'Library Name' -MediaType 'Show'

    try {
        $SkippingText = 'false'
        $global:AssetTextLang = $null
        $global:TMDBAssetTextLang = $null
        $global:FANARTAssetTextLang = $null
        $global:TVDBAssetTextLang = $null
        $global:TMDBAssetChangeUrl = $null
        $global:FANARTAssetChangeUrl = $null
        $global:TVDBAssetChangeUrl = $null
        $global:PosterWithText = $null
        $global:TempImagecopied = $false
        $EpisodeTempImage = $null
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
        $global:EPResolutions = $null
        $global:show_name = $episode."Show Name"
        $global:season_number = $episode."Season Number"
        $global:tmdbid = $episode.tmdbid
        $global:tvdbid = $episode.tvdbid
        if ([string]::IsNullOrWhiteSpace([string]$episode.RootFoldername)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$global:show_name)) {
                $episode | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value ([string]$global:show_name) -Force
            }
            elseif (-not [string]::IsNullOrWhiteSpace([string]$episode.ShowID)) {
                $episode | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value ("show_" + [string]$episode.ShowID) -Force
            }
            else {
                $episode | Add-Member -MemberType NoteProperty -Name "RootFoldername" -Value "unknown_show" -Force
            }
        }
        $LibraryName = $episode.'Library Name'
        if ($LibraryFolders -eq 'true') {
            if ($episode.extraFolder) {
                $EntryDir = "$AssetPath\$LibraryName\$($episode.extraFolder)\$($episode.RootFoldername)"
                $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($episode.extraFolder)\$($episode.RootFoldername)"
            }
            Else {
                $EntryDir = "$AssetPath\$LibraryName\$($episode.RootFoldername)"
                $ManualEntryDir = "$ManualAssetPath\$LibraryName\$($episode.RootFoldername)"
            }
        }
        Else {
            if ($episode.extraFolder) {
                $EntryDir = "$AssetPath\$($episode.extraFolder)\$($episode.RootFoldername)"
                $ManualEntryDir = "$ManualAssetPath\$($episode.extraFolder)\$($episode.RootFoldername)"
            }
            Else {
                $EntryDir = "$AssetPath\$($episode.RootFoldername)"
                $ManualEntryDir = "$ManualAssetPath\$($episode.RootFoldername)"
            }
        }
        if ($null -ne $episode."Resolutions") { $global:EPResolutions = $episode."Resolutions".Split(",") } else { $global:EPResolutions = @() }
        if ($null -ne $episode."Episodes") { $global:episode_numbers = $episode."Episodes".Split(",") } else { $global:episode_numbers = @() }
        if ($null -ne $episode."RatingKeys") { $global:episode_ratingkeys = $episode."RatingKeys".Split(",") } else { $global:episode_ratingkeys = @() }
        if ($null -ne $episode."EpisodeIds") { $global:episode_ids = $episode."EpisodeIds".Split(",") } else { $global:episode_ids = @() }
        if ($null -ne $episode."Title") { $global:titles = $episode."Title".Split(";") } else { $global:titles = @() }
        if ($null -ne $episode."PlexTitleCardUrls") { $global:PlexTitleCardUrls = $episode."PlexTitleCardUrls".Split(",") } else { $global:PlexTitleCardUrls = @() }
        if ($null -ne $episode."OtherMediaServerTitleCardUrls") { $global:OtherMediaServerTitleCardUrls = $episode."OtherMediaServerTitleCardUrls".Split(",") } else { $global:OtherMediaServerTitleCardUrls = @() }
        if ($UseBackgroundAsTitleCard -eq 'true') {
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
                $TakeLocal = $null
                $LocalAssetMissing = $null
                $LocalAddOverlay = $AddTitleCardOverlay
                $LocalAddBorder = $AddTitleCardBorder
                $global:PlexTitleCardUrl = $episode.PlexBackgroundUrl
                if ($global:episode_ratingkeys.Count -gt $i -and $null -ne $global:episode_ratingkeys[$i]) { $global:episode_ratingkey = $($global:episode_ratingkeys[$i].Trim()) } else { $global:episode_ratingkey = $null }
                if ($global:episode_ids.Count -gt $i -and $null -ne $global:episode_ids[$i]) { $global:episodeid = $($global:episode_ids[$i].Trim()) } else { $global:episodeid = $null }
                if ($global:titles.Count -gt $i -and $null -ne $global:titles[$i]) { $global:EPTitle = $($global:titles[$i].Trim()) } else { $global:EPTitle = $null }
                if ($global:EPResolutions.Count -gt $i -and $null -ne $global:EPResolutions[$i]) { $global:EPResolution = $($global:EPResolutions[$i].Trim()) } else { $global:EPResolution = $null }
                if ($global:episode_numbers.Count -gt $i -and $null -ne $global:episode_numbers[$i]) { $global:episodenumber = $($global:episode_numbers[$i].Trim()) } else { $global:episodenumber = $null }
                $global:FileNaming = "S" + "$global:season_number".PadLeft(2, '0') + "E" + "$global:episodenumber".PadLeft(2, '0')
                $bullet = [char]0x2022
                $global:SeasonEPNumber = "$SeasonTCText $global:season_number $bullet $EpisodeTCText $global:episodenumber"
                $Titletext = "$global:show_name ($global:FileNaming)"

                if ($LibraryFolders -eq 'true') {
                    $EpisodeImageoriginal = "$EntryDir\$global:FileNaming.jpg"
                    $TestPath = $EntryDir
                    $ManualTestPath = $ManualEntryDir
                    $Testfile = "$global:FileNaming"
                    $TestfileTemplate = "EpisodeTemplate"
                }
                Else {
                    if ($episode.extraFolder) {
                        $EpisodeImageoriginal = "$AssetPath\$($episode.extraFolder)\$($episode.RootFoldername)_$global:FileNaming.jpg"
                    }
                    Else {
                        $EpisodeImageoriginal = "$AssetPath\$($episode.RootFoldername)_$global:FileNaming.jpg"
                    }
                    $TestPath = $AssetPath
                    $ManualTestPath = $ManualPath
                    $Testfile = "$($episode.RootFoldername)_$global:FileNaming"
                    $TestfileTemplate = "$($episode.RootFoldername)_EpisodeTemplate"
                }

                if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                    $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    $EpisodeImageoriginal = ($EpisodeImageoriginal).Replace('\', '/').Replace('./', '/')
                    $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    $Templatetestpath = ($ManualEntryDir + "/" + $TestfileTemplate).Replace('\', '/').Replace('./', '/')
                }
                else {
                    $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                    $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                    if ($fullTestPath) {
                        $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        $Templatetestpath = ($fullManualTestPath.ProviderPath + "\" + $TestfileTemplate).Replace('/', '\')
                    }
                    Else {
                        $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                        $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                        $Templatetestpath = ($ManualEntryDir + "\" + $TestfileTemplate).Replace('/', '\')
                    }
                }

                Write-Entry -Message "Test Path is: $TestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Test File is: $Testfile" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Full Test Path is: $fullTestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved hash Test Path is: $hashtestpath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Manual Test Path is: $ManualTestPath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Manual Test Path is: $Manualtestpath" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Message "Resolved Manual Full Test Path is: $fullManualTestPath" -Path $global:configLogging -Color Cyan -log Debug

                $EpisodeImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($episode.ShowRatingKey)_$($episode.RootFoldername)_$global:FileNaming.jpg"
                $EpisodeImage = $EpisodeImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')

                $EpisodeTempImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($episode.ShowRatingKey)_$($episode.RootFoldername)_temp.jpg"
                $cjkTitlePattern = '[\p{IsHiragana}\p{IsKatakana}\p{IsCJKUnifiedIdeographs}\p{IsThai}]'

                # Pre-check the title against skipwords
                $matchedWord = $null
                foreach ($word in $SkipWords) {
                    if ($word -match '^/(.+)/$') {
                        if ($global:EPTitle -match $matches[1]) {
                            $matchedWord = $word
                            break # Stop checking once we find a match
                        }
                    } else {
                        if ($global:EPTitle -match "^$([regex]::Escape($word))") {
                            $matchedWord = $word
                            break # Stop checking once we find a match
                        }
                    }
                }

                if ($SkipTBA -eq 'true' -and $matchedWord) {
                    Write-Entry -Subtext "Skipping $global:FileNaming of $global:show_name because Title matches '$matchedWord'" -Path $global:configLogging -Color Yellow -log Warning
                    $SkipTBACount++
                }
                Elseif ($SkipJapTitle -eq 'true' -and $global:EPTitle -match $cjkTitlePattern) {
                    Write-Entry -Subtext "Skipping $global:FileNaming of $global:show_name because Title contains Jap/Chinese Chars" -Path $global:configLogging -Color Yellow -log Warning
                    $SkipJapTitleCount++
                }
                Else {
                    $checkedItems.Add($hashtestpath)

                    if (-not $directoryHashtable.ContainsKey("$hashtestpath")) {
                        $Arturl = $null
                        if ($global:PlexTitleCardUrl -like "/library/*") {
                            $Arturl = $plexurl + $global:PlexTitleCardUrl
                        }
                        elseif ($global:OtherMediaServerTitleCardUrls.Count -gt $i -and $global:OtherMediaServerTitleCardUrls[$i]) {
                            $Arturl = $global:OtherMediaServerTitleCardUrls[$i]
                        }
                        elseif ($episode.OtherMediaServerBackgroundUrl) {
                            $Arturl = "$OtherMediaServerUrl/items/$($episode.ShowId)/images/backdrop/"
                        }
                        foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                            $manualFile = "$ManualTestPath$ext"
                            $templateFile = "$Templatetestpath$ext"
                            $filePath = $null

                            if (Test-Path -LiteralPath $manualFile) {
                                $filePath = $manualFile
                            }
                            elseif (Test-Path -LiteralPath $templateFile) {
                                $filePath = $templateFile
                            }

                            if ($filePath) {
                                Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                $posterext = $ext
                                break
                            }
                        }
                        if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                            Write-Entry -Message "Found Manual Title Card for: $global:show_name - $global:SeasonEPNumber" -Path $global:configLogging -Color White -log Info
                            $TakeLocal = $true
                            $Episodepostersearchtext = $true
                        }
                        elseif ((Test-Path -LiteralPath "$($Templatetestpath)$posterext") -and $Templatetestpath -ne '\') {
                            Write-Entry -Message "Found Template Poster..." -Path $global:configLogging -Color White -log Info
                            $ManualTestPath = $Templatetestpath
                            $TakeLocal = $true
                        }
                        Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlineSeasonFetch -eq 'true') {
                            $LocalAssetMissing = 'true'
                        }
                        Else {
                            if (!$Episodepostersearchtext) {
                                Write-Entry -Message "Start Title Card Search for: $global:show_name - $global:SeasonEPNumber" -Path $global:configLogging -Color White -log Info
                                $Episodepostersearchtext = $true
                            }
                            if ($global:TempImagecopied -ne 'true') {
                                # now search for TitleCards
                            if ($global:OverrideProviderOrder) {
                                foreach ($provider in $global:ProviderOrder) {
                                    if ($global:posterurl -or $global:PlexartworkDownloaded) { break }
                                    switch -Wildcard ($provider) {
                                        'TMDB' { if ($episode.tmdbid) { $global:posterurl = GetTMDBTitleCard } }
                                        'TVDB' { if ($episode.tvdbid) { $global:posterurl = GetTVDBTitleCard } }
                                        'PLEX' { if ($ArtUrl) { GetPlexArtwork -Type ": `$global:show_name 'Season `$global:season_number - Episode `$global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage } }
                                    }
                                    if ($global:posterurl -or $global:PlexartworkDownloaded) {
                                        Write-Entry -Subtext "Took image from custom provider loop: $provider" -Path $global:configLogging -Color Cyan -log Info
                                        if ($provider -ne $global:ProviderOrder[0]) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                            }
                            Else {
                                if ($global:FavProvider -eq 'TMDB') {
                                    if ($episode.tmdbid) {
                                        $global:posterurl = GetTMDBShowBackground
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetTVDBShowBackground
                                            if (!$global:posterurl) {
                                                $global:posterurl = GetFanartShowBackground
                                            }
                                        }
                                        if (!$global:posterurl) {
                                            $global:IsFallback = $true
                                            if ($ArtUrl) {
                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                            }
                                            Else {
                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            if ($global:tmdbfallbackposterurl) {
                                                $global:posterurl = $global:tmdbfallbackposterurl
                                            }
                                            if (!$global:posterurl) {
                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                $global:IsFallback = $false
                                            }
                                        }
                                    }
                                    else {
                                        Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                        $global:posterurl = GetTVDBShowBackground
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetFanartShowBackground
                                        }
                                        if (!$global:posterurl) {
                                            $global:IsFallback = $true
                                            if ($ArtUrl) {
                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                            }
                                            Else {
                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            if (!$global:posterurl) {
                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                $global:IsFallback = $false
                                            }
                                        }
                                    }
                                }
                                Else {
                                    if ($episode.tvdbid) {
                                        $global:posterurl = GetTVDBShowBackground
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetTMDBShowBackground
                                            if (!$global:posterurl) {
                                                $global:posterurl = GetFanartShowBackground
                                            }
                                        }
                                        if (!$global:posterurl) {
                                            $global:IsFallback = $true
                                            if ($ArtUrl) {
                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                            }
                                            Else {
                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            if (!$global:posterurl) {
                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                $global:IsFallback = $false
                                            }
                                        }
                                    }
                                    else {
                                        Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                        $global:posterurl = GetTMDBShowBackground
                                        if (!$global:posterurl) {
                                            $global:posterurl = GetFanartShowBackground
                                        }
                                        if (!$global:posterurl) {
                                            $global:IsFallback = $true
                                            if ($ArtUrl) {
                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                            }
                                            Else {
                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            if (!$global:posterurl) {
                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                $global:IsFallback = $false
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal -or $global:TempImagecopied -eq 'true') {
                            $global:IsTruncated = $null
                            if ($global:ForceTextAssetRestoration -ne $null) {
                                if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                    $global:PosterPreferTextless = $global:OriginalPreferTextless
                                    $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                        $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                        $global:OriginalPreferredLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                    $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                    $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                        $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                        $global:OriginalPreferredBackgroundLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                    $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                    $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                        $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                        $global:OriginalPreferredSeasonLanguageOrder = $null
                                    }
                                }
                                $global:ForceTextAssetRestoration = $null
                            }
                            if ($global:ImageProcessing -eq 'true') {
                                if ($TakeLocal) {
                                    Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                        Copy-Item -LiteralPath $_.FullName -Destination $EpisodeImage | Out-Null
                                    }
                                    if ($global:TempImagecopied -ne 'true') {
                                        Copy-Item -LiteralPath $EpisodeImage -destination $EpisodeTempImage | Out-Null
                                    }
                                    if ($SkipLocalTCTextAdd -eq 'true') {
                                        $SkippingText = 'true'
                                    }
                                    Write-Entry -Subtext "Copy local asset to: $EpisodeImage" -Path $global:configLogging -Color Green -log Info
                                }
                                Else {
                                    try {
                                        if (!$global:PlexartworkDownloaded -and $global:TempImagecopied -ne 'true') {
                                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                            Copy-Item -LiteralPath $EpisodeImage -destination $EpisodeTempImage | Out-Null
                                        }
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
                                    if ($global:TempImagecopied -ne 'true') {
                                        Write-Entry -Subtext "Title Card url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                        if ($global:posterurl -like 'https://image.tmdb.org*') {
                                            Write-Entry -Subtext "Downloading Title Card from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                            if ($global:FavProvider -ne 'TMDB') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        if ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                            Write-Entry -Subtext "Downloading Title Card from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                            if ($global:FavProvider -ne 'TVDB') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                        if ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                            Write-Entry -Subtext "Downloading Title Card from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                            if ($global:FavProvider -ne 'PLEX') {
                                                $global:IsFallback = $true
                                            }
                                        }
                                    }
                                    Else {
                                        Write-Entry -Subtext "Taking temp image..." -Path $global:configLogging -Color Green -log Info
                                        Copy-Item -LiteralPath $EpisodeTempImage -destination $EpisodeImage | Out-Null
                                    }
                                }
                                $global:TempImagecopied = $true
                                # Check temp image
                                if ((Get-ChildItem -LiteralPath $EpisodeTempImage -ErrorAction SilentlyContinue).length -eq '0') {
                                    Write-Entry -Subtext "Temp image is corrupt, cannot proceed" -Path $global:configLogging -Color Red -log Error
                                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                                }
                                Else {
                                    if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                        $CommentArguments = "`"$EpisodeImage`" -set `"comment`" `"created with posterizarr`" `"$EpisodeImage`""
                                        $CommentlogEntry = "`"$magick`" $CommentArguments"
                                        $CommentlogEntry | Write-MagickLog
                                        InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                        if ($global:ImageMagickError -ne 'true') {
                                            if ($UseTCResolutionOverlays -eq 'true') {
                                                switch ($global:EPResolution) {
                                                    '4K DoVi/HDR10' { $TitleCardoverlay = $4KDoViHDR10TC }
                                                    '4K DoVi' { $TitleCardoverlay = $4KDoViTC }
                                                    '4K HDR10' { $TitleCardoverlay = $4KHDR10TC }
                                                    '4K' { $TitleCardoverlay = $4kTC }
                                                    '1080p' { $TitleCardoverlay = $1080pTC }
                                                    Default { $TitleCardoverlay = $DefaultTitleCardoverlay }
                                                }
                                            }
                                            Else {
                                                $TitleCardoverlay = $DefaultTitleCardoverlay
                                            }
                                            $settings = Get-OverlayAndBorderSettings -AddBorder $LocalAddBorder -AddOverlay $LocalAddOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                                            $LocalAddBorder = $settings.Border
                                            $LocalAddOverlay = $settings.Overlay
                                            # Resize Image to 2000x3000 and apply Border and overlay
                                            if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$TitleCardoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$EpisodeImage`""
                                                Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                            }
                                            elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$EpisodeImage`""
                                                Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                            }
                                            elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$TitleCardoverlay`" -gravity south -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                            }
                                            else {
                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$EpisodeImage`""
                                                Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                            }
                                            $logEntry = "`"$magick`" $Arguments"
                                            $logEntry | Write-MagickLog
                                            InvokeMagickCommand -Command $magick -Arguments $Arguments
                                            $SkippingText = Get-SkipTextSetting -SkipAddText $SkipAddText -SkipAddTextAndOverlay $SkipAddTextAndOverlay -PosterWithText $global:PosterWithText
                                            if ($SkippingText -eq 'true') {
                                                Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                            }
                                            if ($AddTitleCardEPTitleText -eq 'true' -and $SkippingText -eq 'false') {
                                                if ($TitleCardEPTitlefontAllCaps -eq 'true') {
                                                    $global:EPTitle = $global:EPTitle.ToUpper()
                                                }
                                                $global:EPTitle = $global:EPTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''

                                                if ($global:direction -eq "RTL") {
                                                    $TitleCardfontImagemagick = $RTLfontImagemagick
                                                }
                                                # Loop through each symbol and replace it with a newline
                                                if ($NewLineOnSpecificSymbols -eq 'true') {
                                                    foreach ($symbol in $NewLineSymbols) {
                                                        # Replace the symbol with a newline
                                                        $replacementString = "`n"

                                                        # Check if the symbol should be kept
                                                        $keepThisSymbol = $false
                                                        if ($null -ne $SymbolsToKeepOnNewLine) {
                                                            # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                            foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                if ($symbol -like "*$k*") {
                                                                    $keepThisSymbol = $true
                                                                    break # Match found, no need to keep checking
                                                                }
                                                            }
                                                        }

                                                        # If it's a "keep" symbol, change the replacement string
                                                        if ($keepThisSymbol) {
                                                            # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                            $replacementString = $symbol + "`n"
                                                        }
                                                        $global:EPTitle = $global:EPTitle -replace [regex]::Escape($symbol), $replacementString
                                                    }
                                                }
                                                if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                    $properties = $NewLineWords.PSObject.Properties.Name

                                                    # Check if properties exist and the list is not empty
                                                    if ($null -ne $properties -and $properties.Count -gt 0) {
                                                        foreach ($wordKey in $properties) {
                                                            $replacementValue = $NewLineWords.$wordKey

                                                            # Using [regex]::Escape handles any special characters in the word keys
                                                            $global:EPTitle = $global:EPTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                        }
                                                    }
                                                }
                                                $joinedTitlePointSize = $global:EPTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPTitleMaxWidth  -box_height $TitleCardEPTitleMaxHeight -min_pointsize $TitleCardEPTitleminPointSize -max_pointsize $TitleCardEPTitlemaxPointSize -lineSpacing $TitleCardEPTitlelineSpacing
                                                if ($global:IsTruncated -ne $true) {
                                                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                    # Add Stroke
                                                    if ($AddTitleCardEPTitleTextStroke -eq 'true') {
                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPTitleboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlestrokecolor`" -stroke `"$TitleCardEPTitlestrokecolor`" -strokewidth `"$TitleCardEPTitlestrokewidth`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -stroke none -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                    }
                                                    Else {
                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                    }
                                                    Write-Entry -Subtext "Applying EPTitle text: `"$global:EPTitle`"" -Path $global:configLogging -Color White -log Info
                                                    $logEntry = "`"$magick`" $Arguments"
                                                    $logEntry | Write-MagickLog
                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                }
                                            }
                                            if ($AddTitleCardEPText -eq 'true' -and $SkippingText -eq 'false') {
                                                if ($TitleCardEPfontAllCaps -eq 'true') {
                                                    $global:SeasonEPNumber = $global:SeasonEPNumber.ToUpper()
                                                }
                                                $global:SeasonEPNumber = $global:SeasonEPNumber -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                                $joinedTitlePointSize = $global:SeasonEPNumber -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                                $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPMaxWidth  -box_height $TitleCardEPMaxHeight -min_pointsize $TitleCardEPminPointSize -max_pointsize $TitleCardEPmaxPointSize -lineSpacing $TitleCardEPlineSpacing
                                                if ($global:IsTruncated -ne $true) {
                                                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                    # Add Stroke
                                                    if ($AddTitleCardTextStroke -eq 'true') {
                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardstrokecolor`" -stroke `"$TitleCardstrokecolor`" -strokewidth `"$TitleCardstrokewidth`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPfontcolor`" -stroke none -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                    }
                                                    Else {
                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPfontcolor`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                    }

                                                    Write-Entry -Subtext "Applying SeasonEPNumber text: `"$global:SeasonEPNumber`"" -Path $global:configLogging -Color White -log Info
                                                    $logEntry = "`"$magick`" $Arguments"
                                                    $logEntry | Write-MagickLog
                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Else {
                                if ($TakeLocal) {
                                    Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                        Copy-Item -LiteralPath $_.FullName -Destination $EpisodeImage
                                    }
                                    if ($SkipLocalTCTextAdd -eq 'true') {
                                        $SkippingText = 'true'
                                    }
                                    Write-Entry -Subtext "Copy local asset to: $EpisodeImage" -Path $global:configLogging -Color Green -log Info
                                }
                                Else {
                                    try {
                                        if (!$global:PlexartworkDownloaded) {
                                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                        }
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
                                    Write-Entry -Subtext "Title Card url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                    if ($global:posterurl -like 'https://image.tmdb.org*') {
                                        Write-Entry -Subtext "Downloading Title Card from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                        if ($global:FavProvider -ne 'TMDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                        Write-Entry -Subtext "Downloading Title Card from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                        if ($global:FavProvider -ne 'TVDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                        Write-Entry -Subtext "Downloading Title Card from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        if ($global:FavProvider -ne 'PLEX') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                    # Resize Image to 2000x3000
                                    $Resizeargument = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$EpisodeImage`""
                                    Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                    $logEntry = "`"$magick`" $Resizeargument"
                                    $logEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                                }
                            }
                            if ($global:ImageMagickError -ne 'true') {
                                if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                    # Move file back to original naming with Brackets.
                                    if ($global:IsTruncated -ne $true) {
                                        if ($UseOtherMediaServer -eq 'true' -and $global:episodeid) {
                                            Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($global:episodeid)" -Path $global:configLogging -Color Cyan -log Debug
                                            UploadOtherMediaServerArtwork -itemId $global:episodeid -imageType "Primary" -imagePath $EpisodeImage
                                        }
                                        if ($Upload2Plex -eq 'true') {
                                            try {
                                                Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                
                                                # Verify variables before uploading
                                                Write-Entry -Subtext "EpisodeImage: $EpisodeImage" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "RatingKey: $($global:episode_ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                $uri = "$PlexUrl/library/metadata/$($global:episode_ratingkey)/posters"
                                                Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                # Try uploading, capturing the response in detail
                                                $Upload = Invoke-WebRequest -Uri $uri `
                                                    -Method Post `
                                                    -Headers $extraPlexHeaders `
                                                    -InFile $EpisodeImage `
-ContentType 'image/jpeg' `
                                                    -SkipHttpErrorCheck `
                                                    -ErrorAction Stop

                                                if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                    Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                    Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                }
                                                else {
                                                    Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                    Write-Entry -Subtext "$Titletext | TitleCard successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                    $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                                }
                                            }
                                            catch {
                                                Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                $global:errorCount = Increment-GlobalStat 'errorCount'
                                                Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                            }
                                        }
                                        try {
                                            $EpisodeTargetDir = Split-Path -Path $EpisodeImageoriginal -Parent
                                            if ($EpisodeTargetDir -and -not (Test-Path -LiteralPath $EpisodeTargetDir)) {
                                                New-Item -ItemType Directory -Path $EpisodeTargetDir -Force | Out-Null
                                            }
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
                                    Else {
                                        Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                    $episodetemp = New-Object psobject
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($global:FileNaming + " | " + $global:EPTitle)
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Episode'
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($episode.RootFoldername)
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($episode.'Library Name')
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback -and $global:FallbackText) { $global:FallbackText } elseif ($global:IsFallback -and !$global:FallbackText) { 'true' } Else { 'false' })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $EpisodeImage } Else { $global:posterurl })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($episode.tmdbid) { $episode.tmdbid } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($episode.tvdbid) { $episode.tvdbid } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($episode.imdbid) { $episode.imdbid } Else { "false" })
                                    switch -Wildcard ($global:FavProvider) {
                                        'TMDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                        'FANART' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                        'TVDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                        Default { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                    }
                                    # Export the array to a CSV file
                                    $episodetemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                    if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $episodetemp.Type -title $($global:show_name + " | " + $episodetemp.Title) -Lib $episodetemp.LibraryName -DLSource $episodetemp.'Download Source' -lang $episodetemp.Language -favurl $episodetemp.'Fav Provider Link' -fallback $episodetemp.Fallback -Truncated $episodetemp.TextTruncated }
                                }
                            }
                        }
                        Elseif ($LocalAssetMissing -eq 'true') {
                            Write-Entry -Subtext "Skipping [$global:show_name - $global:SeasonEPNumber] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                        }
                        Else {
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                            if ($global:BackgroundOnlyTextless) {
                                $episodetemp = New-Object psobject
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($global:FileNaming + " | " + $global:EPTitle)
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Episode'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($episode.RootFoldername)
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($episode.'Library Name')
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($episode.tmdbid) { $episode.tmdbid } Else { "false" })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($episode.tvdbid) { $episode.tvdbid } Else { "false" })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($episode.imdbid) { $episode.imdbid } Else { "false" })
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                    'FANART' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                    'TVDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                    Default { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                }

                                # Export the array to a CSV file
                                $episodetemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $episodetemp.Type -title $($global:show_name + " | " + $episodetemp.Title) -Lib $episodetemp.LibraryName -DLSource $episodetemp.'Download Source' -lang $episodetemp.Language -favurl $episodetemp.'Fav Provider Link' -fallback $episodetemp.Fallback -Truncated $episodetemp.TextTruncated }
                            }

                        }

                    }
                    } else {
                        if ($global:UploadExistingAssets -eq 'true') {
                            if ($global:PlexTitleCardUrl -like "/library/*") {
                                $Arturl = $plexurl + $global:PlexTitleCardUrl
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                try {
                                    GetPlexArtwork -Type " $Titletext | $global:FileNaming Artwork." -ArtUrl $Arturl -TempImage $EpisodeImage
                                    if ($global:PlexartworkDownloaded -eq 'true') {
                                        Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                        
                                        # Verify variables before uploading
                                        Write-Entry -Subtext "EpisodeImage: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "RatingKey: $($global:episode_ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                        $uri = "$PlexUrl/library/metadata/$($global:episode_ratingkey)/posters"
                                        Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                        # Try uploading, capturing the response in detail
                                        $Upload = Invoke-WebRequest -Uri $uri `
                                            -Method Post `
                                            -Headers $extraPlexHeaders `
                                            -InFile $EpisodeImageoriginal `
-ContentType 'image/jpeg' `
                                            -SkipHttpErrorCheck `
                                            -ErrorAction Stop
    
                                        if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                            Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                            Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                        }
                                        else {
                                            Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                            Write-Entry -Subtext "$Titletext | TitleCard successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                            $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                        }
                                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                    }
                                }
                                catch {
                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                            elseif ($global:episodeid) {
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                UploadOtherMediaServerArtwork -itemId $global:episodeid -imageType "Primary" -imagePath $EpisodeImageoriginal
                            }
                            if (Test-Path $EpisodeImage -ErrorAction SilentlyContinue) {
                                Remove-Item -LiteralPath $EpisodeImage | Out-Null
                                Write-Entry -Message "Deleting Temp Image: $EpisodeImage" -Path $global:configLogging -Color White -log Info
                            }
                        }
                        Else {
                            if ($show_skipped -eq 'true' ) {
                                Write-Entry -Subtext "Already exists: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                            }
                        }
                    }
                }
            }
            if (Test-Path $EpisodeTempImage -ErrorAction SilentlyContinue) {
                Remove-Item -LiteralPath $EpisodeTempImage | Out-Null
                Write-Entry -Message "Deleting EpisodeTempImage: $EpisodeTempImage" -Path $global:configLogging -Color White -log Info
            }
        }
        Else {
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
                $global:FallbackText = $null
                $global:ImageMagickError = $null
                $global:TextlessPoster = $null
                $global:posterurl = $null
                $Episodepostersearchtext = $null
                $ExifFound = $null
                $global:PlexartworkDownloaded = $null
                $value = $null
                $magickcommand = $null
                $Arturl = $null
                $TakeLocal = $null
                $LocalAssetMissing = $null
                $LocalAddOverlay = $AddTitleCardOverlay
                $LocalAddBorder = $AddTitleCardBorder
                if ($global:PlexTitleCardUrls.Count -gt $i -and $null -ne $global:PlexTitleCardUrls[$i]) { $global:PlexTitleCardUrl = $($global:PlexTitleCardUrls[$i].Trim()) } else { $global:PlexTitleCardUrl = $null }
                if ($global:episode_ratingkeys.Count -gt $i -and $null -ne $global:episode_ratingkeys[$i]) { $global:episode_ratingkey = $($global:episode_ratingkeys[$i].Trim()) } else { $global:episode_ratingkey = $null }
                if ($global:episode_ids.Count -gt $i -and $null -ne $global:episode_ids[$i]) { $global:episodeid = $($global:episode_ids[$i].Trim()) } else { $global:episodeid = $null }
                if ($global:titles.Count -gt $i -and $null -ne $global:titles[$i]) { $global:EPTitle = $($global:titles[$i].Trim()) } else { $global:EPTitle = $null }
                if ($global:EPResolutions.Count -gt $i -and $null -ne $global:EPResolutions[$i]) { $global:EPResolution = $($global:EPResolutions[$i].Trim()) } else { $global:EPResolution = $null }
                if ($global:episode_numbers.Count -gt $i -and $null -ne $global:episode_numbers[$i]) { $global:episodenumber = $($global:episode_numbers[$i].Trim()) } else { $global:episodenumber = $null }
                $global:FileNaming = "S" + "$global:season_number".PadLeft(2, '0') + "E" + "$global:episodenumber".PadLeft(2, '0')
                $bullet = [char]0x2022
                $global:SeasonEPNumber = "$SeasonTCText $global:season_number $bullet $EpisodeTCText $global:episodenumber"

                if ($LibraryFolders -eq 'true') {
                    $EpisodeImageoriginal = "$EntryDir\$global:FileNaming.jpg"
                    $TestPath = $EntryDir
                    $ManualTestPath = $ManualEntryDir
                    $Testfile = "$global:FileNaming"
                    $TestfileTemplate = "EpisodeTemplate"
                }
                Else {
                    if ($episode.extraFolder) {
                        $EpisodeImageoriginal = "$AssetPath\$($episode.extraFolder)\$($episode.RootFoldername)_$global:FileNaming.jpg"
                    }
                    Else {
                        $EpisodeImageoriginal = "$AssetPath\$($episode.RootFoldername)_$global:FileNaming.jpg"
                    }
                    $TestPath = $AssetPath
                    $ManualTestPath = $ManualPath
                    $Testfile = "$($episode.RootFoldername)_$global:FileNaming"
                    $TestfileTemplate = "$($episode.RootFoldername)_EpisodeTemplate"
                }

                if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                    $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    $EpisodeImageoriginal = ($EpisodeImageoriginal).Replace('\', '/').Replace('./', '/')
                    $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                    $Templatetestpath = ($ManualEntryDir + "/" + $TestfileTemplate).Replace('\', '/').Replace('./', '/')
                }
                else {
                    $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                    $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                    if ($fullTestPath) {
                        $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                        $Templatetestpath = ($fullManualTestPath.ProviderPath + "\" + $TestfileTemplate).Replace('/', '\')
                    }
                    Else {
                        $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                        $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                        $Templatetestpath = ($ManualEntryDir + "\" + $TestfileTemplate).Replace('/', '\')
                    }
                }

                $EpisodeImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($episode.ShowRatingKey)_$($episode.RootFoldername)_$global:FileNaming.jpg"
                $EpisodeImage = $EpisodeImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                $cjkTitlePattern = '[\p{IsHiragana}\p{IsKatakana}\p{IsCJKUnifiedIdeographs}\p{IsThai}]'

                # Pre-check the title against skipwords
                $matchedWord = $null
                foreach ($word in $SkipWords) {
                    if ($word -match '^/(.+)/$') {
                        if ($global:EPTitle -match $matches[1]) {
                            $matchedWord = $word
                            break # Stop checking once we find a match
                        }
                    } else {
                        if ($global:EPTitle -match "^$([regex]::Escape($word))") {
                            $matchedWord = $word
                            break # Stop checking once we find a match
                        }
                    }
                }

                if ($SkipTBA -eq 'true' -and $matchedWord) {
                    Write-Entry -Subtext "Skipping $global:FileNaming of $global:show_name because Title matches '$matchedWord'" -Path $global:configLogging -Color Yellow -log Warning
                    $SkipTBACount++
                }
                Elseif ($SkipJapTitle -eq 'true' -and $global:EPTitle -match $cjkTitlePattern) {
                    Write-Entry -Subtext "Skipping $global:FileNaming of $global:show_name because Title contains Jap/Chinese Chars" -Path $global:configLogging -Color Yellow -log Warning
                    $SkipJapTitleCount++
                }
                Else {
                    $checkedItems.Add($hashtestpath)
                    if (-not $directoryHashtable.ContainsKey("$hashtestpath")) {
                        $Arturl = $null
                        if ($global:PlexTitleCardUrl -like "/library/*") {
                            $Arturl = $plexurl + $global:PlexTitleCardUrl
                        }
                        elseif ($global:OtherMediaServerTitleCardUrls.Count -gt $i -and $global:OtherMediaServerTitleCardUrls[$i]) {
                            $Arturl = $global:OtherMediaServerTitleCardUrls[$i]
                        }
                        elseif ($episode.OtherMediaServerBackgroundUrl) {
                            $Arturl = "$OtherMediaServerUrl/items/$($episode.ShowId)/images/backdrop/"
                        }
                        foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                            $manualFile = "$ManualTestPath$ext"
                            $templateFile = "$Templatetestpath$ext"
                            $filePath = $null

                            if (Test-Path -LiteralPath $manualFile) {
                                $filePath = $manualFile
                            }
                            elseif (Test-Path -LiteralPath $templateFile) {
                                $filePath = $templateFile
                            }

                            if ($filePath) {
                                Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                $posterext = $ext
                                break
                            }
                        }
                        if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                            Write-Entry -Message "Found Manual Title Card for: $global:show_name - $global:SeasonEPNumber" -Path $global:configLogging -Color White -log Info
                            $TakeLocal = $true
                        }
                        elseif ((Test-Path -LiteralPath "$($Templatetestpath)$posterext") -and $Templatetestpath -ne '\') {
                            Write-Entry -Message "Found Template Poster..." -Path $global:configLogging -Color White -log Info
                            $ManualTestPath = $Templatetestpath
                            $TakeLocal = $true
                        }
                        Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlineTitleCardFetch -eq 'true') {
                            $LocalAssetMissing = 'true'
                        }
                        Else {
                            if (!$Episodepostersearchtext) {
                                Write-Entry -Message "Start Title Card Search for: $global:show_name - $global:SeasonEPNumber" -Path $global:configLogging -Color White -log Info
                                $Episodepostersearchtext = $true
                            }
                            # now search for TitleCards
                            if ($global:FavProvider -eq 'TMDB') {
                                if ($episode.tmdbid) {
                                    $global:posterurl = GetTMDBTitleCard
                                    if (!$global:posterurl) {
                                        $global:IsFallback = $true
                                        $global:posterurl = GetTVDBTitleCard
                                        if ($global:posterurl) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if (!$global:posterurl) {
                                        $global:IsFallback = $true
                                        if ($ArtUrl) {
                                            GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                        }
                                        Else {
                                            Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if (!$global:posterurl) {
                                            Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                        }
                                    }
                                    if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                        # Lets just try to grab a background poster.
                                        Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:posterurl = GetTMDBShowBackground
                                        if ($global:posterurl) {
                                            Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                            $global:IsFallback = $true
                                            $global:FallbackText = 'True-Background'
                                        }
                                        Else {
                                            # Lets just try to grab a background poster.
                                            $global:posterurl = GetTVDBShowBackground
                                            if ($global:posterurl) {
                                                Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                                $global:FallbackText = 'True-Background'
                                            }
                                        }
                                    }
                                }
                                else {
                                    Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                    $global:posterurl = GetTVDBTitleCard
                                    if (!$global:posterurl) {
                                        $global:IsFallback = $true
                                        if ($ArtUrl) {
                                            GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                        }
                                        Else {
                                            Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if (!$global:posterurl) {
                                            Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                        }
                                    }
                                    if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                        Write-Entry -Subtext "No Title Cards for this Episode on TVDB or TMDB..." -Path $global:configLogging -Color Red -log Error
                                        # Lets just try to grab a background poster.
                                        Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:posterurl = GetTVDBShowBackground
                                        if ($global:posterurl) {
                                            Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                            $global:IsFallback = $true
                                            $global:FallbackText = 'True-Background'
                                        }
                                    }
                                }
                            }
                            Else {
                                if ($episode.tvdbid) {
                                    $global:posterurl = GetTVDBTitleCard
                                    if (!$global:posterurl -or $global:Fallback -eq "TMDB") {
                                        $global:posterurl = GetTMDBTitleCard
                                        if ($global:FavProvider -ne 'TMDB' -and $global:posterurl) {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if (!$global:posterurl) {
                                        $global:IsFallback = $true
                                        if ($ArtUrl) {
                                            GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                        }
                                        Else {
                                            Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if (!$global:posterurl) {
                                            Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                        }
                                    }
                                    if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                        # Lets just try to grab a background poster.
                                        Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:posterurl = GetTVDBShowBackground
                                        if ($global:posterurl) {
                                            Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                            $global:IsFallback = $true
                                            $global:FallbackText = 'True-Background'
                                        }
                                        Else {
                                            # Lets just try to grab a background poster.
                                            $global:posterurl = GetTMDBShowBackground
                                            if ($global:posterurl) {
                                                Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                $global:IsFallback = $true
                                                $global:FallbackText = 'True-Background'
                                            }
                                        }
                                    }
                                }
                                else {
                                    Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                    $global:posterurl = GetTMDBTitleCard
                                    if ($global:FavProvider -ne 'TMDB' -and $global:posterurl) {
                                        $global:IsFallback = $true
                                    }
                                    if (!$global:posterurl) {
                                        $global:IsFallback = $true
                                        if ($ArtUrl) {
                                            GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                        }
                                        Else {
                                            Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                        }
                                        if (!$global:posterurl) {
                                            Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                        }
                                    }
                                    if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                        # Lets just try to grab a background poster.
                                        Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:posterurl = GetTMDBShowBackground
                                        if ($global:posterurl) {
                                            Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                            $global:IsFallback = $true
                                            $global:FallbackText = 'True-Background'
                                        }
                                    }
                                }
                            }
                        }
                        if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                            $global:IsTruncated = $null
                            if ($global:ForceTextAssetRestoration -ne $null) {
                                if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                    $global:PosterPreferTextless = $global:OriginalPreferTextless
                                    $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                        $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                        $global:OriginalPreferredLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                    $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                    $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                        $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                        $global:OriginalPreferredBackgroundLanguageOrder = $null
                                    }
                                } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                    $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                    $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                    if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                        $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                        Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                        $global:OriginalPreferredSeasonLanguageOrder = $null
                                    }
                                }
                                $global:ForceTextAssetRestoration = $null
                            }
                            if ($global:ImageProcessing -eq 'true') {
                                if ($TakeLocal) {
                                    Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                        Copy-Item -LiteralPath $_.FullName -Destination $EpisodeImage | Out-Null
                                    }
                                    if ($SkipLocalTCTextAdd -eq 'true') {
                                        $SkippingText = 'true'
                                    }
                                    Write-Entry -Subtext "Copy local asset to: $EpisodeImage" -Path $global:configLogging -Color Green -log Info
                                }
                                Else {
                                    try {
                                        if (!$global:PlexartworkDownloaded) {
                                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                        }
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
                                    Write-Entry -Subtext "Title Card url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                    if ($global:posterurl -like 'https://image.tmdb.org*') {
                                        Write-Entry -Subtext "Downloading Title Card from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                        if ($global:FavProvider -ne 'TMDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                        Write-Entry -Subtext "Downloading Title Card from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                        if ($global:FavProvider -ne 'TVDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                        Write-Entry -Subtext "Downloading Title Card from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        if ($global:FavProvider -ne 'PLEX') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                    $CommentArguments = "`"$EpisodeImage`" -set `"comment`" `"created with posterizarr`" `"$EpisodeImage`""
                                    $CommentlogEntry = "`"$magick`" $CommentArguments"
                                    $CommentlogEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                    if ($global:ImageMagickError -ne 'true') {
                                        if ($UseTCResolutionOverlays -eq 'true') {
                                            switch ($global:EPResolution) {
                                                '4K DoVi/HDR10' { $TitleCardoverlay = $4KDoViHDR10TC }
                                                '4K DoVi' { $TitleCardoverlay = $4KDoViTC }
                                                '4K HDR10' { $TitleCardoverlay = $4KHDR10TC }
                                                '4K' { $TitleCardoverlay = $4kTC }
                                                '1080p' { $TitleCardoverlay = $1080pTC }
                                                Default { $TitleCardoverlay = $DefaultTitleCardoverlay }
                                            }
                                        }
                                        Else {
                                            $TitleCardoverlay = $DefaultTitleCardoverlay
                                        }
                                        $settings = Get-OverlayAndBorderSettings -AddBorder $LocalAddBorder -AddOverlay $LocalAddOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                                        $LocalAddBorder = $settings.Border
                                        $LocalAddOverlay = $settings.Overlay
                                        # Resize Image to 2000x3000 and apply Border and overlay
                                        if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                            $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$TitleCardoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$EpisodeImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                        }
                                        elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                            $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$EpisodeImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                        }
                                        elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                            $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$TitleCardoverlay`" -gravity south -quality $global:outputQuality -composite `"$EpisodeImage`""
                                            Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                        }
                                        else {
                                            $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$EpisodeImage`""
                                            Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                        }
                                        $logEntry = "`"$magick`" $Arguments"
                                        $logEntry | Write-MagickLog
                                        InvokeMagickCommand -Command $magick -Arguments $Arguments
                                        $SkippingText = Get-SkipTextSetting -SkipAddText $SkipAddText -SkipAddTextAndOverlay $SkipAddTextAndOverlay -PosterWithText $global:PosterWithText
                                        if ($SkippingText -eq 'true') {
                                            Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                        }
                                        if ($AddTitleCardEPTitleText -eq 'true' -and $SkippingText -eq 'false') {
                                            if ($TitleCardEPTitlefontAllCaps -eq 'true') {
                                                $global:EPTitle = $global:EPTitle.ToUpper()
                                            }
                                            $global:EPTitle = $global:EPTitle -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                            if ($global:direction -eq "RTL") {
                                                $TitleCardfontImagemagick = $RTLfontImagemagick
                                            }
                                            # Loop through each symbol and replace it with a newline
                                            if ($NewLineOnSpecificSymbols -eq 'true') {
                                                foreach ($symbol in $NewLineSymbols) {
                                                    # Replace the symbol with a newline
                                                    $replacementString = "`n"

                                                    # Check if the symbol should be kept
                                                    $keepThisSymbol = $false
                                                    if ($null -ne $SymbolsToKeepOnNewLine) {
                                                        # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                        foreach ($k in $SymbolsToKeepOnNewLine) {
                                                            # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                            if ($symbol -like "*$k*") {
                                                                $keepThisSymbol = $true
                                                                break # Match found, no need to keep checking
                                                            }
                                                        }
                                                    }

                                                    # If it's a "keep" symbol, change the replacement string
                                                    if ($keepThisSymbol) {
                                                        # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                        $replacementString = $symbol + "`n"
                                                    }
                                                    $global:EPTitle = $global:EPTitle -replace [regex]::Escape($symbol), $replacementString
                                                }
                                            }
                                            if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                $properties = $NewLineWords.PSObject.Properties.Name

                                                # Check if properties exist and the list is not empty
                                                if ($null -ne $properties -and $properties.Count -gt 0) {
                                                    foreach ($wordKey in $properties) {
                                                        $replacementValue = $NewLineWords.$wordKey

                                                        # Using [regex]::Escape handles any special characters in the word keys
                                                        $global:EPTitle = $global:EPTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                    }
                                                }
                                            }
                                            $joinedTitlePointSize = $global:EPTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                            $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPTitleMaxWidth  -box_height $TitleCardEPTitleMaxHeight -min_pointsize $TitleCardEPTitleminPointSize -max_pointsize $TitleCardEPTitlemaxPointSize -lineSpacing $TitleCardEPTitlelineSpacing
                                            if ($global:IsTruncated -ne $true) {
                                                Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                # Add Stroke
                                                if ($AddTitleCardEPTitleTextStroke -eq 'true') {
                                                    $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPTitleboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlestrokecolor`" -stroke `"$TitleCardEPTitlestrokecolor`" -strokewidth `"$TitleCardEPTitlestrokewidth`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -stroke none -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                }
                                                Else {
                                                    $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                }

                                                Write-Entry -Subtext "Applying EPTitle text: `"$global:EPTitle`"" -Path $global:configLogging -Color White -log Info
                                                $logEntry = "`"$magick`" $Arguments"
                                                $logEntry | Write-MagickLog
                                                InvokeMagickCommand -Command $magick -Arguments $Arguments
                                            }
                                        }
                                        if ($AddTitleCardEPText -eq 'true' -and $SkippingText -eq 'false') {
                                            if ($TitleCardEPfontAllCaps -eq 'true') {
                                                $global:SeasonEPNumber = $global:SeasonEPNumber.ToUpper()
                                            }
                                            $global:SeasonEPNumber = $global:SeasonEPNumber -replace 'â€ž', '''' -replace 'â€', '"' -replace 'â€œ', '''' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                                            $joinedTitlePointSize = $global:SeasonEPNumber -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                                            $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPMaxWidth  -box_height $TitleCardEPMaxHeight -min_pointsize $TitleCardEPminPointSize -max_pointsize $TitleCardEPmaxPointSize -lineSpacing $TitleCardEPlineSpacing
                                            if ($global:IsTruncated -ne $true) {
                                                Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                # Add Stroke
                                                if ($AddTitleCardTextStroke -eq 'true') {
                                                    $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardstrokecolor`" -stroke `"$TitleCardstrokecolor`" -strokewidth `"$TitleCardstrokewidth`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPfontcolor`" -stroke none -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                }
                                                Else {
                                                    $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPfontcolor`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                }

                                                Write-Entry -Subtext "Applying SeasonEPNumber text: `"$global:SeasonEPNumber`"" -Path $global:configLogging -Color White -log Info
                                                $logEntry = "`"$magick`" $Arguments"
                                                $logEntry | Write-MagickLog
                                                InvokeMagickCommand -Command $magick -Arguments $Arguments
                                            }
                                        }
                                    }
                                }
                            }
                            Else {
                                if ($TakeLocal) {
                                    Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                        Copy-Item -LiteralPath $_.FullName -Destination $EpisodeImage | Out-Null
                                    }
                                    if ($SkipLocalTCTextAdd -eq 'true') {
                                        $SkippingText = 'true'
                                    }
                                    Write-Entry -Subtext "Copy local asset to: $EpisodeImage" -Path $global:configLogging -Color Green -log Info
                                }
                                Else {
                                    try {
                                        if (!$global:PlexartworkDownloaded) {
                                            $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                        }
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
                                    Write-Entry -Subtext "Title Card url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                    if ($global:posterurl -like 'https://image.tmdb.org*') {
                                        Write-Entry -Subtext "Downloading Title Card from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TMDBAssetTextLang
                                        if ($global:FavProvider -ne 'TMDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                        Write-Entry -Subtext "Downloading Title Card from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        $global:AssetTextLang = $global:TVDBAssetTextLang
                                        if ($global:FavProvider -ne 'TVDB') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                    if ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                        Write-Entry -Subtext "Downloading Title Card from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                        if ($global:FavProvider -ne 'PLEX') {
                                            $global:IsFallback = $true
                                        }
                                    }
                                }
                                if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                    # Resize Image to 2000x3000
                                    $Resizeargument = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$EpisodeImage`""
                                    Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                    $logEntry = "`"$magick`" $Resizeargument"
                                    $logEntry | Write-MagickLog
                                    InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                                }
                            }
                            if ($global:ImageMagickError -ne 'true') {
                                if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                    # Move file back to original naming with Brackets.
                                    if ($global:IsTruncated -ne $true) {
                                        if ($UseOtherMediaServer -eq 'true' -and $global:episodeid) {
                                            Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($global:episodeid)" -Path $global:configLogging -Color Cyan -log Debug
                                            UploadOtherMediaServerArtwork -itemId $global:episodeid -imageType "Primary" -imagePath $EpisodeImage
                                        }
                                        if ($Upload2Plex -eq 'true') {
                                            try {
                                                Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                
                                                # Verify variables before uploading
                                                Write-Entry -Subtext "EpisodeImage: $EpisodeImage" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "RatingKey: $($global:episode_ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                $uri = "$PlexUrl/library/metadata/$($global:episode_ratingkey)/posters"
                                                Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                # Try uploading, capturing the response in detail
                                                $Upload = Invoke-WebRequest -Uri $uri `
                                                    -Method Post `
                                                    -Headers $extraPlexHeaders `
                                                    -InFile $EpisodeImage `
-ContentType 'image/jpeg' `
                                                    -SkipHttpErrorCheck `
                                                    -ErrorAction Stop

                                                if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                    Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                    Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                }
                                                else {
                                                    Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                    Write-Entry -Subtext "$Titletext | TitleCard successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                    $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                                }
                                            }
                                            catch {
                                                Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                $global:errorCount = Increment-GlobalStat 'errorCount'
                                                Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                            }
                                        }
                                        try {
                                            $EpisodeTargetDir = Split-Path -Path $EpisodeImageoriginal -Parent
                                            if ($EpisodeTargetDir -and -not (Test-Path -LiteralPath $EpisodeTargetDir)) {
                                                New-Item -ItemType Directory -Path $EpisodeTargetDir -Force | Out-Null
                                            }
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
                                    Else {
                                        Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                    $episodetemp = New-Object psobject
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($global:FileNaming + " | " + $global:EPTitle)
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Episode'
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($episode.RootFoldername)
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($episode.'Library Name')
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback -and $global:FallbackText) { $global:FallbackText } elseif ($global:IsFallback -and !$global:FallbackText) { 'true' } Else { 'false' })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $EpisodeImage } Else { $global:posterurl })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($episode.tmdbid) { $episode.tmdbid } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($episode.tvdbid) { $episode.tvdbid } Else { "false" })
                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($episode.imdbid) { $episode.imdbid } Else { "false" })
                                    switch -Wildcard ($global:FavProvider) {
                                        'TMDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                        'FANART' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                        'TVDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                        Default { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                    }
                                    # Export the array to a CSV file
                                    $episodetemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                    if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $episodetemp.Type -title $($global:show_name + " | " + $episodetemp.Title) -Lib $episodetemp.LibraryName -DLSource $episodetemp.'Download Source' -lang $episodetemp.Language -favurl $episodetemp.'Fav Provider Link' -fallback $episodetemp.Fallback -Truncated $episodetemp.TextTruncated }
                                }
                            }
                        }
                        Elseif ($LocalAssetMissing -eq 'true') {
                            Write-Entry -Subtext "Skipping [$global:show_name - $global:SeasonEPNumber] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                        }
                        Else {
                            Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                            if ($global:BackgroundOnlyTextless) {
                                $episodetemp = New-Object psobject
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($global:FileNaming + " | " + $global:EPTitle)
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Episode'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($episode.RootFoldername)
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($episode.'Library Name')
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($episode.tmdbid) { $episode.tmdbid } Else { "false" })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($episode.tvdbid) { $episode.tvdbid } Else { "false" })
                                $episodetemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($episode.imdbid) { $episode.imdbid } Else { "false" })
                                switch -Wildcard ($global:FavProvider) {
                                    'TMDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                    'FANART' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                    'TVDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                    Default { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                }

                                # Export the array to a CSV file
                                $episodetemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $episodetemp.Type -title $($global:show_name + " | " + $episodetemp.Title) -Lib $episodetemp.LibraryName -DLSource $episodetemp.'Download Source' -lang $episodetemp.Language -favurl $episodetemp.'Fav Provider Link' -fallback $episodetemp.Fallback -Truncated $episodetemp.TextTruncated }
                            }

                        }

                    } else {
                        if ($global:UploadExistingAssets -eq 'true') {
                            if ($global:PlexTitleCardUrl -like "/library/*") {
                                $Arturl = $plexurl + $global:PlexTitleCardUrl
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                try {
                                    GetPlexArtwork -Type " $Titletext | $global:FileNaming Artwork." -ArtUrl $Arturl -TempImage $EpisodeImage
                                    if ($global:PlexartworkDownloaded -eq 'true') {
                                        Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                        
                                        # Verify variables before uploading
                                        Write-Entry -Subtext "EpisodeImage: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "RatingKey: $($global:episode_ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                        Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                        $uri = "$PlexUrl/library/metadata/$($global:episode_ratingkey)/posters"
                                        Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                        # Try uploading, capturing the response in detail
                                        $Upload = Invoke-WebRequest -Uri $uri `
                                            -Method Post `
                                            -Headers $extraPlexHeaders `
                                            -InFile $EpisodeImageoriginal `
-ContentType 'image/jpeg' `
                                            -SkipHttpErrorCheck `
                                            -ErrorAction Stop
    
                                        if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                            Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                            Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                        }
                                        else {
                                            Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                            Write-Entry -Subtext "$Titletext | TitleCard successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                            $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                        }
                                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                    }
                                }
                                catch {
                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                }
                            }
                            elseif ($global:episodeid) {
                                Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                UploadOtherMediaServerArtwork -itemId $global:episodeid -imageType "Primary" -imagePath $EpisodeImageoriginal
                            }
                            if (Test-Path $EpisodeImage -ErrorAction SilentlyContinue) {
                                Remove-Item -LiteralPath $EpisodeImage | Out-Null
                                Write-Entry -Message "Deleting Temp Image: $EpisodeImage" -Path $global:configLogging -Color White -log Info
                            }
                        }
                        Else {
                            if ($show_skipped -eq 'true' ) {
                                Write-Entry -Subtext "Already exists: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                            }
                        }
                    }
                }
            }
        }
                            if ($false) {
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
                                    $global:FallbackText = $null
                                    $global:ImageMagickError = $null
                                    $global:TextlessPoster = $null
                                    $global:posterurl = $null
                                    $Episodepostersearchtext = $null
                                    $ExifFound = $null
                                    $global:PlexartworkDownloaded = $null
                                    $value = $null
                                    $magickcommand = $null
                                    $Arturl = $null
                                    $TakeLocal = $null
                                    $LocalAssetMissing = $null
                                    $LocalAddOverlay = $AddTitleCardOverlay
                                    $LocalAddBorder = $AddTitleCardBorder
                                    if ($global:PlexTitleCardUrls.Count -gt $i -and $null -ne $global:PlexTitleCardUrls[$i]) { $global:PlexTitleCardUrl = $($global:PlexTitleCardUrls[$i].Trim()) } else { $global:PlexTitleCardUrl = $null }
                                    if ($global:episode_ratingkeys.Count -gt $i -and $null -ne $global:episode_ratingkeys[$i]) { $global:episode_ratingkey = $($global:episode_ratingkeys[$i].Trim()) } else { $global:episode_ratingkey = $null }
                                    if ($global:episode_ids.Count -gt $i -and $null -ne $global:episode_ids[$i]) { $global:episodeid = $($global:episode_ids[$i].Trim()) } else { $global:episodeid = $null }
                                    if ($global:episode_ids.Count -gt $i -and $null -ne $global:episode_ids[$i]) { $global:episodeid = $($global:episode_ids[$i].Trim()) } else { $global:episodeid = $null }
                                    if ($global:titles.Count -gt $i -and $null -ne $global:titles[$i]) { $global:EPTitle = $($global:titles[$i].Trim()) } else { $global:EPTitle = $null }
                                    if ($global:EPResolutions.Count -gt $i -and $null -ne $global:EPResolutions[$i]) { $global:EPResolution = $($global:EPResolutions[$i].Trim()) } else { $global:EPResolution = $null }
                                    if ($global:episode_numbers.Count -gt $i -and $null -ne $global:episode_numbers[$i]) { $global:episodenumber = $($global:episode_numbers[$i].Trim()) } else { $global:episodenumber = $null }
                                    if ([string]::IsNullOrWhiteSpace($global:episodenumber)) {
                                        Write-Entry -Subtext "Skipping title card entry at index [$i] because episode number is missing." -Path $global:configLogging -Color Yellow -log Warning
                                        continue
                                    }
                                    $seasonNumberText = [string]$global:season_number
                                    $episodeNumberText = [string]$global:episodenumber
                                    $global:FileNaming = "S" + $seasonNumberText.PadLeft(2, '0') + "E" + $episodeNumberText.PadLeft(2, '0')
                                    $bullet = [char]0x2022
                                    $global:SeasonEPNumber = "$SeasonTCText $global:season_number $bullet $EpisodeTCText $global:episodenumber"

                                    if ($LibraryFolders -eq 'true') {
                                        $EpisodeImageoriginal = "$EntryDir\$global:FileNaming.jpg"
                                        $TestPath = $EntryDir
                                        $ManualTestPath = $ManualEntryDir
                                        $Testfile = "$global:FileNaming"
                                        $TestfileTemplate = "EpisodeTemplate"
                                    }
                                    Else {
                                        if ($episode.extraFolder) {
                                            $EpisodeImageoriginal = "$AssetPath\$($episode.extraFolder)\$($episode.RootFoldername)_$global:FileNaming.jpg"
                                        }
                                        Else {
                                            $EpisodeImageoriginal = "$AssetPath\$($episode.RootFoldername)_$global:FileNaming.jpg"
                                        }
                                        $TestPath = $AssetPath
                                        $ManualTestPath = $ManualPath
                                        $Testfile = "$($episode.RootFoldername)_$global:FileNaming"
                                        $TestfileTemplate = "$($episode.RootFoldername)_EpisodeTemplate"
                                    }

                                    if ($Platform -eq 'Docker' -or $Platform -eq 'Linux' -or $Platform -eq 'macOS') {
                                        $hashtestpath = ($TestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                                        $EpisodeImageoriginal = ($EpisodeImageoriginal).Replace('\', '/').Replace('./', '/')
                                        $manualtestpath = ($ManualTestPath + "/" + $Testfile).Replace('\', '/').Replace('./', '/')
                                        $Templatetestpath = ($ManualEntryDir + "/" + $TestfileTemplate).Replace('\', '/').Replace('./', '/')
                                    }
                                    else {
                                        $fullTestPath = Resolve-Path -Path $TestPath -ErrorAction SilentlyContinue
                                        $fullManualTestPath = Resolve-Path -Path $ManualTestPath -ErrorAction SilentlyContinue
                                        if ($fullTestPath) {
                                            $hashtestpath = ($fullTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                                            $Manualtestpath = ($fullManualTestPath.ProviderPath + "\" + $Testfile).Replace('/', '\')
                                            $Templatetestpath = ($fullManualTestPath.ProviderPath + "\" + $TestfileTemplate).Replace('/', '\')
                                        }
                                        Else {
                                            $hashtestpath = ($TestPath + "\" + $Testfile).Replace('/', '\')
                                            $Manualtestpath = ($ManualTestPath + "\" + $Testfile).Replace('/', '\')
                                            $Templatetestpath = ($ManualEntryDir + "\" + $TestfileTemplate).Replace('/', '\')
                                        }
                                    }

                                    $EpisodeImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$($episode.RootFoldername)_$global:FileNaming.jpg"
                                    $EpisodeImage = $EpisodeImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
                                    $cjkTitlePattern = '[\p{IsHiragana}\p{IsKatakana}\p{IsCJKUnifiedIdeographs}\p{IsThai}]'

                                    # Pre-check the title against skipwords
                                    $matchedWord = $null
                                    foreach ($word in $SkipWords) {
                                        if ($word -match '^/(.+)/$') {
                                            if ($global:EPTitle -match $matches[1]) {
                                                $matchedWord = $word
                                                break # Stop checking once we find a match
                                            }
                                        } else {
                                            if ($global:EPTitle -match "^$([regex]::Escape($word))") {
                                                $matchedWord = $word
                                                break # Stop checking once we find a match
                                            }
                                        }
                                    }

                                    if ($SkipTBA -eq 'true' -and $matchedWord) {
                                        Write-Entry -Subtext "Skipping $global:FileNaming of $global:show_name because Title matches '$matchedWord'" -Path $global:configLogging -Color Yellow -log Warning
                                        $SkipTBACount++
                                    }
                                    Elseif ($SkipJapTitle -eq 'true' -and $global:EPTitle -match $cjkTitlePattern) {
                                        Write-Entry -Subtext "Skipping $global:FileNaming of $global:show_name because Title contains Jap/Chinese Chars" -Path $global:configLogging -Color Yellow -log Warning
                                        $SkipJapTitleCount++
                                    }
                                    Else {
                                        $checkedItems.Add($hashtestpath)

                                        if (-not $directoryHashtable.ContainsKey("$hashtestpath")) {
                                            $Arturl = $null
                                            if ($global:PlexTitleCardUrl -like "/library/*") {
                                                $Arturl = $plexurl + $global:PlexTitleCardUrl
                                            }
                                            foreach ($ext in @('.jpg', '.jpeg', '.png', '.webp', '.bmp')) {
                                                $manualFile = "$ManualTestPath$ext"
                                                $templateFile = "$Templatetestpath$ext"
                                                $filePath = $null

                                                if (Test-Path -LiteralPath $manualFile) {
                                                    $filePath = $manualFile
                                                }
                                                elseif (Test-Path -LiteralPath $templateFile) {
                                                    $filePath = $templateFile
                                                }

                                                if ($filePath) {
                                                    Write-Entry -Message "Local file exists: $filePath" -Path $global:configLogging -Color Cyan -log Debug
                                                    $posterext = $ext
                                                    break
                                                }
                                            }
                                            if ((Test-Path -LiteralPath "$($Manualtestpath)$posterext") -and $Manualtestpath -ne '\') {
                                                Write-Entry -Message "Found Manual Title Card for: $global:show_name - $global:SeasonEPNumber" -Path $global:configLogging -Color White -log Info
                                                $TakeLocal = $true
                                            }
                                            elseif ((Test-Path -LiteralPath "$($Templatetestpath)$posterext") -and $Templatetestpath -ne '\') {
                                                Write-Entry -Message "Found Template Poster..." -Path $global:configLogging -Color White -log Info
                                                $ManualTestPath = $Templatetestpath
                                                $TakeLocal = $true
                                            }
                                            Elseif ($global:DisableOnlineAssetFetch -eq 'true' -or $global:DisableOnlineTitleCardFetch -eq 'true') {
                                                $LocalAssetMissing = 'true'
                                            }
                                            Else {
                                                if (!$Episodepostersearchtext) {
                                                    Write-Entry -Message "Start Title Card Search for: $global:show_name - $global:SeasonEPNumber" -Path $global:configLogging -Color White -log Info
                                                    $Episodepostersearchtext = $true
                                                }
                                                # now search for TitleCards
                                                if ($global:FavProvider -eq 'TMDB') {
                                                    if ($episode.tmdbid) {
                                                        $global:posterurl = GetTMDBTitleCard
                                                        if (!$global:posterurl) {
                                                            $global:IsFallback = $true
                                                            $global:posterurl = GetTVDBTitleCard
                                                            if ($global:posterurl) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        if (!$global:posterurl) {
                                                            $global:IsFallback = $true
                                                            if ($ArtUrl) {
                                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                                            }
                                                            Else {
                                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                                            }
                                                            if (!$global:posterurl) {
                                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                            }
                                                        }
                                                        if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                                            # Lets just try to grab a background poster.
                                                            Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:posterurl = GetTMDBShowBackground
                                                            if ($global:posterurl) {
                                                                Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                                $global:IsFallback = $true
                                                                $global:FallbackText = 'True-Background'
                                                            }
                                                            Else {
                                                                # Lets just try to grab a background poster.
                                                                $global:posterurl = GetTVDBShowBackground
                                                                if ($global:posterurl) {
                                                                    Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                                    $global:IsFallback = $true
                                                                    $global:FallbackText = 'True-Background'
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        Write-Entry -Subtext "Can't search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                                        $global:posterurl = GetTVDBTitleCard
                                                        if (!$global:posterurl) {
                                                            $global:IsFallback = $true
                                                            if ($ArtUrl) {
                                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                                            }
                                                            Else {
                                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                                            }
                                                            if (!$global:posterurl) {
                                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                            }
                                                        }
                                                        if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                                            Write-Entry -Subtext "No Title Cards for this Episode on TVDB or TMDB..." -Path $global:configLogging -Color Red -log Error
                                                            # Lets just try to grab a background poster.
                                                            Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:posterurl = GetTVDBShowBackground
                                                            if ($global:posterurl) {
                                                                Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                                $global:IsFallback = $true
                                                                $global:FallbackText = 'True-Background'
                                                            }
                                                        }
                                                    }
                                                }
                                                Else {
                                                    if ($episode.tvdbid) {
                                                        $global:posterurl = GetTVDBTitleCard
                                                        if (!$global:posterurl -or $global:Fallback -eq "TMDB") {
                                                            $global:posterurl = GetTMDBTitleCard
                                                            if ($global:FavProvider -ne 'TMDB' -and $global:posterurl) {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        if (!$global:posterurl) {
                                                            $global:IsFallback = $true
                                                            if ($ArtUrl) {
                                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                                            }
                                                            Else {
                                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                                            }
                                                            if (!$global:posterurl) {
                                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                            }
                                                        }
                                                        if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                                            # Lets just try to grab a background poster.
                                                            Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:posterurl = GetTVDBShowBackground
                                                            if ($global:posterurl) {
                                                                Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                                $global:IsFallback = $true
                                                                $global:FallbackText = 'True-Background'
                                                            }
                                                            Else {
                                                                # Lets just try to grab a background poster.
                                                                $global:posterurl = GetTMDBShowBackground
                                                                if ($global:posterurl) {
                                                                    Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                                    $global:IsFallback = $true
                                                                    $global:FallbackText = 'True-Background'
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        Write-Entry -Subtext "Can't search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
                                                        $global:posterurl = GetTMDBTitleCard
                                                        if ($global:FavProvider -ne 'TMDB' -and $global:posterurl) {
                                                            $global:IsFallback = $true
                                                        }
                                                        if (!$global:posterurl) {
                                                            $global:IsFallback = $true
                                                            if ($ArtUrl) {
                                                                GetPlexArtwork -Type ": $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card" -ArtUrl $ArtUrl -TempImage $EpisodeImage
                                                            }
                                                            Else {
                                                                Write-Entry -Subtext "Plex TitleCard Url empty, cannot search on plex, likely there is no artwork on plex..." -Path $global:configLogging -Color Yellow -log Warning
                                                            }
                                                            if (!$global:posterurl) {
                                                                Write-Entry -Subtext "Could not find a TitleCard on any site" -Path $global:configLogging -Color Red -log Error
                                                            }
                                                        }
                                                        if (!$global:posterurl -and $BackgroundFallback -eq 'true') {
                                                            # Lets just try to grab a background poster.
                                                            Write-Entry -Subtext "Fallback to Show Background..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:posterurl = GetTMDBShowBackground
                                                            if ($global:posterurl) {
                                                                Write-Entry -Subtext "Using the Show Background Poster as TitleCard Fallback..." -Path $global:configLogging -Color Yellow -log Warning
                                                                $global:IsFallback = $true
                                                                $global:FallbackText = 'True-Background'
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            if ($global:posterurl -or $global:PlexartworkDownloaded -or $TakeLocal) {
                                                $global:IsTruncated = $null
                                                if ($global:ForceTextAssetRestoration -ne $null) {
                                                    if ($global:ForceTextAssetRestoration -eq '$global:PosterPreferTextless') {
                                                        $global:PosterPreferTextless = $global:OriginalPreferTextless
                                                        $global:PosterOnlyTextless = $global:OriginalOnlyTextless
                                                        if ($null -ne $global:OriginalPreferredLanguageOrder) {
                                                            $global:PreferredLanguageOrder = $global:OriginalPreferredLanguageOrder
                                                            Initialize-LanguageSettings -SettingName "PreferredLanguageOrder" -Label "Poster" -Default $global:OriginalPreferredLanguageOrder
                                                            $global:OriginalPreferredLanguageOrder = $null
                                                        }
                                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:BackgroundPreferTextless') {
                                                        $global:BackgroundPreferTextless = $global:OriginalPreferTextless
                                                        $global:BackgroundOnlyTextless = $global:OriginalOnlyTextless
                                                        if ($null -ne $global:OriginalPreferredBackgroundLanguageOrder) {
                                                            $global:PreferredBackgroundLanguageOrder = $global:OriginalPreferredBackgroundLanguageOrder
                                                            Initialize-LanguageSettings -SettingName "PreferredBackgroundLanguageOrder" -Label "Background" -Default $global:OriginalPreferredBackgroundLanguageOrder
                                                            $global:OriginalPreferredBackgroundLanguageOrder = $null
                                                        }
                                                    } elseif ($global:ForceTextAssetRestoration -eq '$global:SeasonPosterPreferTextless') {
                                                        $global:SeasonPosterPreferTextless = $global:OriginalPreferTextless
                                                        $global:SeasonPosterOnlyTextless = $global:OriginalOnlyTextless
                                                        if ($null -ne $global:OriginalPreferredSeasonLanguageOrder) {
                                                            $global:PreferredSeasonLanguageOrder = $global:OriginalPreferredSeasonLanguageOrder
                                                            Initialize-LanguageSettings -SettingName "PreferredSeasonLanguageOrder" -Label "SeasonPoster" -Default $global:OriginalPreferredSeasonLanguageOrder
                                                            $global:OriginalPreferredSeasonLanguageOrder = $null
                                                        }
                                                    }
                                                    $global:ForceTextAssetRestoration = $null
                                                }
                                                if ($global:ImageProcessing -eq 'true') {
                                                    if ($TakeLocal) {
                                                        Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                                            Copy-Item -LiteralPath $_.FullName -Destination $EpisodeImage | Out-Null
                                                        }
                                                        if ($SkipLocalTCTextAdd -eq 'true') {
                                                            $SkippingText = 'true'
                                                        }
                                                        Write-Entry -Subtext "Copy local asset to: $EpisodeImage" -Path $global:configLogging -Color Green -log Info
                                                    }
                                                    Else {
                                                        try {
                                                            if (!$global:PlexartworkDownloaded) {
                                                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                                            }
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
                                                        Write-Entry -Subtext "Title Card url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                                        if ($global:posterurl -like 'https://image.tmdb.org*') {
                                                            Write-Entry -Subtext "Downloading Title Card from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                                            if ($global:FavProvider -ne 'TMDB') {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        if ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                                            Write-Entry -Subtext "Downloading Title Card from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                                            if ($global:FavProvider -ne 'TVDB') {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        if ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                                            Write-Entry -Subtext "Downloading Title Card from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                                            if ($global:FavProvider -ne 'PLEX') {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                    }
                                                    if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                                        $CommentArguments = "`"$EpisodeImage`" -set `"comment`" `"created with posterizarr`" `"$EpisodeImage`""
                                                        $CommentlogEntry = "`"$magick`" $CommentArguments"
                                                        $CommentlogEntry | Write-MagickLog
                                                        InvokeMagickCommand -Command $magick -Arguments $CommentArguments
                                                        if ($global:ImageMagickError -ne 'true') {
                                                            if ($UseTCResolutionOverlays -eq 'true') {
                                                                switch ($global:EPResolution) {
                                                                    '4K DoVi/HDR10' { $TitleCardoverlay = $4KDoViHDR10TC }
                                                                    '4K DoVi' { $TitleCardoverlay = $4KDoViTC }
                                                                    '4K HDR10' { $TitleCardoverlay = $4KHDR10TC }
                                                                    '4K' { $TitleCardoverlay = $4kTC }
                                                                    '1080p' { $TitleCardoverlay = $1080pTC }
                                                                    Default { $TitleCardoverlay = $DefaultTitleCardoverlay }
                                                                }
                                                            }
                                                            Else {
                                                                $TitleCardoverlay = $DefaultTitleCardoverlay
                                                            }
                                                            $settings = Get-OverlayAndBorderSettings -AddBorder $LocalAddBorder -AddOverlay $LocalAddOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                                                            $LocalAddBorder = $settings.Border
                                                            $LocalAddOverlay = $settings.Overlay
                                                            # Resize Image to 2000x3000 and apply Border and overlay
                                                            if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$TitleCardoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$EpisodeImage`""
                                                                Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                                            }
                                                            elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$EpisodeImage`""
                                                                Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                                                            }
                                                            elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$TitleCardoverlay`" -gravity south -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                                Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                                                            }
                                                            else {
                                                                $Arguments = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$EpisodeImage`""
                                                                Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                                                            }
                                                            $logEntry = "`"$magick`" $Arguments"
                                                            $logEntry | Write-MagickLog
                                                            InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                            $SkippingText = Get-SkipTextSetting -SkipAddText $SkipAddText -SkipAddTextAndOverlay $SkipAddTextAndOverlay -PosterWithText $global:PosterWithText
                                                            if ($SkippingText -eq 'true') {
                                                                Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
                                                            }
                                                            if ($AddTitleCardEPTitleText -eq 'true' -and $SkippingText -eq 'false') {
                                                                if ($TitleCardEPTitlefontAllCaps -eq 'true') {
                                                                    $global:EPTitle = $global:EPTitle.ToUpper()
                                                                }
                                                                $global:EPTitle = $global:EPTitle -replace 'â€ž', '"' -replace 'â€', '"' -replace 'â€œ', '"' -replace '"', '""' -replace '`', ''
                                                                if ($global:direction -eq "RTL") {
                                                                    $TitleCardfontImagemagick = $RTLfontImagemagick
                                                                }
                                                                # Loop through each symbol and replace it with a newline
                                                                if ($NewLineOnSpecificSymbols -eq 'true') {
                                                                    foreach ($symbol in $NewLineSymbols) {
                                                                        # Replace the symbol with a newline
                                                                        $replacementString = "`n"

                                                                        # Check if the symbol should be kept
                                                                        $keepThisSymbol = $false
                                                                        if ($null -ne $SymbolsToKeepOnNewLine) {
                                                                            # Loop through all items in $SymbolsToKeepOnNewLine (in case it's an array like [':', '!'])
                                                                            foreach ($k in $SymbolsToKeepOnNewLine) {
                                                                                # Check if the $symbol (e.g., ": ") contains the $k character (e.g., ":")
                                                                                if ($symbol -like "*$k*") {
                                                                                    $keepThisSymbol = $true
                                                                                    break # Match found, no need to keep checking
                                                                                }
                                                                            }
                                                                        }

                                                                        # If it's a "keep" symbol, change the replacement string
                                                                        if ($keepThisSymbol) {
                                                                            # Replace ": " with ": \n" (keeps the symbol, adds newline after)
                                                                            $replacementString = $symbol + "`n"
                                                                        }
                                                                        $global:EPTitle = $global:EPTitle -replace [regex]::Escape($symbol), $replacementString
                                                                    }
                                                                }
                                                                if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                                                                    $properties = $NewLineWords.PSObject.Properties.Name

                                                                    # Check if properties exist and the list is not empty
                                                                    if ($null -ne $properties -and $properties.Count -gt 0) {
                                                                        foreach ($wordKey in $properties) {
                                                                            $replacementValue = $NewLineWords.$wordKey

                                                                            # Using [regex]::Escape handles any special characters in the word keys
                                                                            $global:EPTitle = $global:EPTitle -replace [regex]::Escape($wordKey), $replacementValue
                                                                        }
                                                                    }
                                                                }
                                                                $joinedTitlePointSize = $global:EPTitle -replace '""', '""""' -replace '`', ''
                                                                $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPTitleMaxWidth  -box_height $TitleCardEPTitleMaxHeight -min_pointsize $TitleCardEPTitleminPointSize -max_pointsize $TitleCardEPTitlemaxPointSize -lineSpacing $TitleCardEPTitlelineSpacing
                                                                if ($global:IsTruncated -ne $true) {
                                                                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                                    # Add Stroke
                                                                    if ($AddTitleCardEPTitleTextStroke -eq 'true') {
                                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPTitleboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlestrokecolor`" -stroke `"$TitleCardEPTitlestrokecolor`" -strokewidth `"$TitleCardEPTitlestrokewidth`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -stroke none -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                                    }
                                                                    Else {
                                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$global:EPTitle`" -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                                    }

                                                                    Write-Entry -Subtext "Applying EPTitle text: `"$global:EPTitle`"" -Path $global:configLogging -Color White -log Info
                                                                    $logEntry = "`"$magick`" $Arguments"
                                                                    $logEntry | Write-MagickLog
                                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                                }
                                                            }
                                                            if ($AddTitleCardEPText -eq 'true' -and $SkippingText -eq 'false') {
                                                                if ($TitleCardEPfontAllCaps -eq 'true') {
                                                                    $global:SeasonEPNumber = $global:SeasonEPNumber.ToUpper()
                                                                }
                                                                $global:SeasonEPNumber = $global:SeasonEPNumber -replace 'â€ž', '"' -replace 'â€', '"' -replace 'â€œ', '"' -replace '"', '""' -replace '`', ''
                                                                $joinedTitlePointSize = $global:SeasonEPNumber -replace '""', '""""'
                                                                $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPMaxWidth  -box_height $TitleCardEPMaxHeight -min_pointsize $TitleCardEPminPointSize -max_pointsize $TitleCardEPmaxPointSize -lineSpacing $TitleCardEPlineSpacing
                                                                if ($global:IsTruncated -ne $true) {
                                                                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                                                                    # Add Stroke
                                                                    if ($AddTitleCardTextStroke -eq 'true') {
                                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardstrokecolor`" -stroke `"$TitleCardstrokecolor`" -strokewidth `"$TitleCardstrokewidth`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPfontcolor`" -stroke none -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                                    }
                                                                    Else {
                                                                        $Arguments = "`"$EpisodeImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPfontcolor`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$global:SeasonEPNumber`" -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$EpisodeImage`""
                                                                    }

                                                                    Write-Entry -Subtext "Applying SeasonEPNumber text: `"$global:SeasonEPNumber`"" -Path $global:configLogging -Color White -log Info
                                                                    $logEntry = "`"$magick`" $Arguments"
                                                                    $logEntry | Write-MagickLog
                                                                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                Else {
                                                    if ($TakeLocal) {
                                                        Get-ChildItem -LiteralPath "$($ManualTestPath)$posterext" | ForEach-Object {
                                                            Copy-Item -LiteralPath $_.FullName -Destination $EpisodeImage | Out-Null
                                                        }
                                                        if ($SkipLocalTCTextAdd -eq 'true') {
                                                            $SkippingText = 'true'
                                                        }
                                                        Write-Entry -Subtext "Copy local asset to: $EpisodeImage" -Path $global:configLogging -Color Green -log Info
                                                    }
                                                    Else {
                                                        try {
                                                            if (!$global:PlexartworkDownloaded) {
                                                                $response = Invoke-WebRequest -Uri $global:posterurl -OutFile $EpisodeImage -TimeoutSec 30 -Headers $extraPlexHeaders -ErrorAction Stop
                                                            }
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
                                                        Write-Entry -Subtext "Title Card url: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color White -log Info
                                                        if ($global:posterurl -like 'https://image.tmdb.org*') {
                                                            Write-Entry -Subtext "Downloading Title Card from 'TMDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:AssetTextLang = $global:TMDBAssetTextLang
                                                            if ($global:FavProvider -ne 'TMDB') {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        if ($global:posterurl -like 'https://artworks.thetvdb.com*') {
                                                            Write-Entry -Subtext "Downloading Title Card from 'TVDB'" -Path $global:configLogging -Color DarkMagenta -log Info
                                                            $global:AssetTextLang = $global:TVDBAssetTextLang
                                                            if ($global:FavProvider -ne 'TVDB') {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                        if ($PlexUrl -and $global:posterurl -like "$PlexUrl*") {
                                                            Write-Entry -Subtext "Downloading Title Card from 'Plex'" -Path $global:configLogging -Color DarkMagenta -log Info
                                                            if ($global:FavProvider -ne 'PLEX') {
                                                                $global:IsFallback = $true
                                                            }
                                                        }
                                                    }
                                                    if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                                        # Resize Image to 2000x3000
                                                        $Resizeargument = "`"$EpisodeImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$EpisodeImage`""
                                                        Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
                                                        $logEntry = "`"$magick`" $Resizeargument"
                                                        $logEntry | Write-MagickLog
                                                        InvokeMagickCommand -Command $magick -Arguments $Resizeargument
                                                    }
                                                }
                                                if ($global:ImageMagickError -ne 'true') {
                                                    if (Get-ChildItem -LiteralPath $EpisodeImage -ErrorAction SilentlyContinue) {
                                                        # Move file back to original naming with Brackets.
                                                        if ($global:IsTruncated -ne $true) {
                                                            if ($UseOtherMediaServer -eq 'true' -and $global:episodeid) {
                                                                Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $($global:episodeid)" -Path $global:configLogging -Color Cyan -log Debug
                                                                UploadOtherMediaServerArtwork -itemId $global:episodeid -imageType "Primary" -imagePath $EpisodeImage
                                                            }
                                                            if ($Upload2Plex -eq 'true') {
                                                                try {
                                                                    Write-Entry -Subtext "Uploading Artwork to Plex..." -Path $global:configLogging -Color DarkMagenta -log Info
                                                                    
                                                                    # Verify variables before uploading
                                                                    Write-Entry -Subtext "EpisodeImage: $EpisodeImage" -Path $global:configLogging -Color Cyan -log Debug
                                                                    Write-Entry -Subtext "RatingKey: $($global:episode_ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                                    Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug

                                                                    $uri = "$PlexUrl/library/metadata/$($global:episode_ratingkey)/posters"
                                                                    Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                                    # Try uploading, capturing the response in detail
                                                                    $Upload = Invoke-WebRequest -Uri $uri `
                                                                        -Method Post `
                                                                        -Headers $extraPlexHeaders `
                                                                        -InFile $EpisodeImage `
-ContentType 'image/jpeg' `
                                                                        -SkipHttpErrorCheck `
                                                                        -ErrorAction Stop

                                                                    if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                                        Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                                        Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                                    }
                                                                    else {
                                                                        Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                                        Write-Entry -Subtext "$Titletext | TitleCard successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                                        $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                                                    }
                                                                }
                                                                catch {
                                                                    Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error

                                                                    $global:errorCount = Increment-GlobalStat 'errorCount'
                                                                    Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                                                }
                                                            }
                                                            try {
                                                                $EpisodeTargetDir = Split-Path -Path $EpisodeImageoriginal -Parent
                                                                if ($EpisodeTargetDir -and -not (Test-Path -LiteralPath $EpisodeTargetDir)) {
                                                                    New-Item -ItemType Directory -Path $EpisodeTargetDir -Force | Out-Null
                                                                }
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
                                                        Else {
                                                            Write-Entry -Subtext "Skipping asset move because text is truncated..." -Path $global:configLogging -Color Yellow -log Warning
                                                        }
                                                        $episodetemp = New-Object psobject
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($global:FileNaming + " | " + $global:EPTitle)
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Episode'
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($episode.RootFoldername)
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($episode.'Library Name')
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Language" -Value $(if ($TakeLocal) { "false" } Else { if (!$global:AssetTextLang) { "Textless" }Else { $global:AssetTextLang } })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo Source" -Value  $(if ($global:LogoUrl) { $global:LogoUrl } Else { "false" })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo Language" -Value $(if ($global:LogoLanguage) { $global:LogoLanguage } Else { "false" })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Logo TextFallback" -Value $(if ($ApplyTextInsteadOfLogo) { $ApplyTextInsteadOfLogo } Else { "false" })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value $(if ($global:IsFallback -and $global:FallbackText) { $global:FallbackText } elseif ($global:IsFallback -and !$global:FallbackText) { 'true' } Else { 'false' })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $(if ($TakeLocal) { $EpisodeImage } Else { $global:posterurl })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($episode.tmdbid) { $episode.tmdbid } Else { "false" })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($episode.tvdbid) { $episode.tvdbid } Else { "false" })
                                                        $episodetemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($episode.imdbid) { $episode.imdbid } Else { "false" })
                                                        switch -Wildcard ($global:FavProvider) {
                                                            'TMDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                                            'FANART' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                                            'TVDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                                            Default { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                                        }
                                                        # Export the array to a CSV file
                                                        $episodetemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                                        if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $episodetemp.Type -title $($global:show_name + " | " + $episodetemp.Title) -Lib $episodetemp.LibraryName -DLSource $episodetemp.'Download Source' -lang $episodetemp.Language -favurl $episodetemp.'Fav Provider Link' -fallback $episodetemp.Fallback -Truncated $episodetemp.TextTruncated }
                                                    }
                                                }
                                            }
                                            Elseif ($LocalAssetMissing -eq 'true') {
                                                Write-Entry -Subtext "Skipping [$global:show_name - $global:SeasonEPNumber] - local asset missing and online fetch is disabled." -Path $global:configLogging -Color Yellow -log Warning
                                            }
                                            Else {
                                                Write-Entry -Subtext "--------------------------------------------------------------------------------" -Path $global:configLogging  -Color White -log Info
                                                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                                if ($global:BackgroundOnlyTextless) {
                                                    $episodetemp = New-Object psobject
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $($global:FileNaming + " | " + $global:EPTitle)
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Type" -Value 'Episode'
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $($episode.RootFoldername)
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $($episode.'Library Name')
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value 'false'
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value $(if ($TakeLocal) { "true" } Else { "false" })
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value $(if ($episode.tmdbid) { $episode.tmdbid } Else { "false" })
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value $(if ($episode.tvdbid) { $episode.tvdbid } Else { "false" })
                                                    $episodetemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value $(if ($episode.imdbid) { $episode.imdbid } Else { "false" })
                                                    switch -Wildcard ($global:FavProvider) {
                                                        'TMDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TMDBAssetChangeUrl) { $global:TMDBAssetChangeUrl }Else { "false" }) }
                                                        'FANART' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:FANARTAssetChangeUrl) { $global:FANARTAssetChangeUrl }Else { "false" }) }
                                                        'TVDB' { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value $(if ($global:TVDBAssetChangeUrl) { $global:TVDBAssetChangeUrl }Else { "false" }) }
                                                        Default { $episodetemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false' }
                                                    }

                                                    # Export the array to a CSV file
                                                    $episodetemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append
                                                    if ($Mode -in @('tautulli', 'arr')) { SendMessage -type $episodetemp.Type -title $($global:show_name + " | " + $episodetemp.Title) -Lib $episodetemp.LibraryName -DLSource $episodetemp.'Download Source' -lang $episodetemp.Language -favurl $episodetemp.'Fav Provider Link' -fallback $episodetemp.Fallback -Truncated $episodetemp.TextTruncated }
                                                }

                                            }

                                        } else {
                                            if ($global:UploadExistingAssets -eq 'true') {
                                                if ($global:PlexTitleCardUrl -like "/library/*") {
                                                    $Arturl = $plexurl + $global:PlexTitleCardUrl
                                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                                    try {
                                                        GetPlexArtwork -Type " $Titletext | $global:FileNaming Artwork." -ArtUrl $Arturl -TempImage $EpisodeImage
                                                        if ($global:PlexartworkDownloaded -eq 'true') {
                                                            Write-Entry -Subtext "Uploading Existing Artwork for: $Titletext" -Path $global:configLogging -Color White -log Info
                                                            
                                                            # Verify variables before uploading
                                                            Write-Entry -Subtext "EpisodeImage: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Debug
                                                            Write-Entry -Subtext "RatingKey: $($global:episode_ratingkey)" -Path $global:configLogging -Color Cyan -log Debug
                                                            Write-Entry -Subtext "File size: $($fileContent.Length) bytes" -Path $global:configLogging -Color Cyan -log Debug
    
                                                            $uri = "$PlexUrl/library/metadata/$($global:episode_ratingkey)/posters"
                                                            Write-Entry -Subtext "Upload URI: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                                                            # Try uploading, capturing the response in detail
                                                            $Upload = Invoke-WebRequest -Uri $uri `
                                                                -Method Post `
                                                                -Headers $extraPlexHeaders `
                                                                -InFile $EpisodeImageoriginal `
-ContentType 'image/jpeg' `
                                                                -SkipHttpErrorCheck `
                                                                -ErrorAction Stop
    
                                                            if ($Upload.StatusCode -ne 200 -and $Upload.StatusCode -ne 201) {
                                                                Write-Entry -Subtext "Upload failed: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color Red -log Error
                                                                Write-Entry -Subtext "Response body:`n$($Upload.Content)" -Path $global:configLogging -Color Cyan-log Debug
                                                            }
                                                            else {
                                                                Write-Entry -Subtext "Upload OK: HTTP $($Upload.StatusCode)" -Path $global:configLogging -Color White -log Debug
                                                                Write-Entry -Subtext "$Titletext | TitleCard successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                                                                $null = Increment-GlobalStat 'PlexChildArtworkUploads'
                                                            }
                                                            $global:UploadCount = Increment-GlobalStat 'UploadCount'
                                                        }
                                                    }
                                                    catch {
                                                        Write-Entry -Subtext "Invoke-WebRequest failed at transport level: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
    
                                                        $global:errorCount = Increment-GlobalStat 'errorCount'
                                                        Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                                                    }
                                                }
                                                elseif ($global:episodeid) {
                                                    Write-Entry -Message "Starting Existing Asset Upload..." -Path $global:configLogging -Color Green -log Info
                                                    Write-Entry -Subtext "Searching for $Titletext Artwork on Media Server." -Path $global:configLogging -Color Cyan -log Info
                                                    UploadOtherMediaServerArtwork -itemId $global:episodeid -imageType "Primary" -imagePath $EpisodeImageoriginal
                                                }
                                                if (Test-Path $EpisodeImage -ErrorAction SilentlyContinue) {
                                                    Remove-Item -LiteralPath $EpisodeImage | Out-Null
                                                    Write-Entry -Message "Deleting Temp Image: $EpisodeImage" -Path $global:configLogging -Color White -log Info
                                                }
                                            }
                                            Else {
                                                if ($show_skipped -eq 'true' ) {
                                                    Write-Entry -Subtext "Already exists: $EpisodeImageoriginal" -Path $global:configLogging -Color Cyan -log Info
                                                }
                                            }
                                        }
                                    }
                                }
                            }
    }
    catch {
        Write-Entry -Subtext "Error in TitleCard creation for $($episode.'Show Name') S$($episode.'Season Number') at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        $global:errorCount = Increment-GlobalStat 'errorCount'
    }
}
