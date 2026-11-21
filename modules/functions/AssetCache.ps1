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
            Get-ChildItem -LiteralPath $TargetPath -Recurse -FollowSymlink -File | Where-Object {
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
            $rootDir = [System.IO.DirectoryInfo]::new($TargetPath)

            $pending = [System.Collections.Generic.Stack[
                System.IO.DirectoryInfo
            ]]::new()

            $pending.Push($rootDir)

            while ($pending.Count -gt 0) {
                $currentDir = $pending.Pop()

                foreach ($fileInfo in $currentDir.EnumerateFiles()) {

                    if ($allowedExtensions -notcontains $fileInfo.Extension.ToLowerInvariant()) {
                        continue
                    }

                    $key = Join-Path `
                        -Path $currentDir.FullName `
                        -ChildPath $fileInfo.BaseName

                    $directoryHashtable[$key] = $true
                    $global:totalSize += $fileInfo.Length
                }

                foreach ($childDir in $currentDir.EnumerateDirectories()) {

                    # Exclude the Collections subtree entirely.
                    if (
                        $currentDir.FullName -eq $rootDir.FullName -and
                        $childDir.Name -eq 'Collections'
                    ) {
                        continue
                    }

                    # Do not traverse directory symlinks in this branch.
                    if (
                        ($childDir.Attributes -band
                            [System.IO.FileAttributes]::ReparsePoint) -ne 0
                    ) {
                        continue
                    }

                    $pending.Push($childDir)
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
            try { $directoryHashtable.keys | Out-File "$global:ScriptRoot\Logs\hashtable.log" -Force -ErrorAction Stop } catch {}
        }

        return $directoryHashtable
    } catch {
        Write-Entry -Subtext "Error during Hashtable creation, please check Asset dir is available... $_" -Path $global:configLogging -Color Red -log Error
        HandleScriptExit -Message "Hashtable creation failed"
    }
}

