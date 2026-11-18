#region Backup Mode
if ($UseSilo -eq 'true') {
    Invoke-SiloArtworkBackup
}
elseif ($UsePlex -eq 'true') {
    MassDownloadPlexArtwork
}
Else {
    MassDownloadJellyEmbyArtwork
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
