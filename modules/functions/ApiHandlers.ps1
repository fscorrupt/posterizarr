function GetTMDBLogo {
    param(
        [string]$Type
    )
    if ($global:tmdbid) {
        Write-Entry -Subtext "Searching on TMDB for a Logo - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/$Type/$($global:tmdbid)?append_to_response=images&language=$($global:LogoLanguageOrderTMDB[0])&include_image_language=$($global:LogoLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
        }
        if ($response) {
            if ($response.images.logos) {
                foreach ($lang in $global:LogoLanguageOrderTMDB) {
                    if ($lang -ne 'null' -and $lang -ne 'xx') {
                        if ($global:UseClearlogo -eq 'true') {
                            $FavPoster = ($response.images.logos | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }

                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:LogoUrl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -ne 'null' -and $lang -ne 'xx') {
                            Write-Entry -Subtext "Found Logo with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                        }
                        $global:LogoLanguage = $lang
                        return $global:LogoUrl
                        continue
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No Logo found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error

        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetTVDBLogo {
    param(
        [string]$Type
    )
    if ($global:tvdbid) {
        Write-Entry -Subtext "Searching on TVDB for a Logo - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
        try {
            if ($type -eq 'series') {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/$Type/$($global:tvdbid)/artworks" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            Else {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/$Type/$($global:tvdbid)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
        }
        catch {
            Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
        }
        if ($response) {
            if ($response.data) {
                foreach ($lang in $global:LogoLanguageOrderTVDB) {
                    if ($lang -ne 'null') {
                        if ($global:UseClearart -eq 'true') {
                            if ($Type -eq 'series') {
                                $global:tvdblogo = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '22' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $global:tvdblogo = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '24' } | Sort-Object Score -Descending)
                            }
                        }
                        elseif ($global:UseClearlogo -eq 'true') {
                            if ($Type -eq 'series') {
                                $global:tvdblogo = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '23' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $global:tvdblogo = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '25' } | Sort-Object Score -Descending)
                            }
                        }
                    }

                    if ($global:tvdblogo) {
                        $global:LogoUrl = $global:tvdblogo[0].image
                        Write-Entry -Subtext "Found Logo with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                        $global:LogoLanguage = $lang
                        return $global:LogoUrl
                        continue
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No Logo found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
            }
        }
        Else {
            Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetFanartLogo {
    param(
        [string]$Type
    )
    if (-not $global:FanartTvAPIKey) { return }
    $global:Fallback = $null
    Write-Entry -Subtext "Searching on Fanart.tv for a Logo" -Path $global:configLogging -Color Cyan -log Info
    $ids = @($global:tmdbid, $global:imdbid)
    $entrytemp = $null

    foreach ($id in $ids) {
        if (-not $id) { continue }
        try {
            if ($type -eq 'tv') {
                $entrytemp = Get-FanartTvshow -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            }
            Elseif ($type -eq 'movies') {
                $entrytemp = Get-FanartTvmovie -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            }
        } catch {

            Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning

            $entrytemp = $null

        }
        if (-not $entrytemp) { continue }

        $field = if ($global:UseClearart -eq 'true') {
            if ($Type -eq 'tv') { "hdclearart" } else { "hdmovieclearart" }
        }
        elseif ($global:UseClearlogo -eq 'true') {
            if ($Type -eq 'tv') { "hdtvlogo" } else { "hdmovielogo" }
        }

        if ($field -and $entrytemp.$field) {
            foreach ($lang in $global:LogoLanguageOrderFanart) {
                $matchedLogos = $entrytemp.$field | Where-Object { $_.lang -eq $lang }

                if ($matchedLogos) {
                    $global:LogoUrl = $matchedLogos[0].url
                    $global:LogoLanguage = $lang
                    Write-Entry -Subtext "Found $field with Language '$lang' on FANART" -Path $global:configLogging -Color Blue -log Info
                    return $global:LogoUrl
                }
            }
        }
    }
    if ($null -eq $ids[0] -and $null -eq $ids[1]) {
        Write-Entry -Subtext "Cannot search on FANART, missing IDs..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if (!$global:LogoUrl) {
        Write-Entry -Subtext "No match/logo found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
    }
    Else {
        return $global:LogoUrl
    }
}
function GetTMDBMoviePoster {
    Write-Entry -Subtext "Searching on TMDB for a movie poster - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
    if (!$global:tmdbid) {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if ($global:PosterPreferTextless -eq $true) {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/movie/$($global:tmdbid)?append_to_response=images&language=xx&include_image_language=$($global:PreferredLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"

        }
        if ($response) {
            if ($response.images.posters) {
                if ($global:WidthHeightFilter -eq 'true') {
                    $NoLangPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                    $NoLangPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                }
                Else {
                    $NoLangPoster = ($response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                }
                if (!$NoLangPoster) {
                    Write-Entry -Subtext "PreferTextless Value: $global:PosterPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "OnlyTextless Value: $global:PosterOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                    if ($global:PosterOnlyTextless -eq $false) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.images.posters | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                    Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                            Else {
                                $filteredPosters = $response.images.posters

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }
                        Else {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.images.posters

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                }
                            }
                            Else {
                                $filteredPosters = $response.images.posters

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                }
                            }
                        }
                        if ($posterpath) {
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            if ($global:FavProvider -eq 'TMDB') {
                                $global:Fallback = "fanart"
                                $global:tmdbfallbackposterurl = $global:posterurl
                            }
                            Write-Entry -Subtext "Found Poster with text on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $global:TMDBAssetTextLang = $response.images.posters[0].iso_639_1
                            }
                            Else {
                                $global:TMDBAssetTextLang = (($response.images.posters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                            }
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"
                        return $global:posterurl
                    }
                    Else {
                        Write-Entry -Subtext "Found Poster with text on TMDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"
                    }
                }
                Else {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $filteredPosters = $response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                            if ($filteredPosters) {
                                $posterpath = $filteredPosters[0].file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                        Else {
                            $filteredPosters = $response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                            if ($filteredPosters) {
                                $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                    }
                    Else {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $filteredPosters = $response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null }
                            if ($filteredPosters) {
                                $posterpath = $filteredPosters[0].file_path
                            }

                        }
                        Else {
                            $filteredPosters = $response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null }

                            if ($filteredPosters) {
                                $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                            }
                        }
                    }
                    if ($posterpath) {
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        Write-Entry -Subtext "Found Textless Poster on TMDB" -Path $global:configLogging -Color Green -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"
                        return $global:posterurl
                    }
                }
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"
        }
    }
    Else {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/movie/$($global:tmdbid)?append_to_response=images&language=$($PreferredLanguageOrder[0])&include_image_language=$($global:PreferredLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"

        }
        if ($response) {
            if ($response.images.posters) {
                foreach ($lang in $global:PreferredLanguageOrderTMDB) {
                    if ($lang -eq 'null' -or $lang -eq 'xx') {
                        if ($global:WidthHeightFilter -eq 'true') {
                            $FavPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                            $FavPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                        Else {
                            $FavPoster = ($response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                        }
                    }
                    Else {
                        if ($global:WidthHeightFilter -eq 'true') {
                            $FavPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                        Else {
                            $FavPoster = ($response.images.posters | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }
                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found Poster without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"
                        return $global:posterurl
                        continue
                    }
                }
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/posters"
        }
    }
}
function GetTMDBMovieBackground {
    Write-Entry -Subtext "Searching on TMDB for a movie background - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
    if (!$global:tmdbid) {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if ($global:BackgroundPreferTextless -eq $true) {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/movie/$($global:tmdbid)?append_to_response=images&language=xx&include_image_language=$($global:PreferredBackgroundLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"

        }
        if ($response) {
            if ($response.images.backdrops) {
                if ($global:WidthHeightFilter -eq 'true') {
                    $NoLangPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                    $NoLangPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                }
                Else {
                    $NoLangPoster = ($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                }
                if (!$NoLangPoster) {
                    Write-Entry -Subtext "PreferTextless Value: $global:BackgroundPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "OnlyTextless Value: $global:BackgroundOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                    if ($global:BackgroundOnlyTextless -eq $false) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.images.backdrops | Where-Object { $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                    Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                            Else {
                                $filteredPosters = $response.images.backdrops | Where-Object { $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }
                        Else {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $posterpath = $response.images.backdrops[0].file_path
                            }
                            Else {
                                $posterpath = (($response.images.backdrops | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                            }
                        }
                        if ($posterpath) {
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            if ($global:FavProvider -eq 'TMDB') {
                                $global:Fallback = "fanart"
                                $global:tmdbfallbackposterurl = $global:posterurl
                            }
                            Write-Entry -Subtext "Found background with text on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $global:TMDBAssetTextLang = $response.images.backdrops[0].iso_639_1
                            }
                            Else {
                                $global:TMDBAssetTextLang = (($response.images.backdrops | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                            }
                            return $global:posterurl
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
                    }
                    Else {
                        Write-Entry -Subtext "Found Poster with text on TMDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
                    }
                }
                Else {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $filteredPosters = $response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                            if ($filteredPosters) {
                                $posterpath = $filteredPosters[0].file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                        Else {
                            $filteredPosters = $response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                            if ($filteredPosters) {
                                $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                    }
                    Else {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = (($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })[0]).file_path
                        }
                        Else {
                            $posterpath = (($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null } | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                    }
                    if ($posterpath) {
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        Write-Entry -Subtext "Found Textless background on TMDB" -Path $global:configLogging -Color Green -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
                        return $global:posterurl
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
                if ($global:FavProvider -eq 'TMDB') {
                    $global:Fallback = "fanart"
                }
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
        }
    }
    Else {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/movie/$($global:tmdbid)?append_to_response=images&language=$($PreferredBackgroundLanguageOrder[0])&include_image_language=$($global:PreferredBackgroundLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"

        }
        if ($response) {
            if ($response.images.backdrops) {
                foreach ($lang in $global:PreferredBackgroundLanguageOrderTMDB) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                            $FavPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                        }
                        Else {
                            $FavPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                        }
                    }
                    Else {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                        }
                        Else {
                            $FavPoster = ($response.images.backdrops | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }
                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found background without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found background with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
                        return $global:posterurl
                        continue
                    }
                }
                if (!$global:posterurl -and $global:WidthHeightFilter -eq 'false') {
                    Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                    if ($global:FavProvider -ne 'fanart') {
                        $global:Fallback = "fanart"
                    }
                }
                if (!$global:posterurl -and $global:WidthHeightFilter -eq 'true') {
                    Write-Entry -Subtext "No Background found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                    if ($global:FavProvider -ne 'fanart') {
                        $global:Fallback = "fanart"
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
                if ($global:FavProvider -ne 'fanart') {
                    $global:Fallback = "fanart"
                }
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/movie/$($global:tmdbid)/images/backdrops"
        }
    }
}
function GetTMDBShowPoster {
    Write-Entry -Subtext "Searching on TMDB for a show poster - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
    if (!$global:tmdbid) {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
        $global:tmdbsearched = $true
    }
    Else {
        if ($global:PosterPreferTextless -eq $true) {
            try {
                $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)?append_to_response=images&language=xx&include_image_language=$($global:PreferredLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            }
            catch {
                Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"

            }
            if ($response) {
                if ($response.images.posters) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        $NoLangPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        $NoLangPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                    }
                    Else {
                        $NoLangPoster = ($response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                    }
                    if (!$NoLangPoster) {
                        Write-Entry -Subtext "PreferTextless Value: $global:PosterPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "OnlyTextless Value: $global:PosterOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                        if ($global:PosterOnlyTextless -eq $false) {
                            if ($global:WidthHeightFilter -eq 'true') {
                                if ($global:TMDBVoteSorting -eq 'primary') {
                                    $filteredPosters = $response.images.posters | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                    if ($filteredPosters) {
                                        $posterpath = $filteredPosters[0].file_path
                                        $global:TMDBAssetTextLang = $filteredPosters[0].iso_639_1
                                        Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                    }
                                    else {
                                        Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                }
                                Else {
                                    $filteredPosters = $response.images.posters | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                    if ($filteredPosters) {
                                        $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                        $global:TMDBAssetTextLang = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                                        Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                    }
                                    else {
                                        Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                    }
                                }
                            }
                            Else {
                                if ($global:TMDBVoteSorting -eq 'primary') {
                                    $posterpath = $response.images.posters[0].file_path
                                    $global:TMDBAssetTextLang = $response.images.posters[0].iso_639_1
                                }
                                Else {
                                    $posterpath = (($response.images.posters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    $global:TMDBAssetTextLang = (($response.images.posters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                                }
                            }
                            if ($posterpath) {
                                $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                                if ($global:FavProvider -ne 'fanart') {
                                    $global:Fallback = "fanart"
                                    $global:tmdbfallbackposterurl = $global:posterurl
                                }
                                Write-Entry -Subtext "Found Poster with text on TMDB" -Path $global:configLogging -Color Blue -log Info
                                $global:PosterWithText = $true

                                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"
                                return $global:posterurl
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with text on TMDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"
                        }
                    }
                    Else {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                    Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                            Else {
                                $filteredPosters = $response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }
                        Else {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $posterpath = ($response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                                if ($posterpath) {
                                    $posterpath = $posterpath[0].file_path
                                }
                            }
                            Else {
                                $posterpath = ($response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null } | Sort-Object $global:TMDBVoteSorting -Descending)
                                if ($posterpath) {
                                    $posterpath = $posterpath[0].file_path
                                }
                            }
                        }
                        if ($posterpath) {
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            Write-Entry -Subtext "Found Textless Poster on TMDB" -Path $global:configLogging -Color Green -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"
                            return $global:posterurl
                        }
                    }
                    $global:tmdbsearched = $true
                }
            }
            Else {
                Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"
                $global:tmdbsearched = $true
            }
        }
        Else {
            try {
                $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)?append_to_response=images&language=$($PreferredLanguageOrder[0])&include_image_language=$($global:PreferredLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            }
            catch {
                Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"

            }
            if ($response) {
                if ($response.images.posters) {
                    foreach ($lang in $global:PreferredLanguageOrderTMDB) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($lang -eq 'null' -or $lang -eq 'xx') {
                                $FavPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                                $FavPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                            }
                            Else {
                                $FavPoster = ($response.images.posters | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                            }
                        }
                        Else {
                            if ($lang -eq 'null' -or $lang -eq 'xx') {
                                $FavPoster = ($response.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                            }
                            Else {
                                $FavPoster = ($response.images.posters | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                            }
                        }
                        if ($FavPoster) {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $posterpath = $FavPoster[0].file_path
                            }
                            Else {
                                $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                            }
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found Poster without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                                $global:TextlessPoster = $true
                                $global:PosterWithText = $null
                            }
                            Else {
                                Write-Entry -Subtext "Found Poster with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"
                            return $global:posterurl
                            continue
                        }
                        $global:tmdbsearched = $true
                    }
                }
            }
            Else {
                Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/posters"
                $global:tmdbsearched = $true
            }
        }
    }
}
function GetTMDBSeasonPoster {
    Write-Entry -Subtext "Searching on TMDB for Season '$global:SeasonNumber' poster - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
    if (!$global:tmdbid) {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if ($global:SeasonPreferTextless -eq $true) {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)/season/$global:SeasonNumber/images?append_to_response=images&language=xx&include_image_language=$($global:PreferredSeasonLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"

        }
        if ($response) {
            if ($response.posters) {
                if ($global:WidthHeightFilter -eq 'true') {
                    $NoLangPoster = ($response.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                }
                Else {
                    $NoLangPoster = ($response.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) })
                }
                Write-Entry -Subtext "NoLangPoster: $NoLangPoster" -Path $global:configLogging -Color Cyan -log Debug
                if (!$NoLangPoster) {
                    if (!$global:SeasonOnlyTextless) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.poster | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                    $global:TMDBAssetTextLang = $filteredPosters[0].iso_639_1
                                    Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No Season posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                            Else {
                                $filteredPosters = $response.posters | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    $global:TMDBAssetTextLang = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                                    Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No Season posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }
                        Else {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $posterpath = $response.posters[0].file_path
                                $global:TMDBAssetTextLang = $response.posters[0].iso_639_1
                            }
                            Else {
                                $posterpath = (($response.posters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                $global:TMDBAssetTextLang = (($response.posters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                            }
                        }
                        if ($posterpath) {
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            Write-Entry -Subtext "Found Season Poster with text on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
                            $global:TMDBSeasonFallback = $global:posterurl
                            Write-Entry -Subtext "Posterpath: $posterpath" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "PosterUrl: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "PosterWithText: $global:PosterWithText" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "TMDBAssetTextLang: $global:TMDBAssetTextLang" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "TMDBAssetChangeUrl: $global:TMDBAssetChangeUrl" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "TMDBSeasonFallback: $global:TMDBSeasonFallback" -Path $global:configLogging -Color Cyan -log Debug
                            return $global:posterurl
                        }
                    }
                    Else {
                        Write-Entry -Subtext "Found Season Poster with text on TMDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
                    }
                }
                Else {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $filteredPosters = $response.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                            if ($filteredPosters) {
                                $posterpath = $filteredPosters[0].file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No Season posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                        Else {
                            $filteredPosters = $response.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                            if ($filteredPosters) {
                                $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No Season posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                    }
                    Else {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = (($response.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })[0]).file_path
                        }
                        Else {
                            $posterpath = (($response.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null } | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                    }
                    if ($posterpath) {
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        Write-Entry -Subtext "Found Textless Season Poster on TMDB" -Path $global:configLogging -Color Green -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
                        Write-Entry -Subtext "Posterpath: $posterpath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "PosterUrl: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "TextlessPoster: $global:TextlessPoster" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "TMDBAssetChangeUrl: $global:TMDBAssetChangeUrl" -Path $global:configLogging -Color Cyan -log Debug
                        return $global:posterurl
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No season posters found on TMDB for this season" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
            }
        }
        Else {
            Write-Entry -Subtext "No Season Poster on TMDB" -Path $global:configLogging -Color Yellow -log Warning
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
        }
    }
    Else {
        try {
            if ($global:SeasonNumber -match '\b\d{1,2}\b') {
                $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)/season/$global:SeasonNumber/images?append_to_response=images&language=$($global:PreferredSeasonLanguageOrder[0])&include_image_language=$($global:PreferredSeasonLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            }
            Else {
                $responseBackup = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)?append_to_response=images&language=$($global:PreferredSeasonLanguageOrder[0])&include_image_language=$($global:PreferredSeasonLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            }
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"

        }
        if ($responseBackup) {
            if ($responseBackup.images.posters) {
                Write-Entry -Subtext "Could not get a result with '$global:SeasonNumber' on TMDB, likely season number not in correct format, fallback to Show poster." -Path $global:configLogging -Color Blue -log Info
                foreach ($lang in $global:PreferredSeasonLanguageOrderTMDB) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($responseBackup.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                            $FavPoster = ($responseBackup.images.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                        Else {
                            $FavPoster = ($responseBackup.images.posters | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                    }
                    Else {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($responseBackup.images.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                        }
                        Else {
                            $FavPoster = ($responseBackup.images.posters | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }
                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found Poster without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
                        Write-Entry -Subtext "Posterpath: $posterpath" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "PosterUrl: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "PosterWithText: $global:PosterWithText" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "TMDBAssetTextLang: $global:TMDBAssetTextLang" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "TMDBAssetChangeUrl: $global:TMDBAssetChangeUrl" -Path $global:configLogging -Color Cyan -log Debug
                        return $global:posterurl
                        continue
                    }
                }
            }
        }
        if ($response) {
            if ($response.posters) {
                foreach ($lang in $global:PreferredSeasonLanguageOrderTMDB) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                            $FavPoster = ($response.posters | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                        Else {
                            $FavPoster = ($response.posters | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                    }
                    Else {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.posters | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                        }
                        Else {
                            $FavPoster = ($response.posters | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }
                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found Poster without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
                        return $global:posterurl
                        continue
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No season posters found on TMDB for this season" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
            }
        }
        Else {
            Write-Entry -Subtext "No Season Poster on TMDB" -Path $global:configLogging -Color Yellow -log Warning
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:SeasonNumber/images/posters"
        }

    }
}
function GetTMDBShowBackground {
    Write-Entry -Subtext "Searching on TMDB for a show background - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
    if (!$global:tmdbid) {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if ($global:BackgroundPreferTextless -eq $true) {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)?append_to_response=images&language=xx&include_image_language=$($global:PreferredBackgroundLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"

        }
        if ($response) {
            if ($response.images.backdrops) {
                if ($global:WidthHeightFilter -eq 'true') {
                    $NoLangPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                    $NoLangPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                }
                Else {
                    $NoLangPoster = ($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                }
                if (!$NoLangPoster) {
                    Write-Entry -Subtext "PreferTextless Value: $global:BackgroundPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "OnlyTextless Value: $global:BackgroundOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                    if ($global:BackgroundOnlyTextless -eq $false) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.images.backdrops | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                    $global:TMDBAssetTextLang = $filteredPosters[0].iso_639_1
                                    Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                            Else {
                                $filteredPosters = $response.images.backdrops | Where-Object { $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    $global:TMDBAssetTextLang = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                                    Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }
                        Else {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $posterpath = $response.images.backdrops[0].file_path
                                $global:TMDBAssetTextLang = $response.images.backdrops[0].iso_639_1
                            }
                            Else {
                                $posterpath = (($response.images.backdrops | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                $global:TMDBAssetTextLang = (($response.images.backdrops | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                            }
                        }
                        if ($posterpath) {
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            if ($global:FavProvider -ne 'fanart') {

                                $global:Fallback = "fanart"
                                $global:tmdbfallbackposterurl = $global:posterurl
                            }
                            Write-Entry -Subtext "Found background with text on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                    }
                    Else {
                        Write-Entry -Subtext "Found Poster with text on TMDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                    }
                }
                Else {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $filteredPosters = $response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                            if ($filteredPosters) {
                                $posterpath = $filteredPosters[0].file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                        Else {
                            $filteredPosters = $response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }

                            if ($filteredPosters) {
                                $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No Background posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                    }
                    Else {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = (($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })[0]).file_path
                        }
                        Else {
                            $posterpath = (($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null } | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                    }
                    if ($posterpath) {
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        Write-Entry -Subtext "Found Textless background on TMDB" -Path $global:configLogging -Color Green -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                        return $global:posterurl
                    }
                }
                if (!$global:posterurl) {
                    Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                    if ($global:FavProvider -ne 'fanart') {
                        $global:Fallback = "fanart"
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                if ($global:FavProvider -ne 'fanart') {
                    $global:Fallback = "fanart"
                }
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
        }
    }
    Else {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)?append_to_response=images&language=$($PreferredBackgroundLanguageOrder[0])&include_image_language=$($global:PreferredBackgroundLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"

        }
        if ($response) {
            if ($response.images.backdrops) {
                foreach ($lang in $global:PreferredBackgroundLanguageOrderTMDB) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                            $FavPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                        Else {
                            $FavPoster = ($response.images.backdrops | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight })
                        }
                    }
                    Else {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.images.backdrops | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                        }
                        Else {
                            $FavPoster = ($response.images.backdrops | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }
                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found background without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found background with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                        return $global:posterurl
                        continue
                    }
                }
                if (!$global:posterurl) {
                    Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                    if ($global:FavProvider -ne 'fanart') {
                        $global:Fallback = "fanart"
                    }
                }
            }
            Else {
                Write-Entry -Subtext "No Background found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
                if ($global:FavProvider -ne 'fanart') {
                    $global:Fallback = "fanart"
                }
            }
        }
        Else {
            Write-Entry -Subtext "TMDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/images/backdrops"
        }
    }
}
function GetTMDBTitleCard {
    Write-Entry -Subtext "Searching on TMDB for: $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card - TMDBID: $global:tmdbid" -Path $global:configLogging -Color Cyan -log Info
    if (!$global:tmdbid) {
        Write-Entry -Subtext "Cannot search on TMDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if ($global:TCPreferTextless -eq $true) {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)/season/$($global:season_number)/episode/$($global:episodenumber)/images?append_to_response=images&language=xx&include_image_language=$($global:PreferredTCLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
        }
        if ($response) {
            if ($response.stills) {
                if ($global:WidthHeightFilter -eq 'true') {
                    $NoLangPoster = ($response.stills | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                }
                Else {
                    $NoLangPoster = ($response.stills | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                }
                if (!$NoLangPoster) {
                    Write-Entry -Subtext "PreferTextless Value: $global:TCPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "OnlyTextless Value: $global:TCOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                    if ($global:TCOnlyTextless -eq $false) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $filteredPosters = $response.stills | Where-Object { $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = $filteredPosters[0].file_path
                                    $global:TMDBAssetTextLang = $filteredPosters[0].iso_639_1
                                    Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No TC posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                            Else {
                                $filteredPosters = $response.stills | Where-Object { $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                                if ($filteredPosters) {
                                    $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                    $global:TMDBAssetTextLang = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                                    Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                                }
                                else {
                                    Write-Entry -Subtext "No TC posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                                }
                            }
                        }
                        Else {
                            if ($global:TMDBVoteSorting -eq 'primary') {
                                $posterpath = $response.stills[0].file_path
                                $global:TMDBAssetTextLang = $response.stills[0].iso_639_1
                            }
                            Else {
                                $posterpath = (($response.stills | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                $global:TMDBAssetTextLang = (($response.stills | Sort-Object $global:TMDBVoteSorting -Descending)[0]).iso_639_1
                            }
                        }
                        if ($posterpath) {
                            $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                            Write-Entry -Subtext "Found TC with text on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
                    }
                    Else {
                        Write-Entry -Subtext "Found Poster with text on TMDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
                    }
                }
                Else {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $filteredPosters = $response.stills | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                            if ($filteredPosters) {
                                $posterpath = $filteredPosters[0].file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $($filteredPosters[0].width) | height: $($filteredPosters[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No TC posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                        Else {
                            $filteredPosters = $response.stills | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }

                            if ($filteredPosters) {
                                $posterpath = (($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                                Write-Entry -Subtext "Found a poster sized at - width: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).width) | height: $((($filteredPosters | Sort-Object $global:TMDBVoteSorting -Descending)[0]).height)" -Path $global:configLogging -Color White -log Info
                            }
                            else {
                                Write-Entry -Subtext "No TC posters found on TMDB with the specified dimensions." -Path $global:configLogging -Color Yellow -log Warning
                            }
                        }
                    }
                    Else {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = (($response.stills | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })[0]).file_path
                        }
                        Else {
                            $posterpath = (($response.stills | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null } | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                    }
                    if ($posterpath) {
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        Write-Entry -Subtext "Found Textless TC on TMDB" -Path $global:configLogging -Color Green -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
                        return $global:posterurl
                    }
                }
                if (!$global:posterurl) {
                    Write-Entry -Subtext "No TC found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                }
            }
            Else {
                Write-Entry -Subtext "No TC found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
            }
        }
        Else {
            Write-Entry -Subtext "No title card images found on TMDB for this episode" -Path $global:configLogging -Color Yellow -log Warning
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
        }
    }
    Else {
        try {
            $response = (Invoke-WebRequest -Uri "https://api.themoviedb.org/3/tv/$($global:tmdbid)/season/$($global:season_number)/episode/$($global:episodenumber)/images?append_to_response=images&language=$($global:PreferredTCLanguageOrderTMDB[0])&include_image_language=$($global:PreferredTCLanguageOrderTMDB -join ',')" -Method GET -Headers $global:headers -ErrorAction SilentlyContinue -WarningAction SilentlyContinue).content | ConvertFrom-Json -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
        }
        catch {
            Write-Entry -Subtext "Could not query TMDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"

        }
        if ($response) {
            if ($response.stills) {
                foreach ($lang in $global:PreferredTCLanguageOrderTMDB) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.stills | Where-Object { ($_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                        }
                        Else {
                            $FavPoster = ($response.stills | Where-Object { ($_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1)) -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight })
                        }
                    }
                    Else {
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            $FavPoster = ($response.stills | Where-Object { $_.iso_639_1 -eq 'xx' -or $_.iso_3166_1 -eq 'XX' -or $_.iso_3166_1 -eq $null -or $_.iso_639_1 -eq $null })
                        }
                        Else {
                            $FavPoster = ($response.stills | Where-Object { $_.iso_639_1 -eq $lang -or "$($_.iso_639_1)-$($_.iso_3166_1)" -eq $lang -or ($_.iso_639_1 -eq ($lang -split '-')[0] -and -not $_.iso_3166_1) })
                        }
                    }
                    if ($FavPoster) {
                        if ($global:TMDBVoteSorting -eq 'primary') {
                            $posterpath = $FavPoster[0].file_path
                        }
                        Else {
                            $posterpath = (($FavPoster | Sort-Object $global:TMDBVoteSorting -Descending)[0]).file_path
                        }
                        $global:posterurl = "https://image.tmdb.org/t/p/original$posterpath"
                        if ($lang -eq 'null' -or $lang -eq 'xx') {
                            Write-Entry -Subtext "Found TC without Language on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found TC with Language '$lang' on TMDB" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:TMDBAssetTextLang = $lang
                        }
                        $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
                        return $global:posterurl
                        continue
                    }
                }
                if (!$global:posterurl) {
                    Write-Entry -Subtext "No TC found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
                }
            }
            Else {
                Write-Entry -Subtext "No TC found on TMDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
            }
        }
        Else {
            Write-Entry -Subtext "No title card images found on TMDB for this episode" -Path $global:configLogging -Color Yellow -log Warning
            $global:TMDBAssetChangeUrl = "https://www.themoviedb.org/tv/$($global:tmdbid)/season/$global:season_number/episode/$global:episodenumber/images/backdrops"
        }
    }
}
function GetFanartMoviePoster {
    if (-not $global:FanartTvAPIKey) { return }
    $global:Fallback = $null
    Write-Entry -Subtext "Searching on Fanart.tv for a movie poster" -Path $global:configLogging -Color Cyan -log Info
    if ($global:PosterPreferTextless -eq $true) {
        $ids = @($global:tmdbid, $global:imdbid)
        $entrytemp = $null

        foreach ($id in $ids) {
            if ($id) {
                try { $entrytemp = Get-FanartTvmovie -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                    Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                    $entrytemp = $null
                }
                if ($entrytemp -and $entrytemp.movieposter) {
                    if (!($entrytemp.movieposter | Where-Object lang -eq '00')) {
                        Write-Entry -Subtext "PreferTextless Value: $global:PosterPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "OnlyTextless Value: $global:PosterOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                        if ($global:PosterOnlyTextless -eq $false) {
                            $global:posterurl = ($entrytemp.movieposter)[0].url
                            Write-Entry -Subtext "Found Poster with text on Fanart.tv"  -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:FANARTAssetTextLang = ($entrytemp.movieposter)[0].lang
                            $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"

                            if ($global:FavProvider -eq 'FANART') {
                                $global:Fallback = "TMDB"
                                $global:fanartfallbackposterurl = ($entrytemp.movieposter)[0].url
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with text on FANART, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                            $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"
                        }
                        return $global:posterurl
                        continue
                    }
                    Else {
                        $global:posterurl = ($entrytemp.movieposter | Where-Object lang -eq '00')[0].url
                        Write-Entry -Subtext "Found Textless Poster on Fanart.tv" -Path $global:configLogging -Color Green -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"
                        return $global:posterurl
                        break
                    }
                }
            }
        }
        if ($null -eq $ids[0] -and $null -eq $ids[1]) {
            Write-Entry -Subtext "Cannot search on FANART, missing IDs..." -Path $global:configLogging -Color Yellow -log Warning
        }
        if (!$global:posterurl) {
            Write-Entry -Subtext "No movie match or poster found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
        }
        Else {
            return $global:posterurl
        }
    }
    Else {
        $ids = @($global:tmdbid, $global:imdbid)
        $entrytemp = $null

        foreach ($id in $ids) {
            if ($id) {
                try { $entrytemp = Get-FanartTvmovie -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                    Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                    $entrytemp = $null
                }
                if ($entrytemp -and $entrytemp.movieposter) {
                    foreach ($lang in $global:PreferredLanguageOrderFanart) {
                        if (($entrytemp.movieposter | Where-Object lang -eq "$lang")) {
                            $global:posterurl = ($entrytemp.movieposter)[0].url
                            if ($lang -eq '00') {
                                Write-Entry -Subtext "Found Poster without Language on FANART" -Path $global:configLogging -Color Blue -log Info
                                $global:TextlessPoster = $true
                                $global:PosterWithText = $null
                            }
                            Else {
                                Write-Entry -Subtext "Found Poster with Language '$lang' on FANART" -Path $global:configLogging -Color Blue -log Info
                            }
                            if ($lang -ne '00') {
                                $global:PosterWithText = $true
                                $global:FANARTAssetTextLang = $lang
                            }
                            return $global:posterurl
                            continue
                        }
                    }
                }
            }
        }
        if ($null -eq $ids[0] -and $null -eq $ids[1]) {
            Write-Entry -Subtext "Cannot search on FANART, missing IDs..." -Path $global:configLogging -Color Yellow -log Warning
        }
        if (!$global:posterurl) {
            Write-Entry -Subtext "No movie match or poster found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
        }
        Else {
            return $global:posterurl
        }
    }
}
function GetFanartMovieBackground {
    if (-not $global:FanartTvAPIKey) { return }
    $global:Fallback = $null
    Write-Entry -Subtext "Searching on Fanart.tv for a Background poster" -Path $global:configLogging -Color Cyan -log Info
    $ids = @($global:tmdbid, $global:imdbid)
    $entrytemp = $null

    foreach ($id in $ids) {
        if ($id) {
            try { $entrytemp = Get-FanartTvmovie -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                $entrytemp = $null
            }
            if ($entrytemp -and $entrytemp.moviebackground) {
                if (!($entrytemp.moviebackground | Where-Object lang -eq '')) {
                    Write-Entry -Subtext "PreferTextless Value: $global:BackgroundPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "OnlyTextless Value: $global:BackgroundOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                    if ($global:BackgroundOnlyTextless -eq $false) {
                        $global:posterurl = ($entrytemp.moviebackground)[0].url
                        Write-Entry -Subtext "Found Background with text on Fanart.tv"  -Path $global:configLogging -Color Blue -log Info
                        $global:PosterWithText = $true
                        $global:FANARTAssetTextLang = ($entrytemp.moviebackground)[0].lang
                        $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"

                        if ($global:FavProvider -eq 'FANART') {
                            $global:Fallback = "TMDB"
                            $global:fanartfallbackposterurl = ($entrytemp.moviebackground)[0].url
                        }
                    }
                    Else {
                        Write-Entry -Subtext "Found Background with text on FANART, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"
                    }
                    return $global:posterurl
                    continue
                }
                Else {
                    $global:posterurl = ($entrytemp.moviebackground | Where-Object lang -eq '')[0].url
                    Write-Entry -Subtext "Found Textless background on Fanart.tv" -Path $global:configLogging -Color Green -log Info
                    $global:TextlessPoster = $true
                    $global:PosterWithText = $null
                    $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"
                    return $global:posterurl
                    continue
                }
            }
        }
    }
    if ($null -eq $ids[0] -and $null -eq $ids[1]) {
        Write-Entry -Subtext "Cannot search on FANART, missing IDs..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if (!$global:posterurl) {
        Write-Entry -Subtext "No movie match or background found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
    }
    Else {
        return $global:posterurl
    }

}
function GetFanartShowPoster {
    if (-not $global:FanartTvAPIKey) { return }
    $global:Fallback = $null
    Write-Entry -Subtext "Searching on Fanart.tv for a show poster" -Path $global:configLogging -Color Cyan -log Info
    if ($global:PosterPreferTextless -eq $true) {
        $id = $global:tvdbid
        $entrytemp = $null
        if ($id) {
            try { $entrytemp = Get-FanartTvshow -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                $entrytemp = $null
            }
            if ($entrytemp -and $entrytemp.tvposter) {
                if (!($entrytemp.tvposter | Where-Object lang -eq '00')) {
                    Write-Entry -Subtext "PreferTextless Value: $global:PosterPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                    Write-Entry -Subtext "OnlyTextless Value: $global:PosterOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                    if ($global:PosterOnlyTextless -eq $false) {
                        $global:posterurl = ($entrytemp.tvposter)[0].url

                        Write-Entry -Subtext "Found Poster with text on Fanart.tv" -Path $global:configLogging -Color Blue -log Info
                        $global:PosterWithText = $true
                        $global:FANARTAssetTextLang = ($entrytemp.tvposter)[0].lang
                        $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"

                        if ($global:FavProvider -eq 'FANART') {
                            $global:Fallback = "TMDB"
                            $global:fanartfallbackposterurl = ($entrytemp.tvposter)[0].url
                        }
                    }
                    Else {
                        Write-Entry -Subtext "Found Poster with text on FANART, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                        if ($global:FavProvider -eq 'FANART') {
                            $global:Fallback = "TMDB"
                        }
                        $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                    }
                    return $global:posterurl
                    continue
                }
                Else {
                    $global:posterurl = ($entrytemp.tvposter | Where-Object lang -eq '00')[0].url
                    Write-Entry -Subtext "Found Textless Poster on Fanart.tv" -Path $global:configLogging -Color Green -log Info
                    $global:TextlessPoster = $true
                    $global:PosterWithText = $null
                    $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                    return $global:posterurl
                    break
                }
            }
        }
        Else {
            Write-Entry -Subtext "Cannot search on FANART, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
            if ($global:FavProvider -eq 'FANART') {
                $global:Fallback = "TMDB"
            }
        }
        if (!$global:posterurl) {
            Write-Entry -Subtext "No show match or poster found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
            if ($global:FavProvider -eq 'FANART') {
                $global:Fallback = "TMDB"
            }
        }
        Else {
            return $global:posterurl
        }
    }
    Else {
        $id = $global:tvdbid
        $entrytemp = $null

        if ($id) {
            try { $entrytemp = Get-FanartTvshow -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                $entrytemp = $null
            }
            if ($entrytemp -and $entrytemp.tvposter) {
                foreach ($lang in $global:PreferredSeasonLanguageOrderFanart) {
                    if (($entrytemp.tvposter | Where-Object lang -eq "$lang")) {
                        $global:posterurl = ($entrytemp.tvposter)[0].url
                        if ($lang -eq '00') {
                            Write-Entry -Subtext "Found Poster without Language on FANART" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with Language '$lang' on FANART" -Path $global:configLogging -Color Blue -log Info
                        }
                        if ($lang -ne '00') {
                            $global:PosterWithText = $true
                            $global:FANARTAssetTextLang = $lang
                        }
                        return $global:posterurl
                        continue
                    }
                }
            }
        }
        Else {
            Write-Entry -Subtext "Cannot search on FANART, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
        }
        if (!$global:posterurl) {
            Write-Entry -Subtext "No show match or poster found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
            if ($global:FavProvider -eq 'FANART') {
                $global:Fallback = "TMDB"
            }
        }
        Else {
            return $global:posterurl
        }
    }
}
function GetFanartShowBackground {
    if (-not $global:FanartTvAPIKey) { return }
    $global:Fallback = $null
    Write-Entry -Subtext "Searching on Fanart.tv for a Background poster" -Path $global:configLogging -Color Cyan -log Info
    $id = $global:tvdbid
    $entrytemp = $null

    if ($id) {
        try { $entrytemp = Get-FanartTvshow -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
            Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
            $entrytemp = $null
        }
        if ($entrytemp -and $entrytemp.showbackground) {
            if (!($entrytemp.showbackground | Where-Object lang -eq '')) {
                Write-Entry -Subtext "PreferTextless Value: $global:BackgroundPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                Write-Entry -Subtext "OnlyTextless Value: $global:BackgroundOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                if ($global:BackgroundOnlyTextless -eq $false) {
                    $global:posterurl = ($entrytemp.showbackground)[0].url
                    Write-Entry -Subtext "Found Background with text on Fanart.tv"  -Path $global:configLogging -Color Blue -log Info
                    $global:PosterWithText = $true
                    $global:FANARTAssetTextLang = ($entrytemp.showbackground)[0].lang
                    $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"

                    if ($global:FavProvider -eq 'FANART') {
                        $global:Fallback = "TMDB"
                        $global:fanartfallbackposterurl = ($entrytemp.showbackground)[0].url
                    }
                }
                Else {
                    Write-Entry -Subtext "Found Background with text on FANART, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                    $global:FANARTAssetChangeUrl = "https://fanart.tv/movie/$id"
                }
                return $global:posterurl
                continue
            }
            Else {
                $global:posterurl = ($entrytemp.showbackground | Where-Object lang -eq '')[0].url
                Write-Entry -Subtext "Found Textless background on Fanart.tv" -Path $global:configLogging -Color Green -log Info
                $global:TextlessPoster = $true
                $global:PosterWithText = $null
                $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                return $global:posterurl
                continue
            }
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on FANART, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
    if (!$global:posterurl) {
        Write-Entry -Subtext "No show match or background found on Fanart.tv" -Path $global:configLogging -Color Yellow -log Warning
    }
    Else {
        return $global:posterurl
    }

}
function GetFanartSeasonPoster {
    if (-not $global:FanartTvAPIKey) { return }
    Write-Entry -Subtext "Searching on Fanart.tv for Season '$global:SeasonNumber' poster" -Path $global:configLogging -Color Cyan -log Info
    $id = $global:tvdbid
    $entrytemp = $null
    if ($global:SeasonPreferTextless -eq $true) {
        if ($id) {
            try { $entrytemp = Get-FanartTvshow -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                $entrytemp = $null
            }
            if ($entrytemp.seasonposter) {
                if ($global:SeasonNumber -match '\b\d{1,2}\b') {
                    $NoLangPoster = ($entrytemp.seasonposter | Where-Object { $_.lang -eq '00' -and $_.Season -eq $global:SeasonNumber } | Sort-Object likes)
                    if ($NoLangPoster) {
                        $global:posterurl = ($NoLangPoster | Sort-Object likes)[0].url
                        Write-Entry -Subtext "Found Season Poster without Language on FANART" -Path $global:configLogging -Color Blue -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                        Write-Entry -Subtext "NoLangPoster: $NoLangPoster" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "PosterUrl: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "TextlessPoster: $global:TextlessPoster" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "FANARTAssetChangeUrl: $global:FANARTAssetChangeUrl" -Path $global:configLogging -Color Cyan -log Debug
                    }
                    Else {
                        if (!$global:SeasonOnlyTextless) {
                            Write-Entry -Subtext "No Textless Season Poster on FANART" -Path $global:configLogging -Color Blue -log Info
                            foreach ($lang in $global:PreferredSeasonLanguageOrderFanart) {
                                $FoundPoster = ($entrytemp.seasonposter | Where-Object { $_.lang -eq "$lang" -and $_.Season -eq $global:SeasonNumber } | Sort-Object likes)
                                if ($FoundPoster) {
                                    $global:posterurl = $FoundPoster[0].url
                                    Write-Entry -Subtext "Found season Poster with Language '$lang' on FANART" -Path $global:configLogging -Color Blue -log Info
                                    $global:PosterWithText = $true
                                    $global:FANARTAssetTextLang = $lang
                                    $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                                    $global:FANARTSeasonFallback = $global:posterurl
                                    Write-Entry -Subtext "FoundPoster: $FoundPoster" -Path $global:configLogging -Color Cyan -log Debug
                                    Write-Entry -Subtext "PosterUrl: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color Cyan -log Debug
                                    Write-Entry -Subtext "PosterWithText: $global:PosterWithText" -Path $global:configLogging -Color Cyan -log Debug
                                    Write-Entry -Subtext "FANARTAssetTextLang: $global:FANARTAssetTextLang" -Path $global:configLogging -Color Cyan -log Debug
                                    Write-Entry -Subtext "FANARTAssetChangeUrl: $global:FANARTAssetChangeUrl" -Path $global:configLogging -Color Cyan -log Debug
                                    return $global:posterurl
                                }
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with text on FANART, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                            $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                        }
                    }
                }
                Else {
                    Write-Entry -Subtext "Could not get a result with '$global:SeasonNumber' on Fanart, likely season number not in correct format, fallback to Show poster." -Path $global:configLogging -Color Blue -log Info
                    if ($entrytemp -and $entrytemp.tvposter) {
                        foreach ($lang in $global:PreferredSeasonLanguageOrderFanart) {
                            if (($entrytemp.tvposter | Where-Object lang -eq "$lang")) {
                                $global:posterurl = ($entrytemp.tvposter)[0].url
                                if ($lang -eq '00') {
                                    Write-Entry -Subtext "Found Poster without Language on FANART" -Path $global:configLogging -Color Blue -log Info
                                    $global:TextlessPoster = $true
                                    $global:PosterWithText = $null
                                    $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                                }
                                Else {
                                    if (!$global:SeasonOnlyTextless) {
                                        Write-Entry -Subtext "Found Poster with Language '$lang' on FANART" -Path $global:configLogging -Color Blue -log Info
                                    }
                                }
                                if (!$global:SeasonOnlyTextless -and !$global:TextlessPoster) {
                                    if ($lang -ne '00') {
                                        $global:PosterWithText = $true
                                        $global:FANARTAssetTextLang = $lang
                                        $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                                        $global:FANARTSeasonFallback = $global:posterurl
                                    }
                                }
                                Else {
                                    Write-Entry -Subtext "Found Poster with text on FANART, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                                    $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                                    $global:posterurl = $null
                                }
                                return $global:posterurl
                            }
                        }
                    }
                }
            }
            Else {
                $global:posterurl = $null
            }
        }
        Else {
            Write-Entry -Subtext "Cannot search on FANART, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
        }
        if ($global:posterurl) {
            Write-Entry -Subtext "Found season poster on Fanart" -Path $global:configLogging -Color Cyan -log Info
            return $global:posterurl
        }
        Else {
            if ($global:PosterOnlyTextless -eq $true) {
                Write-Entry -Subtext "No Textless Season Poster on Fanart" -Path $global:configLogging -Color Yellow -log Warning
            }
            Else {
                Write-Entry -Subtext "No Season Poster on Fanart" -Path $global:configLogging -Color Yellow -log Warning
            }
        }
    }
    Else {
        if ($id) {
            try { $entrytemp = Get-FanartTvshow -id $id -ErrorAction SilentlyContinue -WarningAction SilentlyContinue } catch {
                Write-Entry -Subtext "Fanart.tv error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
                $entrytemp = $null
            }
            if ($entrytemp.seasonposter) {
                foreach ($lang in $global:PreferredSeasonLanguageOrderFanart) {
                    $FoundPoster = ($entrytemp.seasonposter | Where-Object { $_.lang -eq "$lang" -and $_.Season -eq $global:SeasonNumber } | Sort-Object likes)
                    if ($FoundPoster) {
                        $global:posterurl = $FoundPoster[0].url
                    }
                    if ($global:posterurl) {
                        if ($lang -eq '00') {
                            Write-Entry -Subtext "Found season Poster without Language on FANART" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                            $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                        }
                        Else {
                            Write-Entry -Subtext "Found season Poster with Language '$lang' on FANART" -Path $global:configLogging -Color Blue -log Info
                            $global:PosterWithText = $true
                            $global:FANARTAssetTextLang = $lang
                            $global:FANARTAssetChangeUrl = "https://fanart.tv/series/$id"
                            return $global:posterurl
                        }
                    }
                }
            }
            Else {
                $global:posterurl = $null
                return $global:posterurl
            }
        }
        Else {
            Write-Entry -Subtext "Cannot search on FANART, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
        }
        if ($global:posterurl) {
            return $global:posterurl
        }
        Else {
            if ($global:PosterOnlyTextless -eq $true) {
                Write-Entry -Subtext "No Textless Season Poster on Fanart" -Path $global:configLogging -Color Yellow -log Warning
            }
            Else {
                Write-Entry -Subtext "No Season Poster on Fanart" -Path $global:configLogging -Color Yellow -log Warning
            }
        }
    }
}
function GetTVDBMoviePoster {
    if ($global:tvdbid) {
        if ($global:PosterPreferTextless -eq $true) {
            Write-Entry -Subtext "Searching on TVDB for a movie poster - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/movies/$($global:tvdbid)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data.artworks) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        $global:posterurltmp = ($response.data.artworks | Where-Object { $null -eq $_.language -and $_.type -eq '14' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                    }
                    Else {
                        $global:posterurltmp = ($response.data.artworks | Where-Object { $null -eq $_.language -and $_.type -eq '14' } | Sort-Object Score -Descending)
                    }
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                    if ($global:posterurltmp) {
                        $global:posterurl = $global:posterurltmp[0].image
                        if ($global:WidthHeightFilter -eq 'true') {
                            Write-Entry -Subtext "Found a poster sized at - width: $($global:posterurltmp[0].width) | height: $($global:posterurltmp[0].height)" -Path $global:configLogging -Color White -log Info
                        }
                        Write-Entry -Subtext "Found Textless Poster on TVDB" -Path $global:configLogging -Color Blue -log Info
                        return $global:posterurl
                    }
                    Else {
                        Write-Entry -Subtext "PreferTextless Value: $global:PosterPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "OnlyTextless Value: $global:PosterOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                        if ($global:PosterOnlyTextless -eq $false) {
                            foreach ($lang in $global:PreferredLanguageOrderTVDB) {
                                if ($global:WidthHeightFilter -eq 'true') {
                                    if ($lang -eq 'null') {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '14' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                                    }
                                    Else {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '14' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                                    }
                                }
                                Else {
                                    if ($lang -eq 'null') {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '14' } | Sort-Object Score -Descending)
                                    }
                                    Else {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '14' } | Sort-Object Score -Descending)
                                    }
                                }
                                if ($LangArtwork) {
                                    $global:posterurl = $LangArtwork[0].image
                                    if ($global:WidthHeightFilter -eq 'true') {
                                        Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                                    }
                                    if ($lang -eq 'null') {
                                        Write-Entry -Subtext "Found Poster without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                                        $global:TextlessPoster = $true
                                        $global:PosterWithText = $null
                                    }
                                    Else {
                                        Write-Entry -Subtext "Found Poster with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                                    }
                                    if ($lang -ne 'null') {
                                        $global:PosterWithText = $true
                                        $global:TVDBAssetTextLang = $lang
                                        if ($global:FavProvider -eq 'TVDB') {
                                            $global:Fallback = "TMDB"
                                            $global:TVDBfallbackposterurl = $LangArtwork[0].image
                                        }
                                    }
                                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                                    return $global:posterurl
                                    continue
                                }
                            }
                        }
                        Else {
                            Write-Entry -Subtext "No Textless Poster on TVDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                        }
                    }
                }
                Else {
                    Write-Entry -Subtext "No Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
            }
        }
        Else {
            Write-Entry -Subtext "Searching on TVDB for a movie poster" -Path $global:configLogging -Color Cyan -log Info
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/movies/$($global:tvdbid)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data.artworks) {
                    foreach ($lang in $global:PreferredLanguageOrderTVDB) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '14' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '14' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                            }
                        }
                        Else {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '14' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '14' } | Sort-Object Score -Descending)
                            }
                        }
                        if ($LangArtwork) {
                            $global:posterurl = $LangArtwork[0].image
                            if ($global:WidthHeightFilter -eq 'true') {
                                Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            if ($lang -eq 'null') {
                                Write-Entry -Subtext "Found Poster without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                                $global:TextlessPoster = $true
                                $global:PosterWithText = $null
                            }
                            Else {
                                Write-Entry -Subtext "Found Poster with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            if ($lang -ne 'null') {
                                $global:PosterWithText = $true
                                $global:TVDBAssetTextLang = $lang
                            }
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                            return $global:posterurl
                            continue
                        }
                    }
                }
                Else {
                    Write-Entry -Subtext "No Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
            }
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetTVDBMovieBackground {
    if ($global:tvdbid) {
        if ($global:BackgroundPreferTextless -eq $true) {
            Write-Entry -Subtext "Searching on TVDB for a movie Background - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/movies/$($global:tvdbid)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data.artworks) {
                    if ($global:WidthHeightFilter -eq 'true') {
                        $NoLangArtwork = $response.data.artworks | Where-Object { $null -eq $_.language -and $_.type -eq '15' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }
                    }
                    Else {
                        $NoLangArtwork = $response.data.artworks | Where-Object { $null -eq $_.language -and $_.type -eq '15' }
                    }
                    if ($NoLangArtwork) {
                        $global:posterurl = ($NoLangArtwork | Sort-Object Score -Descending)[0].image
                        if ($global:WidthHeightFilter -eq 'true') {
                            Write-Entry -Subtext "Found a poster sized at - width: $(($NoLangArtwork | Sort-Object Score -Descending)[0].width) | height: $(($NoLangArtwork | Sort-Object Score -Descending)[0].height)" -Path $global:configLogging -Color White -log Info
                        }
                        Write-Entry -Subtext "Found Textless Background on TVDB" -Path $global:configLogging -Color Blue -log Info
                        $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                        return $global:posterurl
                    }
                    Else {
                        Write-Entry -Subtext "PreferTextless Value: $global:BackgroundPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "OnlyTextless Value: $global:BackgroundOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                        if ($global:BackgroundOnlyTextless -eq $false) {
                            # Trying other languages
                            foreach ($lang in $global:PreferredBackgroundLanguageOrderTVDB) {
                                if ($global:WidthHeightFilter -eq 'true') {
                                    if ($lang -eq 'null') {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '15' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight } | Sort-Object Score -Descending)
                                    }
                                    Else {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '15' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight } | Sort-Object Score -Descending)
                                    }
                                }
                                Else {
                                    if ($lang -eq 'null') {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '15' } | Sort-Object Score -Descending)
                                    }
                                    Else {
                                        $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '15' } | Sort-Object Score -Descending)
                                    }
                                }
                                if ($LangArtwork) {
                                    $global:posterurl = $LangArtwork[0].image
                                    if ($global:WidthHeightFilter -eq 'true') {
                                        Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                                    }
                                    if ($lang -eq 'null') {
                                        Write-Entry -Subtext "Found Background without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                                    }
                                    Else {
                                        Write-Entry -Subtext "Found Background with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                                    }
                                    if ($lang -ne 'null') {
                                        $global:PosterWithText = $true
                                        $global:TVDBAssetTextLang = $lang
                                        if ($global:FavProvider -eq 'TVDB') {
                                            $global:Fallback = "TMDB"
                                            $global:TVDBfallbackposterurl = $LangArtwork[0].image
                                        }
                                    }
                                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                                    return $global:posterurl
                                    continue
                                }
                            }
                            if (!$global:posterurl) {
                                Write-Entry -Subtext "No background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                                $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Found background with text on TVDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                        }
                    }
                }
                Else {
                    Write-Entry -Subtext "No Background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
            }
        }
        Else {
            Write-Entry -Subtext "Searching on TVDB for a movie Background" -Path $global:configLogging -Color Cyan -log Info
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/movies/$($global:tvdbid)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data.artworks) {
                    foreach ($lang in $global:PreferredBackgroundLanguageOrderTVDB) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '15' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '15' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight } | Sort-Object Score -Descending)
                            }
                        }
                        Else {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '15' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '15' } | Sort-Object Score -Descending)
                            }
                        }
                        if ($LangArtwork) {
                            $global:posterurl = $LangArtwork[0].image
                            if ($global:WidthHeightFilter -eq 'true') {
                                Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            if ($lang -eq 'null') {
                                Write-Entry -Subtext "Found Background without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            Else {
                                Write-Entry -Subtext "Found Background with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            if ($lang -ne 'null') {
                                $global:PosterWithText = $true
                                $global:TVDBAssetTextLang = $lang
                            }
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                            return $global:posterurl
                            continue
                        }
                    }
                    if (!$global:posterurl) {
                        Write-Entry -Subtext "No background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                        $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                    }
                }
                Else {
                    Write-Entry -Subtext "No Background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/movies/$($response.data.slug)#artwork"
            }
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetTVDBShowPoster {
    if ($global:tvdbid) {
        Write-Entry -Subtext "Searching on TVDB for a poster - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
        if ($global:PosterPreferTextless -eq $true) {
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/series/$($global:tvdbid)/artworks" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data) {
                    $defaultImageurl = $response.data.image
                    if ($global:WidthHeightFilter -eq 'true') {
                        $NoLangImageUrl = $response.data.artworks | Where-Object { $null -eq $_.language -and $_.type -eq '2' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight }
                    }
                    Else {
                        $NoLangImageUrl = $response.data.artworks | Where-Object { $null -eq $_.language -and $_.type -eq '2' }
                    }
                    if ($NoLangImageUrl) {
                        $global:posterurl = $NoLangImageUrl[0].image
                        if ($global:WidthHeightFilter -eq 'true') {
                            Write-Entry -Subtext "Found a poster sized at - width: $($NoLangImageUrl[0].width) | height: $($NoLangImageUrl[0].height)" -Path $global:configLogging -Color White -log Info
                        }
                        Write-Entry -Subtext "Found Textless Poster on TVDB" -Path $global:configLogging -Color Blue -log Info
                        $global:TextlessPoster = $true
                        $global:PosterWithText = $null
                        $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
                    }
                    Else {
                        Write-Entry -Subtext "PreferTextless Value: $global:PosterPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                        Write-Entry -Subtext "OnlyTextless Value: $global:PosterOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                        if ($global:PosterOnlyTextless -eq $false) {
                            $global:posterurl = $defaultImageurl
                            Write-Entry -Subtext "Found Poster with text on TVDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
                            if ($global:FavProvider -ne 'TVDB') {
                                if (!$global:tmdbsearched) {
                                    $global:Fallback = "TMDB"
                                }
                                $global:TVDBfallbackposterurl = $global:posterurl
                            }
                        }
                        Else {
                            Write-Entry -Subtext "Found Poster with text on TVDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
                        }
                    }
                    return $global:posterurl
                }
                Else {
                    Write-Entry -Subtext "No Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
            }
        }
        Else {
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/series/$($global:tvdbid)/artworks" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data) {
                    foreach ($lang in $global:PreferredLanguageOrderTVDB) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '2' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '2' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                            }
                        }
                        Else {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '2' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '2' } | Sort-Object Score -Descending)
                            }
                        }
                        if ($LangArtwork) {
                            $global:posterurl = $LangArtwork[0].image
                            if ($global:WidthHeightFilter -eq 'true') {
                                Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            if ($lang -eq 'null') {
                                Write-Entry -Subtext "Found Poster without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                                $global:TextlessPoster = $true
                                $global:PosterWithText = $null
                            }
                            Else {
                                Write-Entry -Subtext "Found Poster with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            if ($lang -ne 'null') {
                                $global:PosterWithText = $true
                                $global:TVDBAssetTextLang = $lang
                            }
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
                            return $global:posterurl
                            continue
                        }
                    }
                }
                Else {
                    Write-Entry -Subtext "No Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)#artwork"
            }
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetTVDBSeasonPoster {
    if ($global:tvdbid) {
        Write-Entry -Subtext "Searching on TVDB for a Season poster - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
        try {
            $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/series/$($global:tvdbid)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
        }
        catch {
            Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

        }
        if ($response) {
            if ($response.data.seasons) {
                # Select season id from current Season number
                $SeasonID = $response.data.seasons | Where-Object { $_.number -eq $global:SeasonNumber -and $_.type.type -eq 'official' }
                if (!$SeasonID) {
                    $SeasonID = $response.data.seasons | Where-Object { $_.number -eq $global:SeasonNumber -and $_.type.type -eq 'alternate' }
                }
                try {
                    $Seasonresponse = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/seasons/$($SeasonID.id)/extended" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
                }
                catch {
                    Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                    $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                }
                if ($Seasonresponse) {
                    foreach ($lang in $global:PreferredSeasonLanguageOrderTVDB) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($Seasonresponse.data.artwork | Where-Object { $_.language -like "" -and $_.type -eq '7' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($Seasonresponse.data.artwork  | Where-Object { $_.language -like "$lang*" -and $_.type -eq '7' -and $_.width -ge $global:PosterMinWidth -and $_.height -ge $global:PosterMinHeight } | Sort-Object Score -Descending)
                            }
                        }
                        Else {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($Seasonresponse.data.artwork | Where-Object { $_.language -like "" -and $_.type -eq '7' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($Seasonresponse.data.artwork  | Where-Object { $_.language -like "$lang*" -and $_.type -eq '7' } | Sort-Object Score -Descending)
                            }
                        }
                        if ($LangArtwork) {
                            $global:posterurl = $LangArtwork[0].image
                            if ($global:WidthHeightFilter -eq 'true') {
                                Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            if ($lang -eq 'null') {
                                Write-Entry -Subtext "Found Season Poster without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                                $global:TextlessPoster = $true
                                $global:PosterWithText = $null
                            }
                            Else {
                                Write-Entry -Subtext "Found Season Poster with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            if ($lang -ne 'null') {
                                $global:PosterWithText = $true
                                $global:TVDBAssetTextLang = $lang
                            }
                            if (!$global:SeasonOnlyTextless -and !$global:TextlessPoster) {
                                $global:TVDBSeasonFallback = $global:posterurl
                            }
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/seasons/$($Seasonresponse.data.type.type)/$global:SeasonNumber#artwork"
                            Write-Entry -Subtext "LangArtwork: $LangArtwork" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "PosterUrl: $(RedactMediaServerUrl -url $global:posterurl)" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "TextlessPoster: $global:TextlessPoster" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "PosterWithText: $global:PosterWithText" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "TVDBAssetTextLang: $global:TVDBAssetTextLang" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "TVDBAssetChangeUrl: $global:TVDBAssetChangeUrl" -Path $global:configLogging -Color Cyan -log Debug
                            if ($global:SeasonOnlyTextless -and $global:PosterWithText) {
                                continue
                            }
                            Else {
                                return $global:posterurl
                            }
                            continue
                        }
                    }
                    if (!$global:posterurl -and $global:PosterOnlyTextless -eq $true) {
                        Write-Entry -Subtext "No Textless Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    }
                    Else {
                        Write-Entry -Subtext "No Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    }
                }
                return $global:posterurl
            }
            Else {
                Write-Entry -Subtext "No Poster found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/seasons/$($Seasonresponse.data.type.type)/$global:SeasonNumber#artwork"
            }
        }
        Else {
            Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/seasons/$($Seasonresponse.data.type.type)/$global:SeasonNumber#artwork"
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetTVDBShowBackground {
    if ($global:tvdbid) {
        Write-Entry -Subtext "Searching on TVDB for a background - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
        if ($global:BackgroundPreferTextless -eq $true) {
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/series/$($global:tvdbid)/artworks" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data -and $response.data.artworks) {
                    $artworksOfType3 = $response.data.artworks | Where-Object { $_.type -eq '3' }
                    if ($artworksOfType3) {
                        $defaultImageurltemp = $artworksOfType3
                        if ($defaultImageurltemp) {
                            $defaultImageurl = $defaultImageurltemp[0].image
                        }
                        if ($global:WidthHeightFilter -eq 'true') {
                            $NoLangImageUrl = $response.data.artworks | Where-Object { $_.language -eq $null -and $_.type -eq '3' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight }
                        }
                        Else {
                            $NoLangImageUrl = $response.data.artworks | Where-Object { $_.language -eq $null -and $_.type -eq '3' }
                        }
                        if ($NoLangImageUrl) {
                            $global:posterurl = $NoLangImageUrl[0].image
                            if ($global:WidthHeightFilter -eq 'true') {
                                Write-Entry -Subtext "Found a poster sized at - width: $($NoLangImageUrl[0].width) | height: $($NoLangImageUrl[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            Write-Entry -Subtext "Found Textless background on TVDB" -Path $global:configLogging -Color Blue -log Info
                            $global:TextlessPoster = $true
                            $global:PosterWithText = $null
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                        }
                        Else {
                            Write-Entry -Subtext "PreferTextless Value: $global:BackgroundPreferTextless" -Path $global:configLogging -Color Cyan -log Debug
                            Write-Entry -Subtext "OnlyTextless Value: $global:BackgroundOnlyTextless" -Path $global:configLogging -Color Cyan -log Debug
                            if ($global:BackgroundOnlyTextless -eq $false) {
                                $global:posterurl = $defaultImageurl
                                Write-Entry -Subtext "Found background with text on TVDB" -Path $global:configLogging -Color Blue -log Info
                                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                            }
                            Else {
                                Write-Entry -Subtext "Found Poster with text on TVDB, skipping because you only want textless..." -Path $global:configLogging -Color Yellow -log Info
                                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                            }
                        }
                        return $global:posterurl
                    }
                    Else {
                        Write-Entry -Subtext "No background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                        $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                    }
                }
                Else {
                    Write-Entry -Subtext "No data returned from API at all" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
            }
        }
        Else {
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/series/$($global:tvdbid)/artworks" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

            }
            if ($response) {
                if ($response.data) {
                    foreach ($lang in $global:PreferredBackgroundLanguageOrderTVDB) {
                        if ($global:WidthHeightFilter -eq 'true') {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '3' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '3' -and $_.width -ge $global:BgTcMinWidth -and $_.height -ge $global:BgTcMinHeight } | Sort-Object Score -Descending)
                            }
                        }
                        Else {
                            if ($lang -eq 'null') {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "" -and $_.type -eq '3' } | Sort-Object Score -Descending)
                            }
                            Else {
                                $LangArtwork = ($response.data.artworks | Where-Object { $_.language -like "$lang*" -and $_.type -eq '3' } | Sort-Object Score -Descending)
                            }
                        }
                        if ($LangArtwork) {
                            $global:posterurl = $LangArtwork[0].image
                            if ($global:WidthHeightFilter -eq 'true') {
                                Write-Entry -Subtext "Found a poster sized at - width: $($LangArtwork[0].width) | height: $($LangArtwork[0].height)" -Path $global:configLogging -Color White -log Info
                            }
                            if ($lang -eq 'null') {
                                Write-Entry -Subtext "Found background without Language on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            Else {
                                Write-Entry -Subtext "Found background with Language '$lang' on TVDB" -Path $global:configLogging -Color Blue -log Info
                            }
                            if ($lang -ne 'null') {
                                $global:PosterWithText = $true
                                $global:TVDBAssetTextLang = $lang
                            }
                            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"

                            return $global:posterurl
                            continue
                        }
                    }
                    if (!$global:posterurl) {
                        Write-Entry -Subtext "No background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                        $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                    }
                }
                Else {
                    Write-Entry -Subtext "No background found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
                }
            }
            Else {
                Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"
            }
        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetTVDBTitleCard {
    if ($global:tvdbid) {
        Write-Entry -Subtext "Searching on TVDB for: $global:show_name 'Season $global:season_number - Episode $global:episodenumber' Title Card - TVDBID: $global:tvdbid" -Path $global:configLogging -Color Cyan -log Info
        $allEpisodes = [System.Collections.Generic.List[object]]::new()
        $page = 0

        do {
            try {
                $response = (Invoke-WebRequest -Uri "https://api4.thetvdb.com/v4/series/$($global:tvdbid)/episodes/default?page=$page" -Method GET -Headers $global:tvdbheader).content | ConvertFrom-Json
                $episodes = $response.data.episodes
                $seriesData = $response.data

                if ($episodes) {
                    $allEpisodes.Add($seriesData)
                    $page++
                }
            }
            catch {
                Write-Entry -Subtext "Could not query TVDB url, error message: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error

                break
            }
        } while ($episodes -and $episodes.Count -gt 0)

        # Now $allEpisodes contains all the episodes retrieved from the API

        if ($response) {
            if ($allEpisodes.episodes) {
                $global:NoLangImageUrl = $allEpisodes.episodes | Where-Object { $_.seasonNumber -eq $global:season_number -and $_.number -eq $global:episodenumber }
                if ($global:NoLangImageUrl.image) {
                    $global:posterurl = $global:NoLangImageUrl.image
                    Write-Entry -Subtext "Found Title Card on TVDB" -Path $global:configLogging -Color Blue -log Info
                    $global:TextlessPoster = $true
                    $global:PosterWithText = $null
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($allEpisodes.series.slug)/episodes/$($global:NoLangImageUrl.id)"

                    return $global:NoLangImageUrl.image
                }
                Else {
                    Write-Entry -Subtext "No Title Card found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                    $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($allEpisodes.slug)/#artwork"

                }
            }
            Else {
                Write-Entry -Subtext "No Title Card found on TVDB" -Path $global:configLogging -Color Yellow -log Warning
                $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($allEpisodes.slug)/#artwork"

            }
        }
        Else {
            Write-Entry -Subtext "TVDB API response is null" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; Write-Entry -Subtext "[ERROR-HERE] See above. ^^^ errorCount: $errorCount" -Path $global:configLogging -Color Red -log Error
            $global:TVDBAssetChangeUrl = "https://thetvdb.com/series/$($response.data.slug)/#artwork"

        }
    }
    Else {
        Write-Entry -Subtext "Cannot search on TVDB, missing ID..." -Path $global:configLogging -Color Yellow -log Warning
    }
}
function GetIMDBPoster {
    try {
        $response = Invoke-WebRequest -Uri "https://www.imdb.com/title/$($global:imdbid)/mediaviewer" -Method GET -TimeoutSec 20 -ErrorAction Stop
    }
    catch {
        Write-Entry -Subtext "IMDB request timed out or failed: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
        return
    }
    if ($null -ne $response -and $null -ne $response.images -and $null -ne $response.images.src -and $response.images.src.Count -gt 1) {
        $global:posterurl = $response.images.src[1]
    } else {
        Write-Entry -Subtext "Could not parse IMDB images from response. IMDB may have changed or the request failed." -Path $global:configLogging -Color Yellow -log Warning
        $global:posterurl = $null
    }
    if (!$global:posterurl) {
        Write-Entry -Subtext "No show match or poster found on IMDB" -Path $global:configLogging -Color Yellow -log Warning
    }
    Else {
        Write-Entry -Subtext "Found Poster with text on IMDB" -Path $global:configLogging -Color Blue -log Info
        return $global:posterurl
    }
}
function GetPlexArtwork {
    param(
        [string]$Type,
        [string]$ArtUrl,
        [string]$TempImage
    )

    Write-Entry -Subtext "Checking Plex metadata for $Type..." -Path $global:configLogging -Color Cyan -log Info

    $ExifFound = $false

    try {
        $client = New-Object System.Net.Http.HttpClient
        # Request only the first 64KB for EXIF/Metadata
        $client.DefaultRequestHeaders.Range = New-Object System.Net.Http.Headers.RangeHeaderValue(0, 65536)

        # Add Plex Headers
        $requestHeaders = $extraPlexHeaders.Clone()
        if ($OtherMediaServerUrl -and $ArtUrl.StartsWith($OtherMediaServerUrl)) {
            foreach ($key in $global:OtherMediaServerHeaders.Keys) {
                $requestHeaders[$key] = $global:OtherMediaServerHeaders[$key]
            }
        }
        foreach ($key in $requestHeaders.Keys) {
            $client.DefaultRequestHeaders.TryAddWithoutValidation($key, $requestHeaders[$key])
        }

        $task = $client.GetByteArrayAsync($ArtUrl)
        $buffer = $task.GetAwaiter().GetResult()
        $client.Dispose()

        # Check for markers
        $content = [System.Text.Encoding]::UTF8.GetString($buffer)
        if ($content -match 'overlay|titlecard|created with ppm|created with posterizarr') {
            $ExifFound = $true
        }
    }
    catch {
        Write-Entry -Subtext "Fast-Scan failed for $Type. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning
        try {
            Invoke-WebRequest -Uri $ArtUrl -OutFile $TempImage -Headers $requestHeaders
            $magickcommand = "& `"$magick`" identify -verbose `"$TempImage`""
            if (Invoke-Expression $magickcommand | Select-String -Pattern 'overlay|titlecard|created with ppm|created with posterizarr') {
                $ExifFound = $true
            }
        }
        catch {
            Write-Entry -Subtext "Could not download Artwork from plex: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
            $global:errorCount = Increment-GlobalStat 'errorCount'; return
        }
    }

    if ($ExifFound -and $DisableHashValidation -eq 'false') {
        if ($global:UploadExistingAssets -eq 'true') {
            Write-Entry -Subtext "Plex artwork already has EXIF (posterizarr/kometa/tcm), skipping..." -Path $global:configLogging -Color Yellow -log Warning
        }
        else {
            Write-Entry -Subtext "Plex artwork already processed, cannot use as source..." -Path $global:configLogging -Color Yellow -log Warning
        }
        if (Test-Path -LiteralPath $TempImage) {
            Remove-Item -LiteralPath $TempImage -Force -ErrorAction SilentlyContinue -WarningAction SilentlyContinue | Out-Null
        }
    }
    else {
        # Only download the FULL image if needed
        Write-Entry -Subtext "No EXIF found or validation disabled, downloading full $Type..." -Path $global:configLogging -Color Green -log Info
        try {
            Invoke-WebRequest -Uri $ArtUrl -OutFile $TempImage -Headers $requestHeaders
            $global:PlexartworkDownloaded = $true
            $global:posterurl = $ArtUrl
        }
        catch {
            Write-Entry -Subtext "Full download failed: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
        }
    }
}
function UploadOtherMediaServerArtwork {
    param (
        [string]$itemId,
        [string]$imageType,
        [string]$imagePath,
        [switch]$SkipExifCheck # Added optional parameter
    )

    $userAssetType = $imageType
    if ($imageType -eq 'Backdrop') {
        $userAssetType = "Background"
    }
    elseif ($imageType -eq 'Primary') {
        $filename = [System.IO.Path]::GetFileName($imagePath)
        if ($filename -match 'S\d{2}E\d{2}') {
            $userAssetType = "TitleCard"
        }
        elseif ($filename -match '(?i)season\d{2}') {
            $userAssetType = "Season Poster"
        }
        else {
            $userAssetType = "Poster"
        }
    }

    # Check if current image already has exif data
    $headers = @{
        "Authorization" = "MediaBrowser Token=`"$OtherMediaServerApiKey`""
    }
    $Imageinfo = Invoke-RestMethod -Method Get -Uri "$OtherMediaServerUrl/items/$itemId/images" -Headers $headers
    $Imageinfotemp = $Imageinfo | Where-Object imagetype -eq $imageType | Select-Object Height, Width, Path
    if ($Imageinfotemp) {
        $Imageinfotemp = $imageinfotemp[0]
    }
    # Clear value to ensure no old data causes a false skip
    $value = $null

    # Only run the EXIF check if the switch was NOT provided
    if (-not $SkipExifCheck) {
        # Set the API endpoint URL for magick exif check
        if (($imageinfotemp.Height) -and ($imageinfotemp.width)) {
            try {
                $ImageUrl = "$OtherMediaServerUrl/items/$itemId/images/$imageType/?width=$($imageinfotemp.width)&height=$($imageinfotemp.Height)"
                $guid = [guid]::NewGuid().ToString()
                $tempFile = Join-Path -Path $global:ScriptRoot -ChildPath "temp\hashcompare_$guid.jpg"

                # Try to download the image
                $response = Invoke-WebRequest -Uri $ImageUrl -OutFile $tempFile -Headers $headers -ErrorAction Stop

                $magickcommand = "& `"$magick`" identify -verbose `"$tempFile`""
                $magickcommand | Out-File $magickLog -Append
                $value = Invoke-Expression $magickcommand | Select-String -Pattern 'overlay|titlecard|created with ppm|created with posterizarr'

                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue | out-null
            }
            catch {
                # Log as a warning (not error) so we know why the check failed, but don't stop the script
                Write-Entry -Subtext "Exif check skipped (Image 404 or missing). Proceeding to upload. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Yellow -log Warning

                # Ensure temp file cleanup happens if the download partially succeeded or failed
                if (Test-Path $tempFile) {
                    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue | out-null
                }
            }
        }
    }

    if ($value -and $DisableHashValidation -eq 'false') {
        $ExifFound = $True
        Write-Entry -Subtext "Artwork has exif data from posterizarr/kometa/tcm, skip upload..." -Path $global:configLogging -Color Yellow -log Warning
    }
    Else {
        if ($DisableHashValidation -eq 'false') {
            Write-Entry -Subtext "No posterizarr/kometa/tcm exif data found, starting upload..." -Path $global:configLogging -Color Green -log Info
        }
        # Read the image file as binary
        $imageData = [System.IO.File]::ReadAllBytes($imagePath)

        # Convert the image to a base64 string
        $imageBase64 = [Convert]::ToBase64String($imageData)

        # Determine the content type based on the file extension
        switch ([System.IO.Path]::GetExtension($imagePath).ToLower()) {
            ".jpg" { $contentType = "image/jpeg" }
            ".jpeg" { $contentType = "image/jpeg" }
            ".png" { $contentType = "image/png" }
            ".gif" { $contentType = "image/gif" }
            ".bmp" { $contentType = "image/bmp" }
            ".tiff" { $contentType = "image/tiff" }
            default {
                Write-Entry -Subtext "Unsupported image format." -Path $global:configLogging -Color Red -log Error
                # Clear Running File
                HandleScriptExit -Message "Unsupported image format"
            }
        }

        # Set the API endpoint URL
        $apiUrl = "$OtherMediaServerUrl/items/$itemId/images/$imageType/"

        if ($imageType -eq "Backdrop") {
            $deleteUrl = "$OtherMediaServerUrl/items/$itemId/images/$imageType/0"
            # Make the API request to delete the backdrop image
            try {
                # Delete the existing image first
                $response = Invoke-RestMethod -Uri $deleteUrl -Method Delete -ErrorAction Stop -Headers $global:OtherMediaServerHeaders
                Write-Entry -Subtext "Image successfully deleted..." -Path $global:configLogging -Color Green -log Info
                $UploadCount++
            }
            catch {
                if ($_.Exception.Response -is [System.Net.Http.HttpResponseMessage] -and $_.Exception.Response.Content) {
                    try {
                        $response = $_.Exception.Response.Content.ReadAsStringAsync().Result
                    }
                    catch {
                        $response = "Unable to read server response (content may be disposed)."
                    }
                    Write-Entry -Subtext "Failed to delete image. Server response: $response" -Path $global:configLogging -Color Red -log Error
                }
                else {
                    Write-Entry -Subtext "Failed to delete image. Error: $_" -Path $global:configLogging -Color Red -log Error
                }
            }
            if ($global:ReplaceThumbwithBackdrop -eq 'true') {
                # Make the API request to upload the Thumb image
                $thumbapiUrl = "$OtherMediaServerUrl/items/$itemId/images/Thumb/"
                try {
                    $response = Invoke-RestMethod -Uri $thumbapiUrl -Method Post -Body $imageBase64 -ContentType $contentType -ErrorAction Stop -Headers $global:OtherMediaServerHeaders

                    $logTitle = if ($Titletext) { "$Titletext " } else { "" }
                    Write-Entry -Subtext "$($logTitle)Thumb successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                    $UploadCount++
                }
                catch {
                    if ($_.Exception.Response -is [System.Net.Http.HttpResponseMessage] -and $_.Exception.Response.Content) {
                        try {
                            $response = $_.Exception.Response.Content.ReadAsStringAsync().Result
                        }
                        catch {
                            $response = "Unable to read server response (content may be disposed)."
                        }
                        Write-Entry -Subtext "Failed to upload Thumb image. Server response: $response" -Path $global:configLogging -Color Red -log Error
                    }
                    else {
                        Write-Entry -Subtext "Failed to upload Thumb image. Error: $_" -Path $global:configLogging -Color Red -log Error
                    }
                }
            }
        }
        # Make the API request to upload the image
        $maxRetries = 3
        $retryCount = 0
        $success = $false

        while (-not $success -and $retryCount -lt $maxRetries) {
            try {
                $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Body $imageBase64 -ContentType $contentType -ErrorAction Stop -Headers $global:OtherMediaServerHeaders
                $success = $true
                $logTitle = if ($Titletext) { "$Titletext " } else { "" }
                Write-Entry -Subtext "$($logTitle)$userAssetType successfully uploaded..." -Path $global:configLogging -Color Green -log Info
                $UploadCount++
            }
            catch {
                $retryCount++
                if ($retryCount -ge $maxRetries) {
                    if ($_.Exception.Response -is [System.Net.Http.HttpResponseMessage] -and $_.Exception.Response.Content) {
                        try {
                            $responseMsg = $_.Exception.Response.Content.ReadAsStringAsync().Result
                        }
                        catch {
                            $responseMsg = "Unable to read server response (content may be disposed)."
                        }
                        Write-Entry -Subtext "Failed to upload image after $maxRetries attempts. Server response: $responseMsg" -Path $global:configLogging -Color Red -log Error
                    }
                    else {
                        Write-Entry -Subtext "Failed to upload image after $maxRetries attempts. Error: $_" -Path $global:configLogging -Color Red -log Error
                    }
                } else {
                    Write-Entry -Subtext "Upload failed, retrying ($retryCount/$maxRetries)..." -Path $global:configLogging -Color Yellow -log Warning
                    Start-Sleep -Seconds (Get-Random -Minimum 1 -Maximum 4)
                }
            }
        }
    }
}
