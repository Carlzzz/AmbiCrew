import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'

let serverProcess: ChildProcess | null = null
let serverPort: number | null = null
let serverUrl: string | null = null

const SERVER_PORT = 43124

function serverExePath(): string {
  if (process.platform === 'win32') {
    return path.join(process.resourcesPath, 'server.exe')
  }
  return path.join(process.resourcesPath, 'server')
}

function findBunExe(): string {
  if (process.platform === 'win32') return 'bun.exe'
  return 'bun'
}

function serverEntryPath(): string {
  return path.join(app.getAppPath(), '..', 'src', 'server', 'index.ts')
}

function serverCwd(): string {
  return path.join(app.getAppPath(), '..')
}

export function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (app.isPackaged) {
      const exePath = serverExePath()
      serverProcess = spawn(exePath, [], {
        env: {
          ...process.env,
          SERVER_PORT: String(SERVER_PORT),
          DESKTOP_MODE: '1',
          CLAUDE_RUNTIME_DIR: path.join(process.resourcesPath, 'runtime'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } else {
      const bunExe = findBunExe()
      const entryPath = serverEntryPath()
      const cwd = serverCwd()
      serverProcess = spawn(bunExe, ['run', entryPath], {
        cwd,
        env: {
          ...process.env,
          SERVER_PORT: String(SERVER_PORT),
          DESKTOP_MODE: '1',
          CLAUDE_RUNTIME_DIR: path.join(cwd, 'runtime'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('Server startup timed out after 30s'))
      }
    }, 30_000)

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (!resolved && text.includes('running at')) {
        resolved = true
        clearTimeout(timeout)
        serverPort = SERVER_PORT
        serverUrl = `http://127.0.0.1:${SERVER_PORT}`
        resolve(serverUrl)
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[server]', data.toString().trim())
    })

    serverProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })

    serverProcess.on('exit', (code, signal) => {
      console.log(`[server] exited with code=${code} signal=${signal}`)
      serverProcess = null
    })
  })
}

export function getServerUrl(): string | null {
  return serverUrl
}

export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL')
      }
    }, 5_000)
  }
}
