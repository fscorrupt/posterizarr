function Get-AssetHashtable {
    param (
        [string]$TargetPath = $AssetPath
    )
    Write-Entry -Message "Loading Asset Database (JSON)..." -Path $global:configLogging -Color White -log Info
    
    $directoryHashtable = [System.Collections.Concurrent.ConcurrentDictionary[string, string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $global:totalSize = 0 # Not tracking size via DB yet
    
    if ($TargetPath -ne $AssetPath) {
        Write-Entry -Subtext "Target path is not default AssetPath. Falling back to File Enumeration..." -Path $global:configLogging -Color Yellow -log Info
        $excludePath = Join-Path -Path $TargetPath -ChildPath 'Collections'
        $allowedExtensions = @(".jpg", ".jpeg", ".png", ".bmp")
        $dirInfo = [System.IO.DirectoryInfo]::new($TargetPath)
        if ($dirInfo.Exists) {
            foreach ($fileInfo in $dirInfo.EnumerateFiles('*', [System.IO.SearchOption]::AllDirectories)) {
                if ($fileInfo.FullName.StartsWith($excludePath, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                if ($allowedExtensions -contains $fileInfo.Extension.ToLower()) {
                    $directory = $fileInfo.DirectoryName
                    $basename = $fileInfo.BaseName
                    if ($Platform -eq "Docker" -or $Platform -eq "Linux" -or $Platform -eq 'macOS') {
                        $directoryHashtable.TryAdd("$directory/$basename", $fileInfo.FullName) | Out-Null
                    } Else {
                        $directoryHashtable.TryAdd("$directory\$basename", $fileInfo.FullName) | Out-Null
                    }
                    $global:totalSize += $fileInfo.Length
                }
            }
        }
        return $directoryHashtable
    }

    $dbPath = Join-Path -Path $global:ScriptRoot -ChildPath 'data\processed_assets.json'
    
    if (Test-Path $dbPath) {
        # Normal path: load existing JSON (may contain ratingKey-based and/or path-based migration entries)
        try {
            $jsonContent = Get-Content -Path $dbPath -Raw
            if (-not [string]::IsNullOrWhiteSpace($jsonContent)) {
                $obj = $jsonContent | ConvertFrom-Json
                if ($obj) {
                    foreach ($prop in $obj.psobject.properties) {
                        $directoryHashtable.TryAdd($prop.Name, $prop.Value) | Out-Null
                    }
                }
            }
        } catch {
            Write-Entry -Subtext "Error loading JSON DB, starting fresh: $_" -Path $global:configLogging -Color Yellow -log Warning
        }
        Write-Entry -Subtext "Hashtable loaded from JSON..." -Path $global:configLogging -Color Green -log Info
        Write-Entry -Subtext "Found: '$($directoryHashtable.count)' processed assets in DB." -Path $global:configLogging -Color Cyan -log Info
    } else {
        # No JSON DB: run one-time file enumeration migration.
        # Stores path-based keys (path\basename -> path\basename.jpg).
        # On the next run these get promoted to ratingKey-based entries by Test-AssetProcessed.
        # Excluded library files remain as path-based entries and get cleaned up by the cleanup pass.
        Write-Entry -Subtext "JSON DB not found. Running initial file enumeration to build migration cache..." -Path $global:configLogging -Color Yellow -log Info
        $excludePath = Join-Path -Path $AssetPath -ChildPath 'Collections'
        $allowedExtensions = @(".jpg", ".jpeg", ".png", ".bmp")
        $dirInfo = [System.IO.DirectoryInfo]::new($AssetPath)
        if ($dirInfo.Exists) {
            foreach ($fileInfo in $dirInfo.EnumerateFiles('*', [System.IO.SearchOption]::AllDirectories)) {
                if ($fileInfo.FullName.StartsWith($excludePath, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                if ($allowedExtensions -contains $fileInfo.Extension.ToLower()) {
                    $directory = $fileInfo.DirectoryName
                    $basename = $fileInfo.BaseName
                    if ($Platform -eq "Docker" -or $Platform -eq "Linux" -or $Platform -eq 'macOS') {
                        $directoryHashtable.TryAdd("$directory/$basename", $fileInfo.FullName) | Out-Null
                    } Else {
                        $directoryHashtable.TryAdd("$directory\$basename", $fileInfo.FullName) | Out-Null
                    }
                }
            }
        }
        Write-Entry -Subtext "Migration: Found '$($directoryHashtable.count)' existing assets on disk." -Path $global:configLogging -Color Green -log Info
        # Save immediately so future runs load from JSON rather than re-enumerating
        Save-AssetHashtable -directoryHashtable $directoryHashtable
        Write-Entry -Subtext "Hashtable loaded from JSON..." -Path $global:configLogging -Color Green -log Info
        Write-Entry -Subtext "Found: '$($directoryHashtable.count)' processed assets in DB." -Path $global:configLogging -Color Cyan -log Info
    }
    
    return $directoryHashtable
}

function Save-AssetHashtable {
    param (
        [Parameter(Mandatory=$true)]
        $directoryHashtable
    )
    
    Write-Entry -Message "Saving Asset Database (JSON)..." -Path $global:configLogging -Color White -log Info
    
    $dbPath = Join-Path -Path $global:ScriptRoot -ChildPath 'data\processed_assets.json'
    $dbDir = Split-Path -Path $dbPath -Parent
    
    if (-not (Test-Path -LiteralPath $dbDir)) {
        New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
    }
    
    try {
        $jsonContent = $directoryHashtable | ConvertTo-Json -Depth 1 -Compress
        Set-Content -Path $dbPath -Value $jsonContent -Encoding UTF8 -ErrorAction Stop
        Write-Entry -Subtext "Asset Database saved successfully." -Path $global:configLogging -Color Green -log Info
    } catch {
        Write-Entry -Subtext "Error saving JSON DB: $_" -Path $global:configLogging -Color Red -log Error
    }
}

function Test-AssetProcessed {
    param (
        [Parameter(Mandatory=$true)][string]$AssetId,
        [Parameter(Mandatory=$true)][string]$ExpectedPath,
        [Parameter(Mandatory=$true)]$DbHashtable
    )
    
    # 1. Fast path: ratingKey-based lookup (normal operation after first full run)
    if ($DbHashtable.ContainsKey($AssetId)) {
        $dbPath = $DbHashtable[$AssetId]
        # Match exact path or path+extension (DB stores .jpg, $ExpectedPath has no extension)
        if ($dbPath -eq $ExpectedPath -or $dbPath.StartsWith($ExpectedPath + '.', [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        } else {
            # Path changed (media moved) - verify file exists at new location
            foreach ($ext in @('.jpg', '.jpeg', '.png', '.bmp')) {
                $newFullPath = "$ExpectedPath$ext"
                if (Test-Path -LiteralPath $newFullPath) {
                    Write-Entry -Subtext "Asset path changed for ID: $AssetId - updating DB." -Path $global:configLogging -Color Green -log Info
                    if ($DbHashtable -is [System.Collections.Concurrent.ConcurrentDictionary[string, string]]) {
                        $DbHashtable.TryUpdate($AssetId, $newFullPath, $dbPath) | Out-Null
                    } else {
                        $DbHashtable[$AssetId] = $newFullPath
                    }
                    return $true
                }
            }
            Write-Entry -Subtext "Asset file is missing at new path. Re-processing required." -Path $global:configLogging -Color Yellow -log Info
            return $false
        }
    }
    
    # 2. Migration path: look up by the path-based key (set during file enumeration migration).
    #    If found, promote the entry to a ratingKey-based entry and remove the old path-based key.
    #    This ensures excluded library entries remain path-based and get cleaned up by the cleanup pass.
    if ($DbHashtable.ContainsKey($ExpectedPath)) {
        $existingPath = $DbHashtable[$ExpectedPath]
        if ($DbHashtable -is [System.Collections.Concurrent.ConcurrentDictionary[string, string]]) {
            $DbHashtable.TryAdd($AssetId, $existingPath) | Out-Null
            $dummy = [string]::Empty
            [void]$DbHashtable.TryRemove($ExpectedPath, [ref]$dummy)
        } else {
            $DbHashtable[$AssetId] = $existingPath
            $DbHashtable.Remove($ExpectedPath)
        }
        return $true
    }
    
    return $false
}

function Set-AssetProcessed {
    param (
        [Parameter(Mandatory=$true)][string]$AssetId,
        [Parameter(Mandatory=$true)][string]$ExpectedPath,
        [Parameter(Mandatory=$true)]$DbHashtable
    )
    
    if ($DbHashtable -is [System.Collections.Concurrent.ConcurrentDictionary[string, string]]) {
        $DbHashtable.TryAdd($AssetId, $ExpectedPath) | Out-Null
    } else {
        $DbHashtable[$AssetId] = $ExpectedPath
    }
}

function Remove-AssetProcessed {
    param (
        [Parameter(Mandatory=$true)][string]$AssetId,
        [Parameter(Mandatory=$true)]$DbHashtable
    )
    
    if ($DbHashtable -is [System.Collections.Concurrent.ConcurrentDictionary[string, string]]) {
        $dummy = [string]::Empty
        [void]$DbHashtable.TryRemove($AssetId, [ref]$dummy)
    } else {
        $DbHashtable.Remove($AssetId)
    }
}
