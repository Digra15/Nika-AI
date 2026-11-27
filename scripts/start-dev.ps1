$ErrorActionPreference = "Stop"

# Ensure 9Router is running on port 20128
$routerUp = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:20128/v1/models" -TimeoutSec 2
    $routerUp = $true
} catch {
    $routerUp = $false
}

if (-not $routerUp) {
    $routerCmd = Get-Command 9router.cmd -ErrorAction SilentlyContinue
    if (-not $routerCmd) {
        $routerCmd = Get-Command 9router -ErrorAction SilentlyContinue
    }
    if ($routerCmd) {
        Write-Host "Starting 9Router on port 20128..." -ForegroundColor Cyan
        Start-Process -FilePath $routerCmd.Source -ArgumentList "-n", "--skip-update", "-p", "20128" -WindowStyle Hidden
        for ($i = 0; $i -lt 10; $i++) {
            Start-Sleep -Seconds 1
            try {
                $null = Invoke-RestMethod -Uri "http://127.0.0.1:20128/v1/models" -TimeoutSec 2
                $routerUp = $true
                break
            } catch {
                # Wait for 9Router to finish booting
            }
        }
        if (-not $routerUp) {
            Write-Warning "9Router is still starting or did not respond on http://127.0.0.1:20128/v1/models"
        }
    } else {
        Write-Warning "9router CLI not found in PATH. Make sure 9Router is running at http://127.0.0.1:20128/v1"
    }
}

Write-Host "Starting NIKA Desktop Application..." -ForegroundColor Cyan
npm run dev
