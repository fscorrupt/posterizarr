# 🚀 Posterizarr Web UI - Quick Setup
# This script sets up the Python virtual environment for the backend
# and installs dependencies for both the frontend and backend.

Clear-Host
Write-Host ""
Write-Host "🚀 Posterizarr Web UI - Quick Setup"
Write-Host "===================================="
Write-Host ""

function Refresh-SystemPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Test-CommandAvailable {
    param(
        [Parameter(Mandatory)]
        [string]$CommandName
    )

    return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Ensure-WingetTool {
    param(
        [Parameter(Mandatory)]
        [string]$ToolName,

        [Parameter(Mandatory)]
        [string]$WingetId,

        [Parameter(Mandatory)]
        [string]$FoundMessage,

        [Parameter(Mandatory)]
        [string]$InstallPrompt,

        [Parameter(Mandatory)]
        [string]$InstallSuccessMessage,

        [Parameter(Mandatory)]
        [string]$InstallFailureMessage
    )

    if (Test-CommandAvailable -CommandName $ToolName) {
        Write-Host $FoundMessage
        return $true
    }

    Write-Host "$ToolName is not installed." -ForegroundColor Red
    $install = Read-Host $InstallPrompt
    if ($install -ne 'Y' -and $install -ne 'y') {
        Write-Host "❌ Setup cannot proceed without $ToolName."
        exit 1
    }

    if (-not $isAdmin) {
        Write-Host "❌ Error: Administrator privileges are required." -ForegroundColor Red
        Read-Host "Press Enter to exit..."
        exit 1
    }

    Write-Host "📦 Installing $ToolName via Winget..."
    winget install -e --id $WingetId --accept-package-agreements --accept-source-agreements
    Write-Host "🔄 Refreshing Environment Variables..."
    Refresh-SystemPath

    if (Test-CommandAvailable -CommandName $ToolName) {
        Write-Host $InstallSuccessMessage -ForegroundColor Green
        return $true
    }

    Write-Host $InstallFailureMessage -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

function Get-BackendLaunchConfig {
    param(
        [Parameter(Mandatory)]
        [string]$BackendPath
    )

    $finalHost = "127.0.0.1"
    $finalPort = "8000"
    $envPath = Join-Path $BackendPath ".env"

    if (Test-Path $envPath) {
        Write-Host "📝 Found .env file, parsing configuration..." -ForegroundColor Gray
        foreach ($line in Get-Content $envPath) {
            if ($line -match "^APP_HOST=(.*)") {
                $finalHost = $matches[1].Trim()
            }
            elseif ($line -match "^PORT=(.*)") {
                $finalPort = $matches[1].Trim()
            }
        }
    }
    else {
        Write-Host "💡 No .env found, using default settings." -ForegroundColor Gray
    }

    [PSCustomObject]@{
        Host = $finalHost
        Port = $finalPort
    }
}

function Invoke-SetupCommand {
    param(
        [Parameter(Mandatory)]
        [string]$StartMessage,

        [Parameter(Mandatory)]
        [scriptblock]$Action,

        [Parameter(Mandatory)]
        [string]$SuccessMessage,

        [Parameter(Mandatory)]
        [string]$FailureMessage,

        [switch]$TreatNonZeroExitCodeAsFailure = $true
    )

    Write-Host $StartMessage
    try {
        $LASTEXITCODE = 0
        & $Action
        if ($TreatNonZeroExitCodeAsFailure -and $LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE."
        }

        Write-Host $SuccessMessage -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host $FailureMessage -ForegroundColor Red
        return $false
    }
}

# Administrator Check
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  WARNING: You are NOT running as Administrator." -ForegroundColor Yellow
    Write-Host "   If you need to install missing dependencies (Python/Node), this script will fail."
    Write-Host "   It is highly recommended to close this and run PowerShell as Administrator."
    Write-Host ""
    Start-Sleep -Seconds 2
} else {
    Write-Host "✅ Running as Administrator"
}

# Prerequisite Checks

# Check if we're in the right directory
if (-not (Test-Path "..\Posterizarr.ps1")) {
    Write-Host "❌ Error: Posterizarr.ps1 not found in parent directory." -ForegroundColor Red
    Write-Host "Please run this script from within the 'webui' directory."
    Read-Host "Press Enter to exit..."
    exit 1
}
Write-Host "✅ Found Posterizarr.ps1"

# Python Check (Python vs Py Launcher vs Winget)
$UsePyLauncher = $false
if (Test-CommandAvailable -CommandName python) {
    Write-Host "✅ Python 3 found (python.exe)"
}
elseif (Test-CommandAvailable -CommandName py) {
    $UsePyLauncher = $true
    Write-Host "✅ Python 3 found (py.exe launcher)"
}
else {
    Ensure-WingetTool `
        -ToolName "python" `
        -WingetId "Python.Python.3" `
        -FoundMessage "✅ Python 3 found (python.exe)" `
        -InstallPrompt "   > Would you like to install Python 3 via Winget now? (Y/N)" `
        -InstallSuccessMessage "✅ Python 3 installed and detected." `
        -InstallFailureMessage "⚠️  Python installed, but session cannot see it. Please restart script."
}

# Node.js Check
Ensure-WingetTool `
    -ToolName "node" `
    -WingetId "OpenJS.NodeJS" `
    -FoundMessage "✅ Node.js found" `
    -InstallPrompt "   > Would you like to install Node.js via Winget now? (Y/N)" `
    -InstallSuccessMessage "✅ Node.js installed and detected." `
    -InstallFailureMessage "⚠️  Node.js installed, but session cannot see it. Please restart script."
Write-Host ""

# Backend Setup
Write-Host "📦 Setting up Python backend..."
Push-Location -Path "backend"

if (-not (Test-Path "venv")) {
    Write-Host "   - Creating virtual environment..."
    try {
        if ($UsePyLauncher) { py -3 -m venv venv } else { python -m venv venv }
    }
    catch {
        Write-Host "❌ Failed to create virtual environment." -ForegroundColor Red
        Pop-Location; exit 1
    }
} else {
    Write-Host "   - Virtual environment already exists."
}

if (-not (Invoke-SetupCommand `
    -StartMessage "   - Installing Python dependencies..." `
    -Action { .\venv\Scripts\pip.exe install -r requirements.txt | Out-Null } `
    -SuccessMessage "✅ Backend dependencies installed." `
    -FailureMessage "❌ Failed to install backend dependencies.")) {
    Pop-Location; exit 1
}
Pop-Location
Write-Host ""

# Frontend Setup
Push-Location -Path "frontend"
Invoke-SetupCommand `
    -StartMessage "   - Installing Frontend Dependencies..." `
    -Action { npm install } `
    -SuccessMessage "✅ Frontend dependencies installed." `
    -FailureMessage "❌ Failed to install frontend dependencies." | Out-Null
Pop-Location
Write-Host ""

# Automation & Launch
Write-Host "🎉 Setup Complete!" -ForegroundColor Green
Write-Host ""

$autoRun = Read-Host "🚀 Do you want to build the frontend and start the app now? (Y/N)"

if ($autoRun -eq 'Y' -or $autoRun -eq 'y') {

    # Step A: Build Frontend
    Push-Location -Path "frontend"
    if (-not (Invoke-SetupCommand `
        -StartMessage "   - Running frontend build..." `
        -Action { npm run build } `
        -SuccessMessage "✅ Frontend Build Success." `
        -FailureMessage "❌ Frontend build failed. Cannot start application.")) {
        Pop-Location
        Read-Host "Press Enter to exit..."
        exit 1
    }
    Pop-Location

    # Step B: Start Backend in New Window
    Write-Host "🔌 Starting Backend Server in a new window..." -ForegroundColor Cyan
    $backendPath = Join-Path $PSScriptRoot "backend"
    $backendConfig = Get-BackendLaunchConfig -BackendPath $backendPath
    Write-Host "🔌 Starting Backend Server on $($backendConfig.Host):$($backendConfig.Port)..." -ForegroundColor Cyan
    $pyCmd = if ($UsePyLauncher) { "py" } else { "python" }
    $commands = "Set-Location '$backendPath'; .\venv\Scripts\Activate.ps1; $pyCmd -m uvicorn main:app --host $($backendConfig.Host) --port $($backendConfig.Port)"

    # Launch new PowerShell process
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", "& {$commands}"
    # Step C: Open Browser
    Write-Host "🌐 Opening Browser..." -ForegroundColor Cyan
    Start-Sleep -Seconds 3 # Give uvicorn a moment to spin up
    Start-Process "http://localhost:8000"

} else {
    # Fallback to manual instructions if they said No
    Write-Host "🎯 Manual Next Steps:" -ForegroundColor Yellow
    Write-Host "1. cd webui\frontend -> npm run build"
    Write-Host "2. cd webui\backend -> .\venv\Scripts\Activate.ps1 -> python -m uvicorn main:app --host 127.0.0.1 --port 8000"
}

Read-Host "Press Enter to close this setup window..."
