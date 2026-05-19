/**
 * Downloads ripgrep binary for the target platform into desktop/resources/ripgrep/.
 *
 * Directory layout:
 *   desktop/resources/ripgrep/win32-x64/rg.exe
 *   desktop/resources/ripgrep/darwin-arm64/rg
 *   desktop/resources/ripgrep/darwin-x64/rg
 *   desktop/resources/ripgrep/linux-x64/rg
 *
 * Usage:
 *   bun run desktop/scripts/download-ripgrep.ts           # current platform
 *   bun run desktop/scripts/download-ripgrep.ts win32     # Windows x64
 *   bun run desktop/scripts/download-ripgrep.ts darwin    # macOS (host arch)
 *   bun run desktop/scripts/download-ripgrep.ts linux     # Linux x64
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopDir = join(__dirname, '..')
const resourcesDir = join(desktopDir, 'resources')

const RIPGREP_VERSION = '14.1.1'

type PlatformTarget = {
  platform: string
  arch: string
  subdir: string
  fileName: string
  downloadUrl: string
  archiveType: 'zip' | 'tar.gz'
}

function getTarget(platform: string, arch: string): PlatformTarget {
  switch (platform) {
    case 'win32': {
      const release = `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc`
      return {
        platform: 'win32',
        arch: 'x64',
        subdir: 'win32-x64',
        fileName: 'rg.exe',
        downloadUrl: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${release}.zip`,
        archiveType: 'zip',
      }
    }
    case 'darwin': {
      if (arch === 'arm64') {
        const release = `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin`
        return {
          platform: 'darwin',
          arch: 'arm64',
          subdir: 'darwin-arm64',
          fileName: 'rg',
          downloadUrl: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${release}.tar.gz`,
          archiveType: 'tar.gz',
        }
      }
      const release = `ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin`
      return {
        platform: 'darwin',
        arch: 'x64',
        subdir: 'darwin-x64',
        fileName: 'rg',
        downloadUrl: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${release}.tar.gz`,
        archiveType: 'tar.gz',
      }
    }
    case 'linux': {
      const release = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl`
      return {
        platform: 'linux',
        arch: 'x64',
        subdir: 'linux-x64',
        fileName: 'rg',
        downloadUrl: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${release}.tar.gz`,
        archiveType: 'tar.gz',
      }
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`  Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
  }

  const fileStream = createWriteStream(destPath)
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fileStream.write(value as Uint8Array)
  }
  fileStream.end()
  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', resolve)
    fileStream.on('error', reject)
  })
}

function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })

  if (process.platform === 'win32') {
    console.log('  Extracting with PowerShell...')
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error('Failed to extract zip')
    }
  } else {
    console.log('  Extracting with unzip...')
    const result = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error('Failed to extract zip')
    }
  }
}

function extractTarGz(tarPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  console.log('  Extracting with tar...')
  const result = spawnSync('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error('Failed to extract tar.gz')
  }
}

function findAndMoveRg(extractDir: string, outputPath: string, binaryName: string): void {
  function walk(dir: string): string | null {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = walk(fullPath)
        if (found) return found
      } else if (entry.isFile()) {
        if (entry.name === binaryName || entry.name === 'rg' || entry.name === 'rg.exe') {
          return fullPath
        }
      }
    }
    return null
  }

  const found = walk(extractDir)
  if (!found) {
    throw new Error(`Could not find ${binaryName} in extracted archive at ${extractDir}`)
  }

  renameSync(found, outputPath)
}

async function downloadRipgrep(target: PlatformTarget): Promise<void> {
  const outputDir = join(resourcesDir, 'ripgrep', target.subdir)
  const outputPath = join(outputDir, target.fileName)

  if (existsSync(outputPath)) {
    console.log(`[download-ripgrep] ripgrep already exists at ${outputPath}`)
    return
  }

  mkdirSync(outputDir, { recursive: true })

  const tempDir = join(resourcesDir, 'ripgrep', '.tmp')
  mkdirSync(tempDir, { recursive: true })

  const archiveExt = target.archiveType === 'zip' ? '.zip' : '.tar.gz'
  const archivePath = join(tempDir, `ripgrep-${target.subdir}${archiveExt}`)

  try {
    await downloadFile(target.downloadUrl, archivePath)

    const extractDir = join(tempDir, 'extract')
    if (target.archiveType === 'zip') {
      extractZip(archivePath, extractDir)
    } else {
      extractTarGz(archivePath, extractDir)
    }

    findAndMoveRg(extractDir, outputPath, target.fileName)

    if (target.platform !== 'win32') {
      chmodSync(outputPath, 0o755)
    }

    console.log(`[download-ripgrep] Installed ripgrep to ${outputPath}`)
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
}

async function main() {
  const targetPlatform = process.argv[2] || process.platform
  let arch = process.arch

  if (targetPlatform === 'darwin') {
    try {
      const result = spawnSync('uname', ['-m'], { encoding: 'utf8' })
      const machine = result.stdout.trim()
      if (machine === 'arm64' || machine === 'x86_64') {
        arch = machine === 'arm64' ? 'arm64' : 'x64'
      }
    } catch {
      // Use process.arch as fallback
    }
  }

  console.log(`[download-ripgrep] Target: ${targetPlatform} ${arch}`)
  const target = getTarget(targetPlatform, arch)
  await downloadRipgrep(target)
  console.log('[download-ripgrep] Done')
}

main().catch(err => {
  console.error('[download-ripgrep] Error:', err.message)
  process.exit(1)
})
