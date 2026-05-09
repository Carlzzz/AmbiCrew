/**
 * Builds the server entrypoint into a standalone binary via `bun build --compile`.
 *
 * Usage:
 *   bun run desktop/scripts/build-server.mjs           # current platform
 *   bun run desktop/scripts/build-server.mjs win32     # cross-compile (if supported)
 *
 * Output:
 *   desktop/resources/server.exe   (Windows)
 *   desktop/resources/server        (macOS / Linux)
 */

import { execSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopDir, '..')
const resourcesDir = path.join(desktopDir, 'resources')

const targetPlatform = process.argv[2] || process.platform

const PLATFORM_TARGETS: Record<string, string> = {
  win32: 'bun-windows-x64',
  darwin: 'bun-darwin-arm64',
  linux: 'bun-linux-x64',
}

const PLATFORM_EXTS: Record<string, string> = {
  win32: '.exe',
  darwin: '',
  linux: '',
}

const target = PLATFORM_TARGETS[targetPlatform]
if (!target) {
  console.error(`Unsupported platform: ${targetPlatform}`)
  process.exit(1)
}

const ext = PLATFORM_EXTS[targetPlatform]
const outfile = path.join(resourcesDir, `server${ext}`)

// Ensure output directory exists
mkdirSync(resourcesDir, { recursive: true })

// Remove old binary if it exists
if (existsSync(outfile)) {
  rmSync(outfile)
}

console.log(`Building server for ${targetPlatform} (${target})...`)
console.log(`  Entry:  src/server/index.ts`)
console.log(`  Output: ${outfile}`)

execSync(
  `bun build --compile --target=${target} src/server/index.ts --outfile="${outfile}"`,
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
)

console.log('Server binary built successfully.')
