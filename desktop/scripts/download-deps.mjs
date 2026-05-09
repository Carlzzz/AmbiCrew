/**
 * Downloads and extracts MinGit and embedded Python for Windows packaging.
 *
 * Usage:
 *   node desktop/scripts/download-deps.mjs
 *
 * Downloads MinGit and Python embedded distribution, then bootstraps pip
 * into the Python install so it's ready for Computer Use venv creation.
 *
 * Output:
 *   desktop/resources/MinGit/   - Portable Git (git.exe, bash.exe)
 *   desktop/resources/python/   - Embedded Python with pip
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { get } from 'node:https'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { createExtractFromZip } from './extract-zip.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopDir = join(__dirname, '..')
const resourcesDir = join(desktopDir, 'resources')
const tmpDir = join(resourcesDir, '.tmp')

const MINGIT_VERSION = '2.47.1.windows.1'
const PYTHON_VERSION = '3.12.8'

const DOWNLOADS = {
  mingit: {
    url: `https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}/MinGit-${MINGIT_VERSION}-64-bit.zip`,
    dest: join(tmpDir, 'mingit.zip'),
    extractDir: join(resourcesDir, 'MinGit'),
  },
  python: {
    url: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
    dest: join(tmpDir, 'python.zip'),
    extractDir: join(resourcesDir, 'python'),
  },
  getPip: {
    url: 'https://bootstrap.pypa.io/get-pip.py',
    dest: join(tmpDir, 'get-pip.py'),
  },
}

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log(`  Skip download (exists): ${dest}`)
    return
  }
  console.log(`  Downloading ${url}`)
  console.log(`    → ${dest}`)

  await new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        unlink(dest).catch(() => {})
        download(response.headers.location, dest).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        file.close()
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    }).on('error', reject)
  })
}

function bootstrapPip() {
  const pythonDir = DOWNLOADS.python.extractDir
  const pythonExe = join(pythonDir, 'python.exe')
  const getPipPath = DOWNLOADS.getPip.dest
  const pthFile = join(pythonDir, `python${PYTHON_VERSION.replace(/\./g, '').slice(0, 3)}._pth`)

  console.log('  Configuring site-packages...')
  let pthContent = readFileSync(pthFile, 'utf-8')
  pthContent = pthContent.replace(/#import site/, 'import site')
  if (!pthContent.includes('Lib\\site-packages')) {
    pthContent += '\nLib\\site-packages\n'
  }
  writeFileSync(pthFile, pthContent, 'utf-8')

  console.log('  Installing pip...')
  execSync(`"${pythonExe}" "${getPipPath}" --no-warn-script-location`, {
    stdio: 'inherit',
  })
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Skipping dependency download (not Windows).')
    return
  }

  console.log('Downloading runtime dependencies for Windows packaging...\n')

  mkdirSync(tmpDir, { recursive: true })
  mkdirSync(DOWNLOADS.mingit.extractDir, { recursive: true })
  mkdirSync(DOWNLOADS.python.extractDir, { recursive: true })

  // 1. MinGit
  console.log('--- MinGit ---')
  await download(DOWNLOADS.mingit.url, DOWNLOADS.mingit.dest)
  await createExtractFromZip(DOWNLOADS.mingit.dest, DOWNLOADS.mingit.extractDir)

  // 2. Python embedded
  console.log('\n--- Python ---')
  await download(DOWNLOADS.python.url, DOWNLOADS.python.dest)
  await createExtractFromZip(DOWNLOADS.python.dest, DOWNLOADS.python.extractDir)
  await download(DOWNLOADS.getPip.url, DOWNLOADS.getPip.dest)
  bootstrapPip()

  // Cleanup
  console.log('\nCleaning up temporary files...')
  rmSync(tmpDir, { recursive: true, force: true })

  console.log('\nDone. Bundled dependencies ready in desktop/resources/')
}

main().catch((err) => {
  console.error('Download failed:', err.message)
  process.exit(1)
})
