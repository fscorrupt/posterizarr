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
$inConfigSection = $false

foreach ($line in $logContent) {
    if ($line -match '=====\s+(.*?)\s+=====') {
        $inConfigSection = $true
        $currentSection = $matches[1]
        continue
    }

    if ($inConfigSection) {
        if ($line -match '\]\s+( +)(.*?):\s*(.*)$') {
            $key = $matches[2]
            $value = $matches[3]
            $flatLog["$currentSection.$key"] = $value
        }
        elseif ($line -match '\]\s+\[') {
            $inConfigSection = $false
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
    if ($logVal -match '\*\*\*\*') { continue }
    
    if ($null -eq $jsonVal) {
        Write-Host "[-] Missing in Config JSON : $key = $logVal" -ForegroundColor Yellow
        $differencesFound = $true
    }
    elseif ($jsonVal -ne $logVal) {
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
        
        if (-not $isRedacted -and $key -notmatch "Blueprints") {
            Write-Host "[+] Missing in Log file    : $key = $($flatConfig[$key])" -ForegroundColor Yellow
            $differencesFound = $true
        }
    }
}

if (-not $differencesFound) {
    Write-Host "No significant differences found!" -ForegroundColor Green
}
Write-Host ""
