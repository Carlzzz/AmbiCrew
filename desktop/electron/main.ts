import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, closeDatabase } from './db/database.js'
import { startServer, stopServer, getServerUrl } from './server/serverManager.js'
import { setupSingleInstance } from './shell/singleInstance.js'
import { setAppMenu } from './shell/appMenu.js'
import { registerShellIpc } from './ipc/shellIpc.js'
import { registerWhitelistedInvoke } from './ipc/ipcRegistry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AmbiCrew',
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

app.whenReady().then(async () => {
  setupSingleInstance(getMainWindow)
  setAppMenu()

  try {
    await openDatabase()
    console.log('[main] Database opened')
  } catch (err) {
    console.error('[main] Database open failed:', err)
  }

  try {
    const serverUrl = await startServer()
    console.log('[main] Server started at', serverUrl)
  } catch (err) {
    console.error('[main] Server start failed:', err)
  }

  registerShellIpc()

  registerWhitelistedInvoke('server:getBaseUrl', async () => {
    const url = getServerUrl()
    if (!url) return { ok: false, error: 'Server not ready' }
    return { ok: true, baseUrl: url }
  })

  // Auth, skills IPC will be registered later

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopServer()
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopServer()
  closeDatabase()
})
