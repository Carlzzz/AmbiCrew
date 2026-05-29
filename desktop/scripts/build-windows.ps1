<#
.SYNOPSIS
    Build AmbiCrew for Windows using Tauri.
.DESCRIPTION
    Builds the frontend, sidecars, and packages the app as an NSIS installer.
    Run from the desktop/ directory or let the script navigate there automatically.
#>

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '==> Building frontend + sidecars...' -ForegroundColor Cyan
npm run build:all

Write-Host '==> Running tauri build...' -ForegroundColor Cyan
npx tauri build

Write-Host '==> Done. Artifacts:' -ForegroundColor Green
Get-ChildItem -Path 'src-tauri\target\release\bundle\nsis\*.exe' -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  $_" }
