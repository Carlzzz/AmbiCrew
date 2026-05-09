/**
 * Cross-platform zip extraction helper.
 * Uses system tools: Expand-Archive on Windows, unzip on POSIX.
 */

import { execSync } from 'node:child_process'

/**
 * Extract a zip file to a destination directory.
 * @param {string} zipPath - Path to the zip file
 * @param {string} destDir - Destination directory
 */
export async function createExtractFromZip(zipPath, destDir) {
  const { mkdirSync, existsSync } = await import('node:fs')
  mkdirSync(destDir, { recursive: true })

  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'inherit' },
    )
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' })
  }
}
