function Get-AssetHashtable {
    param (
        [string]$TargetPath = $AssetPath
    )
    Write-Entry -Message "Creating Hashtable of all posters in target dir..." -Path $global:configLogging -Color White -log Info
    
    $directoryHashtable = @{}
    $global:totalSize = 0
    
    # OS agnostic path handling for exclude
    $excludePath = Join-Path -Path $TargetPath -ChildPath 'Collections'
    $allowedExtensions = @(".jpg", ".jpeg", ".png", ".bmp")

    try {
        if ($FollowSymlink -eq 'true' -or $FollowSymlink -eq $true) {
            Get-ChildItem -Path $TargetPath -Recurse -FollowSymlink | Where-Object {
                $_.FullName -ne $excludePath -and $_.FullName -notlike "$excludePath/*" -and $_.FullName -notlike "$excludePath\*"
            } | ForEach-Object {
                if ($allowedExtensions -contains $_.Extension.ToLower()) {
                    $directory = $_.Directory
                    $basename = $_.BaseName
                    if ($Platform -eq "Docker" -or $Platform -eq "Linux" -or $Platform -eq 'macOS') {
                        $directoryHashtable["$directory/$basename"] = $true
                    } Else {
                        $directoryHashtable["$directory\$basename"] = $true
                    }
                    $global:totalSize += $_.Length
                }
            }
        } else {
            # Optimized .NET Enumeration
            $dirInfo = [System.IO.DirectoryInfo]::new($TargetPath)
            foreach ($fileInfo in $dirInfo.EnumerateFiles('*', [System.IO.SearchOption]::AllDirectories)) {
                # Ensure we properly exclude the Collections directory
                if ($fileInfo.FullName -eq $excludePath -or $fileInfo.FullName -like "$excludePath/*" -or $fileInfo.FullName -like "$excludePath\*") {
                    continue
                }
                
                if ($allowedExtensions -contains $fileInfo.Extension.ToLower()) {
                    $directory = $fileInfo.DirectoryName
                    $basename = $fileInfo.BaseName
                    if ($Platform -eq "Docker" -or $Platform -eq "Linux" -or $Platform -eq 'macOS') {
                        $directoryHashtable["$directory/$basename"] = $true
                    } Else {
                        $directoryHashtable["$directory\$basename"] = $true
                    }
                    $global:totalSize += $fileInfo.Length
                }
            }
        }

        # Convert bytes to kilobytes, megabytes, or gigabytes as needed
        if ($global:totalSize -gt 1GB) {
            $totalSizeString = "{0:N2} GB" -f ($global:totalSize / 1GB)
        }
        elseif ($global:totalSize -gt 1MB) {
            $totalSizeString = "{0:N2} MB" -f ($global:totalSize / 1MB)
        }
        elseif ($global:totalSize -gt 1KB) {
            $totalSizeString = "{0:N2} KB" -f ($global:totalSize / 1KB)
        }
        else {
            $totalSizeString = "$($global:totalSize) bytes"
        }

        Write-Entry -Subtext "Hashtable created..." -Path $global:configLogging -Color Green -log Info
        Write-Entry -Subtext "Found: '$($directoryHashtable.count)' images in asset directory." -Path $global:configLogging -Color Cyan -log Info
        Write-Entry -Subtext "Total size of asset directory: $totalSizeString" -Path $global:configLogging -Color Cyan -log Info

        if ($global:logLevel -eq '3') {
            Write-Entry -Message "Output hashtable..." -Path $global:configLogging -Color White -log Info
            $directoryHashtable.keys | Out-File "$global:ScriptRoot\Logs\hashtable.log" -Force
        }

        return $directoryHashtable
    } catch {
        Write-Entry -Subtext "Error during Hashtable creation, please check Asset dir is available... $_" -Path $global:configLogging -Color Red -log Error
        HandleScriptExit -Message "Hashtable creation failed"
    }
}
