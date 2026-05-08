/**
 * Dev launcher: starts the Vite dev server, waits for it to be ready,
 * then launches Electron. This replaces the need for two separate terminals.
 *
 * Usage: npm start
 */
import { spawn, execSync } from 'node:child_process'
import { createServer } from 'node:net'
import { platform } from 'node:os'

function log(msg) {
  console.log(`[dev-launch] ${msg}`)
}

const isWin = platform() === 'win32'

// Check if port is already in use (from a previous run)
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

async function killPort(port) {
  log(`Port ${port} is in use, killing existing process...`)
  try {
    if (isWin) {
      execSync(
        `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }"`,
        { stdio: 'ignore' },
      )
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' })
    }
    await new Promise((r) => setTimeout(r, 500))
  } catch {
    // ignore kill errors
  }
}

// Step 1: Build Electron main process
log('Building Electron main process...')
execSync('npx tsc -p electron-tsconfig.json', { stdio: 'inherit' })
log('Electron build complete.')

const VITE_PORT = 1420

// Step 1.5: Ensure Vite port is free
if (!(await isPortFree(VITE_PORT))) {
  await killPort(VITE_PORT)
}

// Step 2: Start Vite dev server in background
log('Starting Vite dev server...')
// On Windows, pass command as single string with shell:true to avoid DEP0190
const vite = spawn(isWin ? 'npx vite' : 'npx', isWin ? [] : ['vite'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: isWin,
})

let viteReady = false
vite.stdout.on('data', (data) => {
  const text = data.toString()
  process.stdout.write(text)
  if (!viteReady && (text.includes('Local:') || text.includes('ready in'))) {
    viteReady = true
    launchElectron()
  }
})

vite.stderr.on('data', (data) => {
  process.stderr.write(data.toString())
})

vite.on('error', (err) => {
  console.error('[dev-launch] Failed to start Vite:', err)
  process.exit(1)
})

// Fallback: if Vite doesn't print ready message within 10s, launch Electron anyway
setTimeout(() => {
  if (!viteReady) {
    log('Vite did not signal readiness within 10s, launching Electron anyway...')
    viteReady = true
    launchElectron()
  }
}, 10_000)

function launchElectron() {
  log('Launching Electron...')
  // On Windows, pass command as single string with shell:true to avoid DEP0190
  const electron = spawn(isWin ? 'npx electron .' : 'npx', isWin ? [] : ['electron', '.'], {
    stdio: 'inherit',
    shell: isWin,
  })

  electron.on('exit', (code) => {
    log(`Electron exited with code ${code}`)
    vite.kill()
    process.exit(code ?? 0)
  })

  electron.on('error', (err) => {
    console.error('[dev-launch] Failed to start Electron:', err)
    vite.kill()
    process.exit(1)
  })
}

// Clean up on Ctrl+C
process.on('SIGINT', () => {
  log('Shutting down...')
  vite.kill()
  process.exit(0)
})
