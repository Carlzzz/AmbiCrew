import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDatabase, closeDatabase } from './db/database.js'
import { startServer, stopServer, getServerUrl } from './server/serverManager.js'
import { setupSingleInstance } from './shell/singleInstance.js'
import { setAppMenu } from './shell/appMenu.js'
import { registerShellIpc } from './ipc/shellIpc.js'
import { registerWhitelistedInvoke } from './ipc/ipcRegistry.js'
import { registerAuthIpc, registerOpenUrlHandler, findProtocolUrlInArgv, dispatchCentralAuthUrl } from './ipc/authIpc.js'
import { registerTerminalIpc } from './ipc/terminalIpc.js'
import { registerNotificationIpc } from './ipc/notificationIpc.js'
import { registerAdapterIpc } from './ipc/adapterIpc.js'
import { startAdapters, stopAdapters } from './server/adapterManager.js'
import { AuthController } from './auth/authController.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// --- Inject bundled tools into PATH ---
// In packaged mode, prepend bundled MinGit/cmd, MinGit/bin, and python
// to PATH so that git.exe, bash.exe, and python.exe are available to
// the server process and any spawned child processes.

function injectBundledToolsPath(): void {
  if (!app.isPackaged) return
  const rp = process.resourcesPath

  // Put user bin dir first so `ambi` (installed by the server at startup)
  // is discoverable in the built-in terminal without a restart.
  const userBin = path.join(app.getPath('home'), '.local', 'bin')

  const entries = [
    userBin,
    path.join(rp, 'MinGit', 'cmd'),
    path.join(rp, 'MinGit', 'bin'),
    path.join(rp, 'python'),
  ]
  process.env.PATH = entries.join(path.delimiter) + path.delimiter + (process.env.PATH || '')
  console.log('[main] Injected bundled Git/Python + user bin into PATH')
}

// --- Load .env ---

function loadEnvFile(): void {
  // In packaged mode, .env is in resources/ alongside the app.asar.
  // In dev mode, .env is at the repo root (two levels above __dirname).
  let envDir: string
  if (app.isPackaged) {
    envDir = process.resourcesPath
  } else {
    envDir = path.resolve(__dirname, '..', '..')
  }
  const envPath = path.join(envDir, '.env')
  try {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (key && !process.env[key]) {
        process.env[key] = value
      }
    }
    console.log('[main] Loaded .env from', envPath)
  } catch {
    console.log('[main] No .env found at', envPath)
  }
}
loadEnvFile()

// --- Register custom protocol handler BEFORE app.whenReady() ---
// CrewCentral redirects to testcrew://auth?access_token=... after login.
// The OS routes this back to the Electron app via the registered protocol.

const AUTH_PROTOCOL_SCHEME = process.env.AUTH_CALLBACK_SCHEME?.trim() || 'testcrew'

function registerCustomProtocolClient(): void {
  try {
    if (process.defaultApp) {
      // Dev mode: electron is running with `electron .` so we need to pass
      // the path to the app entry as an extra argument
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(AUTH_PROTOCOL_SCHEME, process.execPath, [
          path.resolve(process.argv[1]),
        ])
      }
    } else {
      app.setAsDefaultProtocolClient(AUTH_PROTOCOL_SCHEME)
    }
    console.log('[main] Registered protocol handler for', AUTH_PROTOCOL_SCHEME)
  } catch (e) {
    console.warn('[main] setAsDefaultProtocolClient failed', e)
  }
}

registerCustomProtocolClient()
registerOpenUrlHandler()

// --- Single instance lock ---
// On Windows, custom protocol URLs arrive via second-instance argv

if (!setupSingleInstance(() => mainWindow, (argv: string[]) => {
  const url = findProtocolUrlInArgv(argv)
  if (url) {
    dispatchCentralAuthUrl(url)
  }
})) {
  app.quit()
}

// --- Window management ---

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AmbiCrew',
    icon: app.isPackaged
      ? app.getPath('exe')
      : path.join(__dirname, '..', 'public', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    win.loadURL('http://127.0.0.1:1420')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('closed', () => { mainWindow = null })
  return win
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  setAppMenu()

  // Check for protocol URL in startup argv (Windows: first launch with deep link)
  const deepLinkOnStart = findProtocolUrlInArgv(process.argv)
  if (deepLinkOnStart) {
    dispatchCentralAuthUrl(deepLinkOnStart)
  }

  try {
    await openDatabase()
    console.log('[main] Database opened')
  } catch (err) {
    console.error('[main] Database open failed:', err)
  }

  injectBundledToolsPath()

  try {
    const serverUrl = await startServer()
    console.log('[main] Server started at', serverUrl)
  } catch (err) {
    console.error('[main] Server start failed:', err)
  }

  try {
    await startAdapters()
    console.log('[main] Adapters started')
  } catch (err) {
    console.error('[main] Adapter start failed:', err)
  }

  registerShellIpc()
  registerTerminalIpc()
  registerNotificationIpc()
  registerAdapterIpc()

  registerWhitelistedInvoke('server:getBaseUrl', async () => {
    const url = getServerUrl()
    if (!url) return { ok: false, error: 'Server not ready' }
    return { ok: true, baseUrl: url }
  })

  // Initialize auth
  const authController = new AuthController()
  registerAuthIpc({ controller: authController })

  const restored = await authController.checkServerAuthStatus()
  if (restored) {
    console.log('[main] CrewCentral session restored')
  }

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopAdapters()
  stopServer()
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopAdapters()
  stopServer()
  closeDatabase()
})
