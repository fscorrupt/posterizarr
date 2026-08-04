param (
    [Parameter(Mandatory=$true)]
    [string]$LogFile,
    
    [Parameter(Mandatory=$true)]
    [string]$ConfigFile
)

if (-not (Test-Path $LogFile)) {
    Write-Host "Log file not found: $LogFile" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ConfigFile)) {
    Write-Host "Config file not found: $ConfigFile" -ForegroundColor Red
    exit 1
}

# 1. Parse Config JSON
$config = Get-Content -Path $ConfigFile -Raw | ConvertFrom-Json

# Flatten JSON object to simple key/value pairs
function Flatten-Object {
    param(
        [Parameter(Mandatory=$true)]
        $Obj,
        [string]$Prefix = ""
    )
    
    $result = @{}
    
    if ($Obj -is [System.Management.Automation.PSCustomObject] -or $Obj -is [Hashtable]) {
        foreach ($prop in $Obj.PSObject.Properties) {
            $key = if ($Prefix) { "$Prefix.$($prop.Name)" } else { $prop.Name }
            if ($prop.Value -is [System.Management.Automation.PSCustomObject] -or $prop.Value -is [Hashtable]) {
                $sub = Flatten-Object -Obj $prop.Value -Prefix $key
                foreach ($subKey in $sub.Keys) {
                    $result[$subKey] = $sub[$subKey]
                }
            }
            elseif ($prop.Value -is [System.Collections.IEnumerable] -and -not ($prop.Value -is [string])) {
                $joined = ($prop.Value | ForEach-Object { $_ }) -join ", "
                $result[$key] = $joined
            }
            else {
                $result[$key] = [string]$prop.Value
            }
        }
    }
    return $result
}

$flatConfig = Flatten-Object -Obj $config

# 2. Parse Log File
$logContent = Get-Content -Path $LogFile

$flatLog = @{}
$currentSection = ""
$inConfigDrop = $false
$nestedPath = @{}
$previousFullPath = ""

foreach ($line in $logContent) {
    if ($line -match 'Current Config settings:') {
        $inConfigDrop = $true
        continue
    }

    if ($inConfigDrop) {
        if ($line -match '=====\s+(.*?)\s+=====') {
            $currentSection = $matches[1]
            $nestedPath.Clear()
            $previousFullPath = ""
            continue
        }

        # Match lines like: [INFO] [T17] |System.ps1:L.524 |        PlexUrl: http
        if ($line -match '\|\s+([ \t]+)(.*?):\s*(.*)$') {
            $spaces = $matches[1].Length
            $key = $matches[2].Trim()
            $value = $matches[3].Trim()
            
            $keysToRemove = @()
            foreach ($k in $nestedPath.Keys) {
                if ($k -ge $spaces) { $keysToRemove += $k }
            }
            foreach ($k in $keysToRemove) { $nestedPath.Remove($k) }
            
            if ($value -eq "") {
                $nestedPath[$spaces] = $key
                $previousFullPath = ""
            } else {
                $fullPath = $currentSection
                $activeIndents = $nestedPath.Keys | Sort-Object
                foreach ($ind in $activeIndents) {
                    $fullPath += "." + $nestedPath[$ind]
                }
                $fullPath += "." + $key
                $flatLog[$fullPath] = $value
                $previousFullPath = $fullPath
            }
        }
        elseif ($line -match '^\[.*?\]') {
            # Start of a new log line (timestamp). If it's not a section header and not a key/value...
            # We assume config drop is over unless it's just an empty line from System.ps1.
            if ($line -notmatch 'System\.ps1') {
                $inConfigDrop = $false
            }
        }
        elseif ($previousFullPath -ne "") {
            # Continuation line for the previous value (e.g. multiline string)
            $flatLog[$previousFullPath] += "`n" + $line.Trim()
        }
    }
}

# 3. Compare them
Write-Host "`n=== Comparison Results ===" -ForegroundColor Cyan
Write-Host "Log File: $LogFile"
Write-Host "Config File: $ConfigFile`n"

$differencesFound = $false

foreach ($key in $flatLog.Keys) {
    $jsonVal = $flatConfig[$key]
    $logVal = $flatLog[$key]
    
    if ($logVal -match '<.*>') { continue }
    if ($logVal -match '\[MASKED\]' -or $logVal -match '\*\*\*\*') { continue }
    
    if ($null -eq $jsonVal) {
        Write-Host "[-] Missing in Config JSON : $key = $logVal" -ForegroundColor Yellow
        $differencesFound = $true
    }
    elseif ([string]$jsonVal -ne [string]$logVal) {
        Write-Host "[~] Value mismatch for $key :" -ForegroundColor Red
        Write-Host "    Log    : $logVal" -ForegroundColor DarkGray
        Write-Host "    Config : $jsonVal" -ForegroundColor DarkGray
        $differencesFound = $true
    }
}

foreach ($key in $flatConfig.Keys) {
    if (-not $flatLog.ContainsKey($key)) {
        $redactKeys = @("tvdbapi", "tmdbtoken", "fanarttvapikey", "plextoken", "jellyfinapikey", "embyapikey", "embyurl", "jellyfinurl", "discord", "plexurl", "UptimeKumaUrl", "AppriseUrl", "basicAuthPassword", "basicAuthUsername")
        $isRedacted = $false
        foreach ($rKey in $redactKeys) {
            if ($key.ToLower().Contains($rKey.ToLower())) { $isRedacted = $true; break }
        }
        
        if (-not $isRedacted -and $key -notmatch "Blueprints" -and $key -notmatch "ActiveBlueprintName") {
            Write-Host "[+] Missing in Log file    : $key = $($flatConfig[$key])" -ForegroundColor Yellow
            $differencesFound = $true
        }
    }
}

if (-not $differencesFound) {
    Write-Host "No significant differences found!" -ForegroundColor Green
}
Write-Host ""
