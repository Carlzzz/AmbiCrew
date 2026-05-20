[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArgs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopDir '..')).Path

$targetTriple = 'x86_64-pc-windows-msvc'
$electronReleaseDir = Join-Path $desktopDir 'release'
$canonicalOutputDir = Join-Path $desktopDir 'build-artifacts\windows-x64'
$activeOutputDir = $canonicalOutputDir
$appVersion = (Get-Content -Path (Join-Path $desktopDir 'package.json') -Raw | ConvertFrom-Json).version

function Write-Step {
  param([string]$Message)
  Write-Host "[build-windows-x64] $Message"
}

function Assert-WindowsHost {
  if ($env:OS -ne 'Windows_NT') {
    throw '[build-windows-x64] This script must run on Windows.'
  }
}

function Assert-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[build-windows-x64] Missing required command: $Name"
  }
}

function Get-LatestArtifact {
  param(
    [string[]]$SearchRoots,
    [string[]]$Patterns
  )

  foreach ($root in $SearchRoots) {
    if (-not (Test-Path $root)) {
      continue
    }

    foreach ($pattern in $Patterns) {
      $match = Get-ChildItem -Path $root -File -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object Name |
        Select-Object -Last 1

      if ($match) {
        return $match
      }
    }
  }

  return $null
}

function Get-StagedArtifactName {
  param([string]$ArtifactName)

  # Simply return the name as is or handle custom patterns if needed.
  return $ArtifactName
}

function Resolve-OutputDirectory {
  param([string]$PreferredPath)

  New-Item -ItemType Directory -Force -Path $PreferredPath | Out-Null

  $existingArtifacts = Get-ChildItem -Path $PreferredPath -Force -ErrorAction SilentlyContinue
  foreach ($artifact in $existingArtifacts) {
    try {
      Remove-Item -LiteralPath $artifact.FullName -Force -Recurse
    } catch {
      $fallbackPath = "$PreferredPath-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Write-Step "Could not clear locked artifact '$($artifact.FullName)'. Using fallback output directory: $fallbackPath"
      New-Item -ItemType Directory -Force -Path $fallbackPath | Out-Null
      return $fallbackPath
    }
  }

  return $PreferredPath
}

Assert-WindowsHost
Assert-Command bun

if ($env:SKIP_INSTALL -ne '1') {
  Write-Step 'Installing root dependencies...'
  Push-Location $repoRoot
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64] bun install failed in repo root (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  Write-Step 'Installing desktop dependencies...'
  Push-Location $desktopDir
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64] bun install failed in desktop (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

Write-Step 'Cleaning old build/release outputs...'
if (Test-Path $electronReleaseDir) {
  Remove-Item -Path $electronReleaseDir -Force -Recurse -ErrorAction SilentlyContinue
}
$distDir = Join-Path $desktopDir 'dist'
if (Test-Path $distDir) {
  Remove-Item -Path $distDir -Force -Recurse -ErrorAction SilentlyContinue
}
$distElectronDir = Join-Path $desktopDir 'dist-electron'
if (Test-Path $distElectronDir) {
  Remove-Item -Path $distElectronDir -Force -Recurse -ErrorAction SilentlyContinue
}

Write-Step 'Rebuilding frontend, main process, and sidecars...'
Push-Location $desktopDir
try {
  & bun run build:all:pack
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64] frontend/sidecar build failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

$electronBuilderArgs = @(
  'electron-builder',
  '--win',
  '--x64'
)

if ($null -ne $BuilderArgs) {
  $remainingArgs = @($BuilderArgs)
  if ($remainingArgs.Count -gt 0) {
    $electronBuilderArgs += $remainingArgs
  }
}

Write-Step 'Packaging Electron app for Windows x64...'
Push-Location $desktopDir
try {
  & bunx $electronBuilderArgs
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64] electron-builder failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

$activeOutputDir = Resolve-OutputDirectory -PreferredPath $canonicalOutputDir

$artifactPatterns = @('*.exe', '*.zip', 'latest.yml')
$copiedArtifacts = New-Object System.Collections.Generic.List[string]

if (Test-Path $electronReleaseDir) {
  foreach ($pattern in $artifactPatterns) {
    $artifacts = Get-ChildItem -Path $electronReleaseDir -File -Filter $pattern -ErrorAction SilentlyContinue
    foreach ($artifact in $artifacts) {
      $destinationName = Get-StagedArtifactName -ArtifactName $artifact.Name
      $destination = Join-Path $activeOutputDir $destinationName
      Copy-Item -LiteralPath $artifact.FullName -Destination $destination -Force
      if (-not $copiedArtifacts.Contains($destination)) {
        $copiedArtifacts.Add($destination) | Out-Null
      }
    }
  }
}

$installer = Get-LatestArtifact -SearchRoots @($electronReleaseDir) -Patterns @('*.exe')
$installerPath = if ($installer) { $installer.FullName } else { 'not found' }

$buildInfo = @(
  "App version: $appVersion"
  "Target triple: $targetTriple"
  "Canonical output: $canonicalOutputDir"
  "Actual output: $activeOutputDir"
  "Windows installer (EXE): $installerPath"
  "Artifacts copied: $($copiedArtifacts.Count)"
  "Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
)

Set-Content -Path (Join-Path $activeOutputDir 'BUILD_INFO.txt') -Value $buildInfo -Encoding UTF8

Write-Host ''
Write-Step 'Build finished.'
Write-Step "Artifacts output: $activeOutputDir"
if ($installer) {
  Write-Step "Installer source: $($installer.FullName)"
} else {
  Write-Step 'No Windows installer (.exe) found under release directory.'
}

Write-Step "Canonical output: $canonicalOutputDir"

if ($env:OPEN_OUTPUT -eq '1') {
  Invoke-Item $canonicalOutputDir
}
