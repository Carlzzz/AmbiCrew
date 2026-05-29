<#
.SYNOPSIS
    Sign Windows build artifacts with Authenticode.
.DESCRIPTION
    Decodes a base64-encoded .pfx certificate from WINDOWS_CERTIFICATE_BASE64,
    then signs all .exe files in the NSIS bundle output directory.
    Skips gracefully if the environment variable is not set (local dev).
.PARAMETER ArtifactDir
    Path to the directory containing .exe files to sign.
    Defaults to src-tauri\target\release\bundle\nsis.
#>

param(
    [string]$ArtifactDir = (Join-Path $PSScriptRoot '..\src-tauri\target\release\bundle\nsis')
)

$ErrorActionPreference = 'Stop'

if (-not $env:WINDOWS_CERTIFICATE_BASE64) {
    Write-Host '[sign-windows] WINDOWS_CERTIFICATE_BASE64 not set, skipping code signing.' -ForegroundColor Yellow
    exit 0
}

if (-not $env:WINDOWS_CERTIFICATE_PASSWORD) {
    Write-Host '[sign-windows] WINDOWS_CERTIFICATE_PASSWORD not set, skipping code signing.' -ForegroundColor Yellow
    exit 0
}

$pfxPath = Join-Path $env:RUNNER_TEMP 'certificate.pfx'
if (-not $env:RUNNER_TEMP) {
    $pfxPath = Join-Path $env:TEMP 'ambicrew-sign-certificate.pfx'
}

try {
    Write-Host '[sign-windows] Decoding certificate...' -ForegroundColor Cyan
    [System.IO.File]::WriteAllBytes($pfxPath, [System.Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))

    $exeFiles = Get-ChildItem -Path $ArtifactDir -Filter '*.exe' -ErrorAction Stop
    if ($exeFiles.Count -eq 0) {
        Write-Host "[sign-windows] No .exe files found in $ArtifactDir" -ForegroundColor Yellow
        exit 0
    }

    foreach ($exe in $exeFiles) {
        Write-Host "[sign-windows] Signing $($exe.Name)..." -ForegroundColor Cyan
        & signtool sign /f $pfxPath /p $env:WINDOWS_CERTIFICATE_PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 $exe.FullName
        if ($LASTEXITCODE -ne 0) {
            throw "signtool failed for $($exe.Name) with exit code $LASTEXITCODE"
        }
    }

    Write-Host '[sign-windows] All artifacts signed successfully.' -ForegroundColor Green
}
finally {
    if (Test-Path $pfxPath) {
        Remove-Item $pfxPath -Force
    }
}
