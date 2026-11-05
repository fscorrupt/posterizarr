#region Posterreset Mode
    if ($UseSilo -eq 'true' -and $LibraryToReset) {
        foreach ($item in $global:SiloItems.Values) {
            if ($item.SiloLibraryName -eq $LibraryToReset -and $item.SiloLibraryName -notin $LibstoExclude -and $item.Type -in @('Movie', 'Series')) {
                Reset-SiloArtwork -ItemId $item.Id -Type poster
            }
        }
    }
    elseif ($UsePlex -eq 'true' -and $null -ne $LibraryToReset) {
        Write-Entry -Message "Poster reset requested for library: $LibraryToReset" -Path "$global:configLogging" -Color Yellow -log Warning
        Write-Entry -Subtext "This action will reset all posters and cannot be undone." -Path "$global:configLogging" -Color Red -log Warning
        Write-Entry -Subtext "Starting in 20 seconds... Press Ctrl+C to cancel." -Path "$global:configLogging" -Color Cyan -log Info

        Start-Sleep -Seconds 20

        Write-Entry -Subtext "Resetting posters for library: $LibraryToReset" -Path "$global:configLogging" -Color Green -log Info
        Reset-PlexLibraryPictures -LibraryName $LibraryToReset
    }
    Else {
        Write-Entry -Message "This only works for plex servers..." -Path "$global:configLogging" -Color Red -log Error
    }
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
