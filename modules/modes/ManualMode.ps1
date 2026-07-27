#region Manual Mode
    $global:posterCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['posterCount'] = 0 }
    $global:BackgroundCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['BackgroundCount'] = 0 }
    $global:EpisodeCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['EpisodeCount'] = 0 }
    $global:SeasonCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['SeasonCount'] = 0 }
    $global:collectionCount = 0
    if ($global:runspaceStats) { $global:runspaceStats['collectionCount'] = 0 }
    $Mode = "manual"

    Write-Entry -Message "Manual Poster Creation Started" -Path $global:configLogging -Color DarkMagenta -log Info

    if ($global:PosterWithText) {
        Write-Entry -Message "Source asset language detection: Has Text" -Path $global:configLogging -Color Cyan -log Info
    } else {
        Write-Entry -Message "Source asset language detection: Textless" -Path $global:configLogging -Color Cyan -log Info
    }
    # Regex to find a positive number (1 or greater) at the end of the string
    $seasonNumberPattern = '([1-9]\d*)$'

    # Regex to extract title excluding "Season X" patterns
    $ExtractedTitleRegex = '^\s*(?:Season\s*\d+\s*\|\s*)?(.*?)(?:\s*\|\s*Season\s*\d+)?\s*$'

    # Regex to find "Specials" keywords or the numbers 0/00
    $specialsPattern = '^(?:Specials|Extras|Spéciaux|0{1,2}|[Ss]eason ?0{1,2})$' # Add any other language keywords here

    if ([string]::IsNullOrEmpty($PicturePath)) {
        $TriggeredViaCli = 'true'
        $PicturePath = Read-Host "Enter local path or url to source picture"

        # 1. Define all poster-related parameters
        $posterParams = @(
            'SeasonPoster', 'MoviePosterCard', 'ShowPosterCard',
            'TitleCard', 'CollectionCard', 'BackgroundCard'
        )

        # 2. Check if *any* of them were provided when the script was run
        $anyPosterParamBound = $posterParams.Where({ $MainPSBoundParameters.ContainsKey($_) }).Count -gt 0

        # 3. Only ask questions if *none* were provided
        if (-not $anyPosterParamBound) {
            Write-Host "No poster types specified. Please select which to create."

            # Define the variable names and their prompts
            $posterPrompts = [Ordered]@{
                'SeasonPoster'    = "Create Season Poster?"
                'MoviePosterCard' = "Create Movie Poster?"
                'ShowPosterCard'  = "Create Show Poster?"
                'TitleCard'       = "Create TitleCard?"
                'CollectionCard'  = "Create Collection?"
                'BackgroundCard'  = "Create Background?"
            }

            # Loop through each and ask the user
            foreach ($item in $posterPrompts.GetEnumerator()) {
                $response = Read-Host "$($item.Value) (y/n)"
                if ($response.ToLower() -eq 'y') {
                    # This sets the variable (e.g., $SeasonPoster) to $true
                    Set-Variable -Name $item.Key -Value $true
                }
            }
        }

        # Error handling for missing selection (CORRECTED to check all types)
        if (-not ($SeasonPoster -or $MoviePosterCard -or $ShowPosterCard -or $TitleCard -or $CollectionCard -or $BackgroundCard)) {
            Write-Entry -Message "No poster type selected. Please select at least one type." -Path $global:configLogging -Color Red -log Error

            HandleScriptExit -Message "No poster type selected"
        }
    }

    # Error handling for missing picture path
    if ([string]::IsNullOrEmpty($PicturePath)) {
        Write-Entry -Message "No picture path provided. A source picture is required." -Path $global:configLogging -Color Red -log Error
        HandleScriptExit -Message "Missing picture path"
    }

    # Starting to gather more info
    if ($CollectionCard) {
        if ([string]::IsNullOrEmpty($Titletext)) {
            $Titletext = Read-Host "Enter Movie/Show/Collection Title"
        }
        if ([string]::IsNullOrEmpty($FolderName)) {
            $FolderName = Read-Host "Enter Asset Foldername"
        }
    }
    else {
        if ([string]::IsNullOrEmpty($FolderName)) {
            $FolderName = Read-Host "Enter Media Foldername (how plex sees it)"
        }
        # Only prompt if the parameter was NOT passed at all
        if (-not $MainPSBoundParameters.ContainsKey('Titletext')) {
            $Titletext = Read-Host "Enter Movie/Show/Background Title"
        }
    }

    if ($PicturePath -like 'http*') {
        $isWebPic = 'true'
        $PicturePath = $PicturePath.replace('"', '')
    }
    Else {
        $PicturePath = $PicturePath.replace('"', '')
    }
    $FolderName = $FolderName.replace('"', '')
    $Titletext = $Titletext.replace('"', '')
    $SafeFolderName = $FolderName -replace '[\\/:*?"<>|\[\]{}]', '_'
    if ($MoviePosterCard) {
        $PosterType = "Movie"
    }
    Elseif ($ShowPosterCard) {
        $PosterType = "Show"
    }
    Else {
        $PosterType = "Poster"
    }
    if ($LibraryFolders -eq 'true') {
        if ([string]::IsNullOrEmpty($LibraryName)) {
            $LibraryName = Read-Host "Enter Plex Library Name"
        }
        $LibraryName = $LibraryName.replace('"', '')

        $PosterImageoriginal = "$AssetPath\$LibraryName\$FolderName\poster.jpg"

        # Create Folder if Missing
        if (-not $collectionCard) {
            $TargetFolder = Join-Path -Path "$AssetPath\$LibraryName" -ChildPath $FolderName
            New-Item -ItemType Directory -Path $TargetFolder -Force | Out-Null
        }
        if ($SeasonPoster) {
            $PosterType = "Season"
            if ([string]::IsNullOrEmpty($SeasonPosterName)) {
                $SeasonPosterName = Read-Host "Enter Season Name"
                if ($SeasonPosterName -match $ExtractedTitleRegex) {
                    $global:ExtractedTitle = $Matches[1]
                }
            }
            if ($SeasonPosterName -match $seasonNumberPattern) {
                $global:SeasonNumber = $Matches[1]
                $global:seasontmp = "Season" + $global:SeasonNumber.PadLeft(2, '0')
                if ($SeasonPosterName -match $ExtractedTitleRegex) {
                    $global:ExtractedTitle = $Matches[1]
                }
            }
            Elseif ($SeasonPosterName -match $specialsPattern) {
                $global:seasontmp = "Season00"
                if ($SeasonPosterName -match $ExtractedTitleRegex) {
                    $global:ExtractedTitle = $Matches[1]
                }
            }
            Else {
                Write-Entry -Subtext "Could not match Season name..." -Path $global:configLogging -Color Yellow -log Warning
                if ($TriggeredViaCli -eq 'true') {
                    $seasontemp = Read-Host "Please enter Season Name for the local file (eq. Season 0 or Season 1....)"
                }
                if ($seasontemp -match $seasonNumberPattern) {
                    $global:SeasonNumber = $Matches[1]
                    $global:seasontmp = "Season" + $global:SeasonNumber.PadLeft(2, '0')
                }
                else {
                    Write-Entry -Subtext "Invalid season format. Please enter something like Season00 or Season01." -Path $global:configLogging -Color Yellow -log Warning
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
                    Exit
                }
            }
            $PosterImageoriginal = "$AssetPath\$LibraryName\$FolderName\$global:seasontmp.jpg"
            # Create Folder if Missing
            $TargetFolder = Join-Path -Path "$AssetPath\$LibraryName" -ChildPath $FolderName
            New-Item -ItemType Directory -Path $TargetFolder -Force | Out-Null
        }
        Elseif ($CollectionCard) {
            $PosterType = "Collection"
            $PosterImageoriginal = "$AssetPath\Collections\$LibraryName\$SafeFolderName\poster.jpg"
            $CollectionPath = "$AssetPath\Collections\$LibraryName\$SafeFolderName"
            # Ensure the Collection directory exists
            if (!(Test-Path $CollectionPath)) {
                try {
                    New-Item -ItemType Directory -Path $CollectionPath -Force | Out-Null
                    Write-Entry -Subtext "Created Collection directory: $CollectionPath" -Path $global:configLogging -Color Green -log Info
                }
                catch {
                    Write-Entry -Subtext "Failed to create Collection directory: $CollectionPath - Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                    return
                }
            }
        }
        Elseif ($TitleCard) {
            $PosterType = "Episode"
            if ($EPTitleName -eq $null) { $EPTitleName = Read-Host "Enter Episode Title Name" }
            if ([string]::IsNullOrEmpty($EpisodeNumber)) { $EpisodeNumber = Read-Host "Enter Episode Number (eq. 1)" }
            if ([string]::IsNullOrEmpty($SeasonPosterName)) { $SeasonPosterName = Read-Host "Enter Season Number (eq. 1)" }
            if ($SeasonPosterName -match $seasonNumberPattern) {
                $global:SeasonNumber = $Matches[1]
                $global:seasontmp = "S" + $global:SeasonNumber.PadLeft(2, '0')
            }
            if ($SeasonPosterName -eq $specialsPattern) {
                $global:seasontmp = "S00"
            }
            if ($EpisodeNumber -match '(\d+)') {
                $global:EpisodeNumber = $Matches[1]
                $global:episode = "E" + $global:EpisodeNumber.PadLeft(2, '0')
            }
            $PosterImageoriginal = "$AssetPath\$LibraryName\$FolderName\$global:seasontmp$global:episode.jpg"
            # Create Folder if Missing
            $TargetFolder = Join-Path -Path "$AssetPath\$LibraryName" -ChildPath $FolderName
            New-Item -ItemType Directory -Path $TargetFolder -Force | Out-Null
        }
        Elseif ($BackgroundCard) {
            if ($MoviePosterCard) {
                $PosterType = "Movie Background"
            }
            Elseif ($ShowPosterCard) {
                $PosterType = "Show Background"
            }
            else {
                $PosterType = "Background"
            }

            $PosterImageoriginal = "$AssetPath\$LibraryName\$FolderName\background.jpg"

            # Create Folder if Missing
            $TargetFolder = Join-Path -Path "$AssetPath\$LibraryName" -ChildPath $FolderName
            New-Item -ItemType Directory -Path $TargetFolder -Force | Out-Null
        }
    }
    Else {
        if ($SeasonPoster) {
            $PosterType = "Season"
            if ([string]::IsNullOrEmpty($SeasonPosterName)) {
                $SeasonPosterName = Read-Host "Enter Season Name"
                if ($SeasonPosterName -match $ExtractedTitleRegex) {
                    $global:ExtractedTitle = $Matches[1]
                }
            }
            if ($SeasonPosterName -match $seasonNumberPattern) {
                $global:SeasonNumber = $Matches[1]
                $global:seasontmp = "Season" + $global:SeasonNumber.PadLeft(2, '0')
                if ($SeasonPosterName -match $ExtractedTitleRegex) {
                    $global:ExtractedTitle = $Matches[1]
                }
            }
            Elseif ($SeasonPosterName -eq $specialsPattern) {
                $global:seasontmp = "Season00"
                if ($SeasonPosterName -match $ExtractedTitleRegex) {
                    $global:ExtractedTitle = $Matches[1]
                }
            }
            Else {
                Write-Entry -Subtext "Could not match Season name..." -Path $global:configLogging -Color Yellow -log Warning
                if ($TriggeredViaCli -eq 'true') {
                    $seasontemp = Read-Host "Please enter Season Name for the local file (eq. Season 0 or Season 1....)"
                }
                if ($seasontemp -match $seasonNumberPattern) {
                    $global:SeasonNumber = $Matches[1]
                    $global:seasontmp = "Season" + $global:SeasonNumber.PadLeft(2, '0')
                }
                else {
                    Write-Entry -Subtext "Invalid season format. Please enter something like Season00 or Season01." -Path $global:configLogging -Color Yellow -log Warning
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
                    Exit
                }
            }
            $PosterImageoriginal = "$AssetPath\$($FolderName)_$global:seasontmp.jpg"
        }
        Elseif ($CollectionCard) {
            $PosterType = "Collection"
            $PosterImageoriginal = "$AssetPath\Collections\$($SafeFolderName)_poster.jpg"
            $CollectionPath = "$AssetPath\Collections"
            # Ensure the Collection directory exists
            if (!(Test-Path $CollectionPath)) {
                try {
                    New-Item -ItemType Directory -Path $CollectionPath -Force | Out-Null
                    Write-Entry -Subtext "Created Collection directory: $CollectionPath" -Path $global:configLogging -Color Green -log Info
                }
                catch {
                    Write-Entry -Subtext "Failed to create Collection directory: $CollectionPath - Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                    return
                }
            }
        }
        Elseif ($TitleCard) {
            $PosterType = "Episode"
            if ($EPTitleName -eq $null) { $EPTitleName = Read-Host "Enter Episode Title Name" }
            if ([string]::IsNullOrEmpty($EpisodeNumber)) { $EpisodeNumber = Read-Host "Enter Episode Number (eq. 1)" }
            if ([string]::IsNullOrEmpty($SeasonPosterName)) { $SeasonPosterName = Read-Host "Enter Season Number (eq. 1)" }
            if ($SeasonPosterName -match $seasonNumberPattern) {
                $global:SeasonNumber = $Matches[1]
                $global:seasontmp = "S" + $global:SeasonNumber.PadLeft(2, '0')
            }
            if ($SeasonPosterName -eq $specialsPattern) {
                $global:seasontmp = "S00"
            }
            if ($EpisodeNumber -match '(\d+)') {
                $global:EpisodeNumber = $Matches[1]
                $global:episode = "E" + $global:EpisodeNumber.PadLeft(2, '0')
            }
            $PosterImageoriginal = "$AssetPath\$($FolderName)_$global:seasontmp$global:episode.jpg"
        }
        Elseif ($BackgroundCard) {
            if ($MoviePosterCard) {
                $PosterType = "Movie Background"
            }
            Elseif ($ShowPosterCard) {
                $PosterType = "Show Background"
            }
            else {
                $PosterType = "Background"
            }
            $PosterImageoriginal = "$AssetPath\$($FolderName)_background.jpg"
        }
    }

    if ($CollectionCard) {
        $PosterImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$SafeFolderName.jpg"
    }
    Else {
        $PosterImage = Join-Path -Path $global:ScriptRoot -ChildPath "temp\$FolderName.jpg"
    }
    $PosterImage = $PosterImage.Replace('[', '_').Replace(']', '_').Replace('{', '_').Replace('}', '_')
    $global:IsTruncated = $null
    if ($isWebPic -eq 'true') {
        Write-Entry -Subtext "Downloading Image from: $PicturePath" -Path $global:configLogging -Color White -log Info
        Invoke-WebRequest -Uri $PicturePath -OutFile $PosterImage
    }
    Else {
        Move-Item -LiteralPath $PicturePath -destination $PosterImage -Force -ErrorAction SilentlyContinue
    }
    if ($global:ImageProcessing -eq 'true') {
        if ($SeasonPoster) {
            if ($AddShowTitletoSeason -eq 'true') {
                if ($fontAllCaps -eq 'true') {
                    if ($global:ExtractedTitle) {
                        $joinedTitle = $global:ExtractedTitle.ToUpper()
                    }
                    else {
                        $joinedTitle = $SeasonPosterName.ToUpper()
                    }
                }
                Else {
                    if ($global:ExtractedTitle) {
                        $joinedTitle = $global:ExtractedTitle
                    }
                    else {
                        $joinedTitle = $SeasonPosterName
                    }
                }

                if ($ShowOnSeasonfontAllCaps -eq 'true') {
                    $ShowjoinedTitle = $titletext.ToUpper()
                }
                Else {
                    $ShowjoinedTitle = $titletext
                }
            }
            Else {
                if ($fontAllCaps -eq 'true') {
                    $joinedTitle = $titletext.ToUpper()
                }
                Else {
                    $joinedTitle = $titletext
                }
            }
        }
        elseif ($CollectionCard) {
            if ($AddCollectionTitle -eq 'true') {
                if ($CollectionTitleAllCaps -eq 'true') {
                    $CollectionjoinedTitle = $CollectionTitle.ToUpper()
                }
                Else {
                    $CollectionjoinedTitle = $CollectionTitle
                }

                if ($CollectionAllCaps -eq 'true') {
                    $joinedTitle = $titletext.ToUpper()
                }
                Else {
                    $joinedTitle = $titletext
                }
            }
            Else {
                if ($fontAllCaps -eq 'true') {
                    $joinedTitle = $titletext.ToUpper()
                }
                Else {
                    $joinedTitle = $titletext
                }
            }
        }
        elseif ($TitleCard) {
            if ($AddTitleCardEPTitleText -eq 'true') {
                if ($TitleCardEPTitlefontAllCaps -eq 'true') {
                    $joinedTitle = $EPTitleName.ToUpper()
                }
                Else {
                    $joinedTitle = $EPTitleName
                }
            }
            if ($AddTitleCardEPText -eq 'true') {
                $bullet = [char]0x2022
                $global:SeasonEPNumber = "$SeasonTCText $global:SeasonNumber $bullet $EpisodeTCText $global:EpisodeNumber"

                if ($TitleCardEPfontAllCaps -eq 'true') {
                    $EPNumberTitle = $global:SeasonEPNumber.ToUpper()
                }
                Else {
                    $EPNumberTitle = $global:SeasonEPNumber
                }
            }
        }
        elseif ($BackgroundCard) {
            if ($AddBackgroundText -eq 'true') {
                if ($BackgroundfontAllCaps -eq 'true') {
                    $joinedTitle = $Titletext.ToUpper()
                }
                Else {
                    $joinedTitle = $Titletext
                }
            }
        }
        Else {
            if ($fontAllCaps -eq 'true') {
                $joinedTitle = $Titletext.ToUpper()
            }
            Else {
                $joinedTitle = $Titletext
            }
        }
        if ($Titletext -match '^(http|https)://' -or $Titletext -match '\.(png|jpg|jpeg|webp)$') {
            Write-Entry -Subtext "Processing Poster/Logo for: `"$FolderName`"" -Path $global:configLogging -Color White -log Info
        }
        Else {
            Write-Entry -Subtext "Processing Poster for: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
        }

        $CommentArguments = "`"$PosterImage`" -set `"comment`" `"created with posterizarr`" `"$PosterImage`""
        $CommentlogEntry = "`"$magick`" $CommentArguments"
        $CommentlogEntry | Write-MagickLog
        InvokeMagickCommand -Command $magick -Arguments $CommentArguments
        if ($global:ImageMagickError -ne 'true') {
            if ($SeasonPoster) {
                $settings = Get-OverlayAndBorderSettings -AddBorder $AddSeasonBorder -AddOverlay $AddSeasonOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                $LocalAddBorder = $settings.Border
                $LocalAddOverlay = $settings.Overlay

                if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Seasonoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$Seasonborderwidthsecond`"  -bordercolor `"$Seasonbordercolor`" -border `"$Seasonborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" -shave `"$Seasonborderwidthsecond`"  -bordercolor `"$Seasonbordercolor`" -border `"$Seasonborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Seasonoverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                else {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                }
                $global:SeasonCount = Increment-GlobalStat 'SeasonCount'
            }
            elseif ($CollectionCard) {
                $settings = Get-OverlayAndBorderSettings -AddBorder $AddCollectionBorder -AddOverlay $AddCollectionOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                $LocalAddBorder = $settings.Border
                $LocalAddOverlay = $settings.Overlay

                if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Collectionoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$Collectionborderwidthsecond`"  -bordercolor `"$Collectionbordercolor`" -border `"$Collectionborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" -shave `"$Collectionborderwidthsecond`"  -bordercolor `"$Collectionbordercolor`" -border `"$Collectionborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$Collectionoverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                else {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                }
                $global:collectionCount = Increment-GlobalStat 'collectionCount'
            }
            elseif ($TitleCard) {
                $settings = Get-OverlayAndBorderSettings -AddBorder $AddTitleCardBorder -AddOverlay $AddTitleCardOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                $LocalAddBorder = $settings.Border
                $LocalAddOverlay = $settings.Overlay

                if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$Defaulttitlecardoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$TitleCardborderwidthsecond`"  -bordercolor `"$TitleCardbordercolor`" -border `"$TitleCardborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$Defaulttitlecardoverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                else {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                }
                $global:EpisodeCount = Increment-GlobalStat 'EpisodeCount'
            }
            elseif ($BackgroundCard) {
                $settings = Get-OverlayAndBorderSettings -AddBorder $AddBackgroundBorder -AddOverlay $AddBackgroundOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                $LocalAddBorder = $settings.Border
                $LocalAddOverlay = $settings.Overlay

                # Resize Image to 2000x3000 and apply Border and overlay
                if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$DefaultBackgroundoverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$Backgroundborderwidthsecond`"  -bordercolor `"$Backgroundbordercolor`" -border `"$Backgroundborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" -shave `"$Backgroundborderwidthsecond`"  -bordercolor `"$Backgroundbordercolor`" -border `"$Backgroundborderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$DefaultBackgroundoverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                else {
                    $Arguments = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                }
                $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
            }
            Else {
                $settings = Get-OverlayAndBorderSettings -AddBorder $AddBorder -AddOverlay $AddOverlay -SkipAddTextAndOverlay $SkipAddTextAndOverlay -SkipAddTextAndBorder $SkipAddTextAndBorder -PosterWithText $global:PosterWithText
                $LocalAddBorder = $settings.Border
                $LocalAddOverlay = $settings.Overlay

                # Resize Image to 2000x3000 and apply Border and overlay
                if ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$DefaultPosteroverlay`" -gravity south -quality $global:outputQuality -composite -shave `"$borderwidthsecond`"  -bordercolor `"$bordercolor`" -border `"$borderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'true' -and $LocalAddOverlay -eq 'false') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" -shave `"$borderwidthsecond`"  -bordercolor `"$bordercolor`" -border `"$borderwidth`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Borders" -Path $global:configLogging -Color White -log Info
                }
                elseif ($LocalAddBorder -eq 'false' -and $LocalAddOverlay -eq 'true') {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$DefaultPosteroverlay`" -gravity south -quality $global:outputQuality -composite `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it | Adding Overlay" -Path $global:configLogging -Color White -log Info
                }
                else {
                    $Arguments = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
                    Write-Entry -Subtext "Resizing it" -Path $global:configLogging -Color White -log Info
                }
                $global:posterCount = Increment-GlobalStat 'posterCount'
            }
            $logEntry = "`"$magick`" $Arguments"
            $logEntry | Write-MagickLog
            InvokeMagickCommand -Command $magick -Arguments $Arguments
            # ==============================================================================
            # LOGO DETECTION LOGIC (MANUAL MODE)
            # ==============================================================================
            $isLogo = $false
            $TempLogoPath = Join-Path -Path $global:ScriptRoot -ChildPath "temp\manual_logo.png"

            # Check if Titletext looks like a URL (http) or a local file (png/jpg/webp)
            if ($Titletext -match '^(http|https)://' -or $Titletext -match '\.(png|jpg|jpeg|webp|svg)$') {

                Write-Entry -Subtext "Input detected as Image/URL. Switching to Logo Mode." -Path $global:configLogging -Color Cyan -log Info
                $isLogo = $true

                if ($Titletext -match '^(http|https)://') {
                    try {
                        Write-Entry -Subtext "Downloading logo from URL..." -Path $global:configLogging -Color White -log Info
                        Invoke-WebRequest -Uri $Titletext -OutFile $TempLogoPath -ErrorAction Stop
                        $LogoSource = $TempLogoPath
                    }
                    catch {
                        Write-Entry -Subtext "Failed to download logo. Falling back to Text. Error: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        $isLogo = $false
                    }
                }
                elseif (Test-Path $Titletext) {
                    $LogoSource = $Titletext
                }
                else {
                    Write-Entry -Subtext "Local Logo file not found. Falling back to Text." -Path $global:configLogging -Color Red -log Error
                    $isLogo = $false
                }
            }
            $SkippingText = Get-SkipTextSetting -SkipAddText $SkipAddText -SkipAddTextAndOverlay $SkipAddTextAndOverlay -PosterWithText $global:PosterWithText
            if ($SkippingText -eq 'true') {
                Write-Entry -Subtext "Skipping 'AddText' because poster already has text." -Path $global:configLogging -Color Yellow -log Info
            }

            if ($SkippingText -eq 'false' -and ($isLogo -or $AddText -eq 'true' -or $AddSeasonText -eq 'true' -or $AddTitleCardEPTitleText -eq 'true' -or $AddTitleCardEPText -eq 'true' -or $AddCollectionText -eq 'true' -or $AddBackgroundText -eq 'true') -and -not [string]::IsNullOrWhiteSpace($joinedTitle)) {
                $joinedTitle = $joinedTitle -replace '„', '"' -replace '”', '"' -replace '“', '"' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                if ($AddShowTitletoSeason -eq 'true' -and $SeasonPoster) {
                    $ShowjoinedTitle = $ShowjoinedTitle -replace '„', '"' -replace '”', '"' -replace '“', '"' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
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
                            $ShowjoinedTitle = $ShowjoinedTitle -replace [regex]::Escape($symbol), $replacementString
                        }
                    }
                    if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                        $properties = $NewLineWords.PSObject.Properties.Name

                        # Check if properties exist and the list is not empty
                        if ($null -ne $properties -and $properties.Count -gt 0) {
                            foreach ($wordKey in $properties) {
                                $replacementValue = $NewLineWords.$wordKey

                                # Using [regex]::Escape handles any special characters in the word keys
                                $ShowjoinedTitle = $ShowjoinedTitle -replace [regex]::Escape($wordKey), $replacementValue
                            }
                        }
                    }
                    $ShowjoinedTitlePointSize = $ShowjoinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                    $showoptimalFontSize = Get-OptimalPointSize -text $ShowjoinedTitlePointSize -font $fontImagemagick -box_width $ShowOnSeasonMaxWidth  -box_height $ShowOnSeasonMaxHeight -min_pointsize $ShowOnSeasonminPointSize -max_pointsize $ShowOnSeasonmaxPointSize -lineSpacing $ShowOnSeasonlineSpacing
                    Write-Entry -Subtext ("Optimal Show font size set to: '{0}' [{1}]" -f $showoptimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info

                }
                if ($AddCollectionTitle -eq 'true' -and $CollectionCard) {
                    $CollectionjoinedTitle = $CollectionjoinedTitle -replace '„', '"' -replace '”', '"' -replace '“', '"' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
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
                            $CollectionjoinedTitle = $CollectionjoinedTitle -replace [regex]::Escape($symbol), $replacementString
                        }
                    }
                    if ($NewLineOnSpecificWords -eq 'true' -and $null -ne $NewLineWords) {
                        $properties = $NewLineWords.PSObject.Properties.Name

                        # Check if properties exist and the list is not empty
                        if ($null -ne $properties -and $properties.Count -gt 0) {
                            foreach ($wordKey in $properties) {
                                $replacementValue = $NewLineWords.$wordKey

                                # Using [regex]::Escape handles any special characters in the word keys
                                $CollectionjoinedTitle = $CollectionjoinedTitle -replace [regex]::Escape($wordKey), $replacementValue
                            }
                        }
                    }
                    $CollectionjoinedTitlePointSize = $CollectionjoinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                    $CollectionTitleoptimalFontSize = Get-OptimalPointSize -text $CollectionjoinedTitlePointSize -font $CollectionfontImagemagick -box_width $CollectionTitleMaxWidth  -box_height $CollectionTitleMaxHeight -min_pointsize $CollectionTitleminPointSize -max_pointsize $CollectionTitlemaxPointSize -lineSpacing $CollectionTitlelineSpacing
                    Write-Entry -Subtext ("Optimal Collection Title font size set to: '{0}' [{1}]" -f $CollectionTitleoptimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info

                }
                if ($AddTitleCardEPText -eq 'true' -and $TitleCard) {
                    $EPNumberjoinedTitle = $EPNumberTitle -replace '„', '"' -replace '”', '"' -replace '“', '"' -replace '"', '''' -replace '“', '''' -replace '”', '''' -replace '„', '''' -replace '`', ''
                    $EPNumberjoinedTitlePointSize = $EPNumberjoinedTitle -replace '""', '""""' -replace '“', '''' -replace '”', '''' -replace '„', ''''
                    $EPNumberoptimalFontSize = Get-OptimalPointSize -text $EPNumberjoinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPMaxWidth  -box_height $TitleCardEPMaxHeight -min_pointsize $TitleCardEPminPointSize -max_pointsize $TitleCardEPmaxPointSize -lineSpacing $TitleCardEPlineSpacing
                    Write-Entry -Subtext ("Optimal EP Number font size set to: '{0}' [{1}]" -f $EPNumberoptimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info

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

                if ($SeasonPoster -and $AddSeasonText -eq 'true') {
                    $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $fontImagemagick -box_width $SeasonMaxWidth  -box_height $SeasonMaxHeight -min_pointsize $SeasonminPointSize -max_pointsize $SeasonmaxPointSize -lineSpacing $SeasonlineSpacing
                    Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info

                    # Add Stroke for Season Text
                    if ($AddSeasonTextStroke -eq 'true') {
                        $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$Seasonboxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonstrokecolor`" -stroke `"$Seasonstrokecolor`" -strokewidth `"$Seasonstrokewidth`" -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$joinedTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonfontcolor`" -stroke none -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Seasonboxsize`" `) -gravity south -geometry +0`"$Seasontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                    }
                    Else {
                        $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Seasonfontcolor`" -size `"$Seasonboxsize`" -background none -interline-spacing `"$SeasonlineSpacing`" -gravity `"$Seasontextgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$Seasonboxsize`" `) -gravity south -geometry +0`"$Seasontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                    }

                    # Add Show Title / Logo to Season
                    if ($AddShowTitletoSeason -eq 'true') {
                        if ($isLogo) {
                            # Logo Logic
                            if ($Titletext -match "(?i)\.svg") {
                                Write-Entry -Subtext "Detected SVG. Applying High-Res settings for Show Logo on Season." -Path $global:configLogging -Color Cyan -log Info
                                $ShowOnSeasonArguments = "`"$PosterImage`" ( -background none -density 300 `"$LogoSource`" $colorEffect -resize `"$ShowOnSeasonboxsize`" `) -gravity `"$ShowOnSeasontextgravity`" -geometry +0+`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                            }
                            else {
                                $ShowOnSeasonArguments = "`"$PosterImage`" ( -background none `"$LogoSource`" $colorEffect -resize `"$ShowOnSeasonboxsize`" `) -gravity `"$ShowOnSeasontextgravity`" -geometry +0+`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                            }
                        }
                        else {
                            # Text Logic
                            if ($AddShowOnSeasonTextStroke -eq 'true') {
                                $ShowOnSeasonArguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$ShowOnSeasonboxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$showoptimalFontSize`" -fill `"$ShowOnSeasonstrokecolor`" -stroke `"$ShowOnSeasonstrokecolor`" -strokewidth `"$ShowOnSeasonstrokewidth`" -size `"$ShowOnSeasonboxsize`" -background none -interline-spacing `"$ShowOnSeasonlineSpacing`" -gravity `"$ShowOnSeasontextgravity`" caption:`"$ShowjoinedTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$showoptimalFontSize`" -fill `"$ShowOnSeasonfontcolor`" -stroke none -size `"$ShowOnSeasonboxsize`" -background none -interline-spacing `"$ShowOnSeasonlineSpacing`" -gravity `"$ShowOnSeasontextgravity`" caption:`"$ShowjoinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$ShowOnSeasonboxsize`" `) -gravity south -geometry +0`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                            }
                            Else {
                                $ShowOnSeasonArguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$fontImagemagick`" -pointsize `"$showoptimalFontSize`" -fill `"$ShowOnSeasonfontcolor`" -size `"$ShowOnSeasonboxsize`" -background none -interline-spacing `"$ShowOnSeasonlineSpacing`" -gravity `"$ShowOnSeasontextgravity`" caption:`"$ShowjoinedTitle`" -trim +repage -extent `"$ShowOnSeasonboxsize`" `) -gravity south -geometry +0`"$ShowOnSeasontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                            }
                        }
                    }

                    # Execute Season Text Command
                    Write-Entry -Subtext "    Applying Season Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                    $logEntry = "`"$magick`" $Arguments"
                    $logEntry | Write-MagickLog
                    InvokeMagickCommand -Command $magick -Arguments $Arguments

                    # Execute Show Title / Logo Command
                    if ($AddShowTitletoSeason -eq 'true') {
                        if ($isLogo) {
                            Write-Entry -Subtext "    Applying showTitle logo..." -Path $global:configLogging -Color White -log Info
                        } else {
                            Write-Entry -Subtext "    Applying showTitle text: `"$ShowjoinedTitle`"" -Path $global:configLogging -Color White -log Info
                        }
                        $logEntry = "`"$magick`" $ShowOnSeasonArguments"
                        $logEntry | Write-MagickLog
                        InvokeMagickCommand -Command $magick -Arguments $ShowOnSeasonArguments
                    }
                }
                elseif ($CollectionCard -and ($AddCollectionText -eq 'true' -or $isLogo)) {
                    if ($isLogo) {
                        $colorEffect = ""
                        if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                            $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                            $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                            if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                            else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                        }
                        if ($Titletext -match "(?i)\.svg") {
                            Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                            $Arguments = "`"$PosterImage`" ( -background none -density 300 `"$LogoSource`" $colorEffect -resize `"$Collectionboxsize`" `) -gravity `"$Collectiontextgravity`" -geometry +0+`"$Collectiontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        else {
                            $Arguments = "`"$PosterImage`" ( -background none `"$LogoSource`" $colorEffect -resize `"$Collectionboxsize`" `) -gravity `"$Collectiontextgravity`" -geometry +0+`"$Collectiontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                    } else {
                        $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $CollectionfontImagemagick -box_width $CollectionMaxWidth  -box_height $CollectionMaxHeight -min_pointsize $CollectionminPointSize -max_pointsize $CollectionmaxPointSize -lineSpacing $CollectionlineSpacing

                        # Add Stroke
                        if ($AddCollectionTextStroke -eq 'true') {
                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$Collectionboxsize`" -background none `( -font `"$CollectionfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Collectionstrokecolor`" -stroke `"$Collectionstrokecolor`" -strokewidth `"$Collectionstrokewidth`" -size `"$Collectionboxsize`" -background none -interline-spacing `"$CollectionlineSpacing`" -gravity `"$Collectiontextgravity`" caption:`"$joinedTitle`" `) `( -font `"$CollectionfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Collectionfontcolor`" -stroke none -size `"$Collectionboxsize`" -background none -interline-spacing `"$CollectionlineSpacing`" -gravity `"$Collectiontextgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Collectionboxsize`" `) -gravity south -geometry +0`"$Collectiontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Else {
                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$CollectionfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Collectionfontcolor`" -size `"$Collectionboxsize`" -background none -interline-spacing `"$CollectionlineSpacing`" -gravity `"$Collectiontextgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$Collectionboxsize`" `) -gravity south -geometry +0`"$Collectiontext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                    }
                    if ($AddCollectionTitle -eq 'true') {
                        # Show Part
                        # Add Stroke
                        if ($AddCollectionTitleTextStroke -eq 'true') {
                            $CollectionTitleArguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$CollectionTitleboxsize`" -background none `( -font `"$CollectionfontImagemagick`" -pointsize `"$CollectionTitleoptimalFontSize`" -fill `"$CollectionTitlestrokecolor`" -stroke `"$CollectionTitlestrokecolor`" -strokewidth `"$CollectionTitlestrokewidth`" -size `"$CollectionTitleboxsize`" -background none -interline-spacing `"$CollectionTitlelineSpacing`" -gravity `"$CollectionTitletextgravity`" caption:`"$CollectionjoinedTitle`" `) `( -font `"$CollectionfontImagemagick`" -pointsize `"$CollectionTitleoptimalFontSize`" -fill `"$CollectionTitlefontcolor`" -stroke none -size `"$CollectionTitleboxsize`" -background none -interline-spacing `"$CollectionTitlelineSpacing`" -gravity `"$CollectionTitletextgravity`" caption:`"$CollectionjoinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$CollectionTitleboxsize`" `) -gravity south -geometry +0`"$CollectionTitletext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Else {
                            $CollectionTitleArguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$CollectionfontImagemagick`" -pointsize `"$CollectionTitleoptimalFontSize`" -fill `"$CollectionTitlefontcolor`" -size `"$CollectionTitleboxsize`" -background none -interline-spacing `"$CollectionTitlelineSpacing`" -gravity `"$CollectionTitletextgravity`" caption:`"$CollectionjoinedTitle`" -trim +repage -extent `"$CollectionTitleboxsize`" `) -gravity south -geometry +0`"$CollectionTitletext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                    }
                    if ($isLogo) {
                        Write-Entry -Subtext "    Applying Collection Poster logo..." -Path $global:configLogging -Color White -log Info
                    } else {
                        Write-Entry -Subtext "    Applying Collection Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                    }
                    $logEntry = "`"$magick`" $Arguments"
                    $logEntry | Write-MagickLog
                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                    if ($AddCollectionTitle -eq 'true') {
                        Write-Entry -Subtext "    Applying collectionTitle text: `"$CollectionjoinedTitle`"" -Path $global:configLogging -Color White -log Info
                        $logEntry = "`"$magick`" $CollectionTitleArguments"
                        $logEntry | Write-MagickLog
                        InvokeMagickCommand -Command $magick -Arguments $CollectionTitleArguments
                    }
                }
                Elseif ($TitleCard -and ($AddTitleCardEPTitleText -eq 'true' -or $AddTitleCardEPText -eq 'true')) {
                    $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $TitleCardfontImagemagick -box_width $TitleCardEPTitleMaxWidth  -box_height $TitleCardEPTitleMaxHeight -min_pointsize $TitleCardEPTitleminPointSize -max_pointsize $TitleCardEPTitlemaxPointSize -lineSpacing $TitleCardEPTitlelineSpacing
                    # Add Stroke
                    if ($AddTitleCardEPTitleTextStroke -eq 'true') {
                        $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPTitleboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlestrokecolor`" -stroke `"$TitleCardEPTitlestrokecolor`" -strokewidth `"$TitleCardEPTitlestrokewidth`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$joinedTitle`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -stroke none -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                    }
                    Else {
                        $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$TitleCardEPTitlefontcolor`" -size `"$TitleCardEPTitleboxsize`" -background none -interline-spacing `"$TitleCardEPTitlelineSpacing`" -gravity `"$TitleCardEPTitletextgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$TitleCardEPTitleboxsize`" `) -gravity south -geometry +0`"$TitleCardEPTitletext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                    }
                    if ($AddTitleCardEPText -eq 'true') {
                        # EP Number Part
                        # Add Stroke
                        if ($AddTitleCardTextStroke -eq 'true') {
                            $EPNumberArguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$TitleCardEPboxsize`" -background none `( -font `"$TitleCardfontImagemagick`" -pointsize `"$EPNumberoptimalFontSize`" -fill `"$TitleCardstrokecolor`" -stroke `"$TitleCardstrokecolor`" -strokewidth `"$TitleCardstrokewidth`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$EPNumberjoinedTitle`" `) `( -font `"$TitleCardfontImagemagick`" -pointsize `"$EPNumberoptimalFontSize`" -fill `"$TitleCardEPfontcolor`" -stroke none -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$EPNumberjoinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Else {
                            $EPNumberArguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$TitleCardfontImagemagick`" -pointsize `"$EPNumberoptimalFontSize`" -fill `"$TitleCardEPfontcolor`" -size `"$TitleCardEPboxsize`" -background none -interline-spacing `"$TitleCardEPlineSpacing`" -gravity `"$TitleCardEPtextgravity`" caption:`"$EPNumberjoinedTitle`" -trim +repage -extent `"$TitleCardEPboxsize`" `) -gravity south -geometry +0`"$TitleCardEPtext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                    }
                    Write-Entry -Subtext "    Applying TitleCard Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                    $logEntry = "`"$magick`" $Arguments"
                    $logEntry | Write-MagickLog
                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                    if ($AddTitleCardEPText -eq 'true') {
                        Write-Entry -Subtext "    Applying Season + EP text: `"$EPNumberjoinedTitle`"" -Path $global:configLogging -Color White -log Info
                        $logEntry = "`"$magick`" $EPNumberArguments"
                        $logEntry | Write-MagickLog
                        InvokeMagickCommand -Command $magick -Arguments $EPNumberArguments
                    }
                }
                Elseif ($BackgroundCard -and $AddBackgroundText -eq 'true') {
                    if ($isLogo) {
                        $colorEffect = ""
                        if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                            $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                            $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                            if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                            else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                        }
                        if ($Titletext -match "(?i)\.svg") {
                            Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                            $Arguments = "`"$PosterImage`" ( -background none -density 300 `"$LogoSource`" $colorEffect -resize `"$Backgroundboxsize`" `) -gravity `"$Backgroundtextgravity`" -geometry +0+`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        else {
                            $Arguments = "`"$PosterImage`" ( -background none `"$LogoSource`" $colorEffect -resize `"$Backgroundboxsize`" `) -gravity `"$Backgroundtextgravity`" -geometry +0+`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }

                        Write-Entry -Subtext "    Applying logo..." -Path $global:configLogging -Color White -log Info
                    }
                    Else {
                        $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $backgroundfontImagemagick -box_width $BackgroundMaxWidth  -box_height $BackgroundMaxHeight -min_pointsize $BackgroundminPointSize -max_pointsize $BackgroundmaxPointSize -lineSpacing $BackgroundlineSpacing
                        Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                        # Add Stroke
                        if ($AddBackgroundTextStroke -eq 'true') {
                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$Backgroundboxsize`" -background none `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundstrokecolor`" -stroke `"$Backgroundstrokecolor`" -strokewidth `"$Backgroundstrokewidth`" -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" `) `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundfontcolor`" -stroke none -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$Backgroundboxsize`" `) -gravity south -geometry +0`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Else {
                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$backgroundfontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$Backgroundfontcolor`" -size `"$Backgroundboxsize`" -background none -interline-spacing `"$BackgroundlineSpacing`" -gravity `"$Backgroundtextgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$Backgroundboxsize`" `) -gravity south -geometry +0`"$Backgroundtext_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Write-Entry -Subtext "    Applying Background Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                    }
                    $logEntry = "`"$magick`" $Arguments"
                    $logEntry | Write-MagickLog
                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                }
                Elseif ($AddText -eq 'true' -or $isLogo) {
                    if ($isLogo) {
                        $colorEffect = ""
                        if ($ConvertLogoColor -eq "true" -and -not [string]::IsNullOrWhiteSpace($LogoFlatColor)) {
                            $_chkLogo = if ($LogoImage -and (Test-Path $LogoImage)) { $LogoImage } elseif ($LogoSource -and (Test-Path $LogoSource)) { $LogoSource } else { $null }

                            $_chromaStd = if ($_chkLogo) { (& $magick $_chkLogo -trim +repage -background black -alpha remove -colorspace HCL -channel Green -separate -format "%[fx:standard_deviation]" info: 2>$null) } else { "0" }

                            if ([double]$_chromaStd -lt 0.25) { $colorEffect = "-fill `"$LogoFlatColor`" -colorize 100"; Write-Entry -Subtext "Converting logo to $LogoFlatColor (chroma:$([math]::Round([double]$_chromaStd,3)))..." -Path $global:configLogging -Color Cyan -log Info }

                            else { $colorEffect = ""; Write-Entry -Subtext "Logo multi-color (chroma:$([math]::Round([double]$_chromaStd,3))), keeping original" -Path $global:configLogging -Color Yellow -log Info }
                        }
                        if ($Titletext -match "(?i)\.svg") {
                            Write-Entry -Subtext "Detected SVG. Applying High-Res settings." -Path $global:configLogging -Color Cyan -log Info
                            $Arguments = "`"$PosterImage`" ( -background none -density 300 `"$LogoSource`" $colorEffect -resize `"$boxsize`" `) -gravity `"$textgravity`" -geometry +0+`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        else {
                            $Arguments = "`"$PosterImage`" ( -background none `"$LogoSource`" $colorEffect -resize `"$boxsize`" `) -gravity `"$textgravity`" -geometry +0+`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Write-Entry -Subtext "    Applying logo..." -Path $global:configLogging -Color White -log Info
                    }
                    Else {
                        $optimalFontSize = Get-OptimalPointSize -text $joinedTitlePointSize -font $fontImagemagick -box_width $MaxWidth  -box_height $MaxHeight -min_pointsize $minPointSize -max_pointsize $maxPointSize -lineSpacing $lineSpacing
                        Write-Entry -Subtext ("Optimal font size set to: '{0}' [{1}]" -f $optimalFontSize, $(if ($null -eq $script:CurrentTextSizeSource) { 'calculated' } else { $script:CurrentTextSizeSource })) -Path $global:configLogging -Color White -log Info
                        # Add Stroke
                        if ($AddTextStroke -eq 'true') {
                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -size `"$boxsize`" -background none `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$strokecolor`" -stroke `"$strokecolor`" -strokewidth `"$strokewidth`" -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" `) `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$fontcolor`" -stroke none -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" `) -gravity `"$ShowOnSeasontextgravity`" -composite -trim +repage -extent `"$boxsize`" `) -gravity south -geometry +0`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Else {
                            $Arguments = "`"$PosterImage`" -gravity center -background None -layers Flatten `( -font `"$fontImagemagick`" -pointsize `"$optimalFontSize`" -fill `"$fontcolor`" -size `"$boxsize`" -background none -interline-spacing `"$lineSpacing`" -gravity `"$textgravity`" caption:`"$joinedTitle`" -trim +repage -extent `"$boxsize`" `) -gravity south -geometry +0`"$text_offset`" -quality $global:outputQuality -composite `"$PosterImage`""
                        }
                        Write-Entry -Subtext "    Applying Poster text: `"$joinedTitle`"" -Path $global:configLogging -Color White -log Info
                    }
                    $logEntry = "`"$magick`" $Arguments"
                    $logEntry | Write-MagickLog
                    InvokeMagickCommand -Command $magick -Arguments $Arguments
                }
            }
        }
    }
    Else {
        if ($TitleCard) {
            $Resizeargument = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$PosterImage`""
            $global:EpisodeCount = Increment-GlobalStat 'EpisodeCount'
        }
        Elseif ($BackgroundCard) {
            $Resizeargument = "`"$PosterImage`" -resize `"$BackgroundSize^`" -gravity center -extent `"$BackgroundSize`" `"$PosterImage`""
            $global:BackgroundCount = Increment-GlobalStat 'BackgroundCount'
        }
        Elseif ($SeasonPoster) {
            $Resizeargument = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
            $global:SeasonCount = Increment-GlobalStat 'SeasonCount'
        }
        Elseif ($CollectionCard) {
            $Resizeargument = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
            $global:collectionCount = Increment-GlobalStat 'collectionCount'
        }
        Else {
            $Resizeargument = "`"$PosterImage`" -resize `"$PosterSize^`" -gravity center -extent `"$PosterSize`" `"$PosterImage`""
            $global:posterCount = Increment-GlobalStat 'posterCount'
        }
        Write-Entry -Subtext "Resizing it... " -Path $global:configLogging -Color White -log Info
        $logEntry = "`"$magick`" $Resizeargument"
        $logEntry | Write-MagickLog
        InvokeMagickCommand -Command $magick -Arguments $Resizeargument
    }
    if ($global:ImageMagickError -ne 'true') {

        # Only attempt media server update if ImageMagick processing succeeded
        # This prevents potential issues where a failed image processing might still update the media server with an incomplete or corrupted image
        # The media server update logic is also wrapped in a check for $UpdateMediaServer to allow users to opt-out of automatic updates if they prefer to handle it manually or through another process
        # This design choice prioritizes data integrity and gives users control over when and how their media server metadata is updated, especially in scenarios where image processing might be complex or prone to errors
        # By ensuring that media server updates only occur after successful image processing, we can maintain a more reliable and consistent user experience, reducing the likelihood of issues caused by failed image manipulations while still providing the convenience of automatic updates when desired.
        # Additionally, the media server update logic is designed to be flexible and adaptable to different server types (Plex, Emby, Jellyfin) and various asset types (movies, shows, seasons, episodes), allowing for a wide range of use cases and configurations while still maintaining a clear and structured approach to updating media metadata based on the processed images.
        if ($Upload2Plex -eq 'true' -or $UseJellyfin -eq 'true' -or $UseEmby -eq 'true') {
            Write-Entry -Message "Manual Mode: Updating Media Server artwork..." -Path $global:configLogging -Color Cyan -log Info

            $FinalTargetID = $null
            $FinalImageType = if ($BackgroundCard) { "Backdrop" } else { "Primary" }

            Write-Entry -Subtext "Target Image Type: $FinalImageType | PosterType: $PosterType" -Path $global:configLogging -Color Cyan -log Debug

            if ($UsePlex -eq 'true') {
                $searchUrl = "$PlexUrl/search?query=$([uri]::EscapeDataString($Titletext))"

                Write-Entry -Subtext "Plex Search URI: $(RedactMediaServerUrl -url $searchUrl)" -Path $global:configLogging -Color Cyan -log Debug

                [xml]$searchXml = (Invoke-WebRequest $searchUrl -Headers $extraPlexHeaders -ErrorAction SilentlyContinue).content

                if ($MoviePosterCard -or ($BackgroundCard -and $PosterType -eq "Movie Background")) {
                    $baseItem = $searchXml.MediaContainer.video | Where-Object { $_.type -eq 'movie' -and $_.librarySectionTitle -eq $LibraryName }
                }
                else {
                    $baseItem = $searchXml.MediaContainer.directory | Where-Object { $_.type -eq 'show' -and $_.librarySectionTitle -eq $LibraryName }
                }

                if (-not $baseItem -and -not ($MoviePosterCard)) {
                    Write-Entry -Subtext "Plex match failed for Show '$Titletext'. Retrying search as 'movie' type..." -Path $global:configLogging -Color Yellow -log Info
                    $baseItem = $searchXml.MediaContainer.video | Where-Object { $_.type -eq 'movie' -and $_.librarySectionTitle -eq $LibraryName }
                }

                if ($baseItem) {
                    $FinalTargetID = $baseItem.ratingKey
                    Write-Entry -Subtext "Base Item Found: $($baseItem.title) (RatingKey: $FinalTargetID)" -Path $global:configLogging -Color Cyan -log Debug
                }
                else {
                    Write-Entry -Message "No Plex match found for '$Titletext' in library '$LibraryName'." -Path $global:configLogging -Color Red -log Error
                    $FinalTargetID = $null
                }
            }
            elseif ($UseJellyfin -eq 'true' -or $UseEmby -eq 'true') {
                $SearchType = if ($MoviePosterCard -or ($BackgroundCard -and $PosterType -eq "Movie Background")) { "Movie" } else { "Series" }
                $searchUri = "$OtherMediaServerUrl/Items?IncludeItemTypes=$SearchType&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&Recursive=true&SearchTerm=$([uri]::EscapeDataString($Titletext))"

                Write-Entry -Subtext "JF/Emby Search URI: $(RedactMediaServerUrl -url $searchUri)" -Path $global:configLogging -Color Cyan -log Debug
                $results = Invoke-RestMethod -Uri $searchUri -Headers $global:OtherMediaServerHeaders

                $baseItem = $results.Items | Where-Object { $_.Path -match [regex]::Escape($FolderName) }

                if (-not $baseItem -and $SearchType -eq "Series") {
                    Write-Entry -Subtext "Precision match failed for Series '$FolderName'. Retrying search as 'Movie' type..." -Path $global:configLogging -Color Yellow -log Info

                    $retrySearchUri = "$OtherMediaServerUrl/Items?IncludeItemTypes=Movie&Fields=Path&Recursive=true&SearchTerm=$([uri]::EscapeDataString($Titletext))"
                    $retryResults = Invoke-RestMethod -Uri $retrySearchUri -Headers $global:OtherMediaServerHeaders
                    $baseItem = $retryResults.Items | Where-Object { $_.Path -match [regex]::Escape($FolderName) }

                    if ($baseItem) {
                        Write-Entry -Subtext "Successfully recovered! Found precise Movie match: $($baseItem.Name)" -Path $global:configLogging -Color Green -log Info
                        $SearchType = "Movie"
                    }
                }
                if (-not $baseItem) {
                    Write-Entry -Message "No precise path match found for '$FolderName' as Series or Movie." -Path $global:configLogging -Color Red -log Error
                    Write-Entry -Subtext "Aborting upload to prevent applying artwork to incorrect media item." -Path $global:configLogging -Color Yellow -log Warning

                    $FinalTargetID = $null
                }
                else {
                    $FinalTargetID = $baseItem.Id
                    Write-Entry -Subtext "Base Item Found: $($baseItem.Name) (ID: $FinalTargetID)" -Path $global:configLogging -Color Cyan -log Debug
                }
            }

            if ($null -ne $FinalTargetID) {
                if ($SeasonPoster) {
                    Write-Entry -Subtext "Drilling down to Season $global:SeasonNumber" -Path $global:configLogging -Color Cyan -log Debug
                    if ($UsePlex -eq 'true') {
                        $drillUri = "$PlexUrl/library/metadata/$FinalTargetID/children"
                        [xml]$children = (Invoke-WebRequest $drillUri -Headers $extraPlexHeaders).content
                        $FinalTargetID = ($children.MediaContainer.Directory | Where-Object { [int]$_.index -eq [int]$global:SeasonNumber }).ratingKey
                    }
                    else {
                        $drillUri = "$OtherMediaServerUrl/Items?ParentId=$FinalTargetID&IncludeItemTypes=Season&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams"
                        $seasons = Invoke-RestMethod -Uri $drillUri -Headers $global:OtherMediaServerHeaders
                        $FinalTargetID = ($seasons.Items | Where-Object { [int]$_.IndexNumber -eq [int]$global:SeasonNumber }).Id
                    }
                    Write-Entry -Subtext "Resolved Season ID: $FinalTargetID" -Path $global:configLogging -Color Cyan -log Debug
                }
                elseif ($TitleCard) {
                    Write-Entry -Subtext "Drilling down to Episode S$($global:SeasonNumber)E$($global:EpisodeNumber)" -Path $global:configLogging -Color Cyan -log Debug
                    if ($UsePlex -eq 'true') {
                        [xml]$seasonsXml = (Invoke-WebRequest "$PlexUrl/library/metadata/$FinalTargetID/children" -Headers $extraPlexHeaders).content
                        $seasonKey = ($seasonsXml.MediaContainer.Directory | Where-Object { [int]$_.index -eq [int]$global:SeasonNumber }).ratingKey

                        [xml]$epsXml = (Invoke-WebRequest "$PlexUrl/library/metadata/$seasonKey/children" -Headers $extraPlexHeaders).content
                        $FinalTargetID = ($epsXml.MediaContainer.video | Where-Object { [int]$_.index -eq [int]$global:EpisodeNumber }).ratingKey
                    }
                    else {
                        $epsUri = "$OtherMediaServerUrl/Items?ParentId=$FinalTargetID&Fields=ProviderIds,SeasonUserData,OriginalTitle,Path,Overview,ProductionYear,Tags,Width,Height,MediaStreams&Recursive=true&IncludeItemTypes=Episode"
                        $eps = Invoke-RestMethod -Uri $epsUri -Headers $global:OtherMediaServerHeaders
                        $FinalTargetID = ($eps.Items | Where-Object { [int]$_.ParentIndexNumber -eq [int]$global:SeasonNumber -and [int]$_.IndexNumber -eq [int]$global:EpisodeNumber }).Id
                    }
                    Write-Entry -Subtext "Resolved Episode ID: $FinalTargetID" -Path $global:configLogging -Color Cyan -log Debug
                }

                if ($null -ne $FinalTargetID) {
                    if ($UsePlex -eq 'true') {
                        try {
                            $fileContent = [System.IO.File]::ReadAllBytes($PosterImage)
                            $plexTargetType = if ($BackgroundCard) { "arts" } else { "posters" }
                            $uri = "$PlexUrl/library/metadata/$FinalTargetID/$($plexTargetType)"

                            Write-Entry -Subtext "Attempting Plex Post to: $(RedactMediaServerUrl -url $uri)" -Path $global:configLogging -Color Cyan -log Debug
                            $Upload = Invoke-WebRequest -Uri $uri -Method Post -Headers $extraPlexHeaders -Body $fileContent -ContentType 'application/octet-stream' -ErrorAction Stop

                            Write-Entry -Subtext "Manual Plex Upload Success: $PosterImage" -Path $global:configLogging -Color Green -log Info
                            $global:UploadCount = Increment-GlobalStat 'UploadCount'
                        }
                        catch {
                            Write-Entry -Subtext "Manual Plex Upload Failed: $($_.Exception.Message)" -Path $global:configLogging -Color Red -log Error
                        }
                    }
                    else {
                        Write-Entry -Subtext "Calling UploadOtherMediaServerArtwork for ID $FinalTargetID" -Path $global:configLogging -Color Cyan -log Debug
                        UploadOtherMediaServerArtwork -itemId $FinalTargetID -imageType $FinalImageType -imagePath $PosterImage
                        $global:UploadCount = Increment-GlobalStat 'UploadCount'
                    }
                }
            }
            else {
                Write-Entry -Subtext "Could not resolve ID on server for $Titletext" -Path $global:configLogging -Color Red -log Error
            }
        }

        # Move file back to original naming with Brackets.
        Move-Item -LiteralPath $PosterImage -destination $PosterImageoriginal -Force -ErrorAction SilentlyContinue
        Write-Entry -Subtext "Poster created and moved to: $PosterImageoriginal" -Path $global:configLogging -Color Green -log Info

        $endTime = Get-Date
        $executionTime = New-TimeSpan -Start $startTime -End $endTime
        # Format the execution time
        $hours = [math]::Floor($executionTime.TotalHours)
        $minutes = $executionTime.Minutes
        $seconds = $executionTime.Seconds
        $FormattedTimespawn = $hours.ToString() + "h " + $minutes.ToString() + "m " + $seconds.ToString() + "s "

        $CSVtemp = New-Object psobject
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Title" -Value $(if ($SeasonPoster) { "$Titletext | Season $global:SeasonNumber" } Elseif ($TitleCard) { "S$($global:SeasonNumber.PadLeft(2, '0'))E$($global:EpisodeNumber.PadLeft(2, '0')) | $Titletext" } Else { $Titletext })
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Type" -Value $PosterType
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Rootfolder" -Value $FolderName
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "LibraryName" -Value $LibraryName
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Language" -Value 'false'
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Fallback" -Value 'false'
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "TextTruncated" -Value $(if ($global:IsTruncated) { 'true' } else { 'false' })
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Download Source" -Value $PicturePath
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Fav Provider Link" -Value 'false'
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "Manual" -Value "true"
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "tmdbid" -Value "false"
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "tvdbid" -Value "false"
        $CSVtemp | Add-Member -MemberType NoteProperty -Name "imdbid" -Value "false"
        # Export the array to a CSV file
        $CSVtemp | Export-Csv -Path "$global:ScriptRoot\Logs\ImageChoices.csv" -NoTypeInformation -Delimiter ';' -Encoding UTF8 -Force -Append

        if ((Test-Path $global:ScriptRoot\Logs\ImageChoices.csv)) {
            # Calculate Summary
            $SummaryCount = Import-Csv -LiteralPath "$global:ScriptRoot\Logs\ImageChoices.csv" -Delimiter ';'
            $FallbackCount = @($SummaryCount | Where-Object Fallback -eq 'true')
            $TextlessCount = @($SummaryCount | Where-Object Language -eq 'Textless')
            $TextTruncatedCount = @($SummaryCount | Where-Object TextTruncated -eq 'true')
            $TextCount = @($SummaryCount | Where-Object Textless -eq 'false')
        }

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
    }

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
