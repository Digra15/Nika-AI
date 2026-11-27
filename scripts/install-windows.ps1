$ErrorActionPreference = "Stop"

Write-Host "=== NIKA Windows Installer ===" -ForegroundColor Cyan

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Please install Node.js 20+ first."
}

# 2. Check Python 3.11/3.12
$pyExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $pyExe)) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $pyExe = $cmd.Source }
}
if (-not (Test-Path $pyExe)) {
    Write-Host "Installing Python 3.12 via winget..." -ForegroundColor Yellow
    winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements --silent
    $pyExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
}

# 3. Install Node dependencies
Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
npm install

# 4. Create Python venv and install local speech engines
$venvDir = Join-Path $PSScriptRoot "..\voice-engine\.venv"
if (-not (Test-Path $venvDir)) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
    & $pyExe -m venv $venvDir
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
$venvPip = Join-Path $venvDir "Scripts\pip.exe"
& $venvPython -m pip install --upgrade pip
& $venvPip install -r (Join-Path $PSScriptRoot "..\voice-engine\requirements.txt")

# 5. Create .env if missing
$envFile = Join-Path $PSScriptRoot "..\.env"
$envExample = Join-Path $PSScriptRoot "..\.env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Copy-Item $envExample $envFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
}

Write-Host "Installation complete! Run .\scripts\start-dev.ps1 to launch NIKA." -ForegroundColor Green
