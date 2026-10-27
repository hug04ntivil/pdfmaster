param([string]$Script = "scripts/e2e/smoke.js", [int]$Timeout = 500)
# Compila y ejecuta una prueba E2E de PDF Master en Electron (solo desarrollo)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$env:PM_DEBUG = "1"
npm run build:renderer 2>&1 | Select-Object -Last 1
$env:PM_E2E = $Script
$out = Join-Path $env:TEMP "pm-out.txt"; $err = Join-Path $env:TEMP "pm-err.txt"
$p = Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList "." -PassThru -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow
$p | Wait-Process -Timeout $Timeout -ErrorAction SilentlyContinue
if (-not $p.HasExited) { $p.Kill(); "KILLED (timeout)" }
Get-Content $out -Encoding UTF8
"--- stderr ---"
Get-Content $err -Encoding UTF8 | Select-Object -First 15
