# AmbiCrew Electron Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert AmbiCrew desktop from Tauri to Electron, add CrewCentral OAuth login with username display, device management (heartbeat/registration), and skill management (hub integration with three-root discovery).

**Architecture:** Replace `desktop/src-tauri/` (Rust) with `desktop/electron/` (Node.js). Electron main process manages BrowserWindow, Bun server child process, IPC handlers, device heartbeat, and skill sync. Renderer uses `contextBridge` preload API instead of `@tauri-apps/*`.

**Tech Stack:** Electron 40.3.0, electron-builder 26.0.12, sql.js 1.14.1, React 18, Vite 8, Zustand 5, TypeScript 5.9

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/electron/main.ts` | Create | Entry: window, lifecycle, startup sequence |
| `desktop/electron/preload.ts` | Create | contextBridge API surface |
| `desktop/electron/ipc/ipcRegistry.ts` | Create | Whitelist + validate + register pattern |
| `desktop/electron/ipc/authIpc.ts` | Create | auth:* channel handlers |
| `desktop/electron/ipc/shellIpc.ts` | Create | shell:* channel handlers |
| `desktop/electron/ipc/skillsIpc.ts` | Create | skills:* channel handlers |
| `desktop/electron/auth/authController.ts` | Create | Auth state machine |
| `desktop/electron/auth/callbackServer.ts` | Create | OAuth callback HTTP server |
| `desktop/electron/auth/tokenStore.ts` | Create | Token persistence |
| `desktop/electron/auth/deviceManager.ts` | Create | Device UUID, MAC, heartbeat |
| `desktop/electron/skills/skillManager.ts` | Create | Discovery, install, enable/disable |
| `desktop/electron/skills/skillHubClient.ts` | Create | CrewCentral hub API |
| `desktop/electron/skills/skillRoots.ts` | Create | Three-root management |
| `desktop/electron/server/serverManager.ts` | Create | Bun server child process |
| `desktop/electron/shell/appMenu.ts` | Create | Native app menu (zh-CN/en-US) |
| `desktop/electron/shell/singleInstance.ts` | Create | Single instance lock |
| `desktop/electron/shell/updateManager.ts` | Create | electron-updater placeholder |
| `desktop/electron/db/database.ts` | Create | sql.js SQLite for kv store |
| `desktop/electron-builder.yml` | Create | Packaging config |
| `desktop/electron-tsconfig.json` | Create | TypeScript config for main process |
| `desktop/src/types/global.d.ts` | Create | window.electron type declarations |
| `desktop/src/lib/desktopRuntime.ts` | Modify | Tauri invoke → preload API |
| `desktop/src/components/layout/Sidebar.tsx` | Modify | GitHub link → username |
| `desktop/src/components/settings/CrewCentralLogin.tsx` | Modify | shell.open → preload |
| `desktop/src/components/layout/TitleBar.tsx` | Modify | Remove data-tauri-drag-region |
| `desktop/src/components/layout/AppShell.tsx` | Modify | Remove Tauri event listener |
| `desktop/src/stores/centralOAuthStore.ts` | Modify | API adaptation |
| `desktop/package.json` | Modify | Swap Tauri for Electron deps |
| `desktop/vite.config.ts` | Modify | Electron-compatible build |
| `desktop/index.html` | Modify | CSP update |
| `desktop/src-tauri/` | Delete | Entire directory |
| `src/services/central/device-manager.ts` | Modify | Enhance heartbeat logic |
| `src/services/central/skill-client.ts` | Modify | Enhance download flow |

---

## Phase 1: Electron Scaffold

### Task 1: Setup Electron dependencies and build config

**Files:**
- Modify: `desktop/package.json`
- Create: `desktop/electron-builder.yml`
- Create: `desktop/electron-tsconfig.json`

- [ ] **Step 1: Update package.json**

Replace optionalDependencies block. Change the full package.json to:

```json
{
  "name": "ambicrew-desktop",
  "private": true,
  "version": "0.3.0",
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "build:electron": "tsc -p electron-tsconfig.json",
    "build:all": "npm run build && npm run build:electron",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "lint": "tsc --noEmit",
    "electron:dev": "npm run build:electron && electron .",
    "pack": "npm run build:all && electron-builder --dir",
    "dist": "npm run build:all && electron-builder"
  },
  "dependencies": {
    "@tailwindcss/typography": "^0.5.19",
    "@types/dompurify": "^3.2.0",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "dompurify": "^3.3.3",
    "lucide-react": "^0.469.0",
    "marked": "^15.0.7",
    "mermaid": "^11.14.0",
    "prism-react-renderer": "^2.4.1",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-diff-viewer-continued": "^4.2.0",
    "react-dom": "^18.3.1",
    "react-shiki": "^0.9.2",
    "shiki": "^4.0.2",
    "adm-zip": "^0.5.16",
    "sql.js": "^1.14.1",
    "zustand": "^5.0.3"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^6.0.1",
    "electron": "^40.3.0",
    "electron-builder": "^26.0.12",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.9.3",
    "vite": "^8.0.10",
    "vitest": "^3.0.4"
  }
}
```

- [ ] **Step 2: Create electron-builder.yml**

```yaml
appId: com.ambicrew.ambicrew
productName: AmbiCrew
directories:
  output: release
  buildResources: public
files:
  - dist/**/*
  - dist-electron/**/*
  - package.json
asar: true
extraResources:
  - from: ../.env
    to: .env
  - from: ../src/server
    to: server
    filter:
      - "**/*"
win:
  target:
    - target: nsis
      arch: [x64]
    - target: zip
      arch: [x64]
  icon: public/app-icon.png
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  icon: public/app-icon.png
  hardenedRuntime: true
linux:
  target:
    - target: AppImage
      arch: [x64]
  icon: public/app-icon.png
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 3: Create electron-tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist-electron",
    "rootDir": "electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["electron/**/*.ts"]
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd desktop && npm install
```

- [ ] **Step 5: Commit**

```bash
git add desktop/package.json desktop/electron-builder.yml desktop/electron-tsconfig.json desktop/package-lock.json
git commit -m "chore: add Electron dependencies and build configuration"
```

---

### Task 2: Create database module (sql.js)

**Files:**
- Create: `desktop/electron/db/database.ts`

- [ ] **Step 1: Create database.ts**

```typescript
// desktop/electron/db/database.ts
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let db: SqlJsDatabase | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 300

function dbPath(): string {
  return path.join(app.getPath('userData'), 'ambicrew.sqlite')
}

export async function openDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs()
  const filePath = dbPath()
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }
  db.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)`)
  return db
}

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not opened')
  return db
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushSave(), DEBOUNCE_MS)
}

export function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  const dir = path.dirname(dbPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dbPath(), buffer)
}

export function kvGet(key: string): string | null {
  const row = getDb().exec('SELECT value FROM kv WHERE key = ?', [key])
  if (row.length > 0 && row[0]!.values.length > 0) {
    return row[0]!.values[0]![0] as string | null
  }
  return null
}

export function kvSet(key: string, value: string): void {
  getDb().run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value])
  scheduleSave()
}

export function kvDelete(key: string): void {
  getDb().run('DELETE FROM kv WHERE key = ?', [key])
  scheduleSave()
}

export function closeDatabase() {
  flushSave()
  if (db) { db.close(); db = null }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/db/database.ts
git commit -m "feat: add sql.js database module for Electron main process"
```

---

### Task 3: Create server manager (Bun child process)

**Files:**
- Create: `desktop/electron/server/serverManager.ts`

- [ ] **Step 1: Create serverManager.ts**

```typescript
// desktop/electron/server/serverManager.ts
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'

let serverProcess: ChildProcess | null = null
let serverPort: number | null = null
let serverUrl: string | null = null

const SERVER_PORT = 43124

function findBunExe(): string {
  if (process.platform === 'win32') return 'bun.exe'
  return 'bun'
}

function serverEntryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server', 'index.ts')
  }
  return path.join(app.getAppPath(), '..', 'src', 'server', 'index.ts')
}

function serverCwd(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath)
  }
  return path.join(app.getAppPath(), '..')
}

export function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const bunExe = findBunExe()
    const entryPath = serverEntryPath()
    const cwd = serverCwd()

    serverProcess = spawn(bunExe, ['run', entryPath], {
      cwd,
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        DESKTOP_MODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('Server startup timed out after 30s'))
      }
    }, 30_000)

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (!resolved && text.includes('listening')) {
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
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/server/serverManager.ts
git commit -m "feat: add Bun server child process manager for Electron"
```

---

### Task 4: Create IPC registry (whitelist pattern)

**Files:**
- Create: `desktop/electron/ipc/ipcRegistry.ts`

- [ ] **Step 1: Create ipcRegistry.ts**

```typescript
// desktop/electron/ipc/ipcRegistry.ts
import { ipcMain, type IpcMainInvokeEvent } from 'electron'

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const WHITELIST_INVOKE_CHANNELS = new Set([
  'auth:getStatus',
  'auth:login',
  'auth:logout',
  'shell:openExternal',
  'shell:showOpenDialog',
  'shell:getAppVersion',
  'model:list',
  'model:setActive',
  'skills:list',
  'skills:setEnabled',
  'skills:listHub',
  'skills:download',
  'skills:delete',
  'server:getBaseUrl',
])

export function registerWhitelistedInvoke(channel: string, handler: InvokeHandler): void {
  if (!WHITELIST_INVOKE_CHANNELS.has(channel)) {
    throw new Error(`IPC channel not whitelisted: ${channel}`)
  }
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      console.error(`[ipc] ${channel} error:`, err)
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}

export function registerOnChannel(
  channel: string,
  handler: (...args: unknown[]) => void,
): () => void {
  ipcMain.on(channel, (_event, ...args) => handler(...args))
  return () => ipcMain.removeAllListeners(channel)
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/ipc/ipcRegistry.ts
git commit -m "feat: add whitelist-based IPC registry for Electron"
```

---

### Task 5: Create shell IPC handlers

**Files:**
- Create: `desktop/electron/ipc/shellIpc.ts`

- [ ] **Step 1: Create shellIpc.ts**

```typescript
// desktop/electron/ipc/shellIpc.ts
import { shell, dialog, app } from 'electron'
import { registerWhitelistedInvoke } from './ipcRegistry.js'

export function registerShellIpc() {
  registerWhitelistedInvoke('shell:openExternal', async (_event, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Invalid protocol' }
    }
    await shell.openExternal(url)
    return { ok: true }
  })

  registerWhitelistedInvoke('shell:showOpenDialog', async (_event, opts: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(opts)
    return { ok: true, canceled: result.canceled, filePaths: result.filePaths }
  })

  registerWhitelistedInvoke('shell:getAppVersion', async () => {
    return { ok: true, version: app.getVersion() }
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/ipc/shellIpc.ts
git commit -m "feat: add shell IPC handlers (openExternal, dialog, version)"
```

---

### Task 6: Create preload script

**Files:**
- Create: `desktop/electron/preload.ts`

- [ ] **Step 1: Create preload.ts**

```typescript
// desktop/electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,

  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onStatusChanged: (callback: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
      ipcRenderer.on('auth:onStatusChanged', handler)
      return () => ipcRenderer.removeListener('auth:onStatusChanged', handler)
    },
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    showOpenDialog: (opts: Electron.OpenDialogOptions) =>
      ipcRenderer.invoke('shell:showOpenDialog', opts),
    getAppVersion: () => ipcRenderer.invoke('shell:getAppVersion'),
  },

  model: {
    list: () => ipcRenderer.invoke('model:list'),
    setActive: (id: string) => ipcRenderer.invoke('model:setActive', id),
  },

  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('skills:setEnabled', id, enabled),
    listHub: () => ipcRenderer.invoke('skills:listHub'),
    download: (slug: string, version: string) =>
      ipcRenderer.invoke('skills:download', slug, version),
    delete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  },

  server: {
    getBaseUrl: () => ipcRenderer.invoke('server:getBaseUrl'),
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/preload.ts
git commit -m "feat: add Electron preload script with contextBridge API"
```

---

### Task 7: Create single instance and app menu

**Files:**
- Create: `desktop/electron/shell/singleInstance.ts`
- Create: `desktop/electron/shell/appMenu.ts`
- Create: `desktop/electron/shell/updateManager.ts`

- [ ] **Step 1: Create singleInstance.ts**

```typescript
// desktop/electron/shell/singleInstance.ts
import { app } from 'electron'

let mainWindow: Electron.BrowserWindow | null = null

export function setupSingleInstance(getWindow: () => Electron.BrowserWindow | null) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    mainWindow = getWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
```

- [ ] **Step 2: Create appMenu.ts**

```typescript
// desktop/electron/shell/appMenu.ts
import { Menu, type MenuItemConstructorOptions } from 'electron'

export function createAppMenu(): MenuItemConstructorOptions[] {
  // Minimal menu — can be expanded later
  return [
    {
      label: 'AmbiCrew',
      submenu: [
        { role: 'about', label: '关于 AmbiCrew' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ]
}

export function setAppMenu() {
  const template = createAppMenu()
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
```

- [ ] **Step 3: Create updateManager.ts (placeholder)**

```typescript
// desktop/electron/shell/updateManager.ts
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'failed'

export class UpdateManager {
  private status: UpdateStatus = 'idle'

  getStatus(): UpdateStatus {
    return this.status
  }

  async checkForUpdates(): Promise<void> {
    this.status = 'checking'
    // Placeholder — will wire electron-updater later
    this.status = 'idle'
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/shell/singleInstance.ts desktop/electron/shell/appMenu.ts desktop/electron/shell/updateManager.ts
git commit -m "feat: add single instance lock, app menu, and update manager stubs"
```

---

### Task 8: Create Electron main.ts entry point

**Files:**
- Create: `desktop/electron/main.ts`

- [ ] **Step 1: Create main.ts with BrowserWindow and startup sequence**

```typescript
// desktop/electron/main.ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, closeDatabase } from './db/database.js'
import { startServer, stopServer, getServerUrl } from './server/serverManager.js'
import { setupSingleInstance } from './shell/singleInstance.js'
import { setAppMenu } from './shell/appMenu.js'
import { registerShellIpc } from './ipc/shellIpc.js'

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
    win.loadURL('http://127.0.0.1:5173')
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
```

- [ ] **Step 2: Build and verify Electron starts**

```bash
cd desktop && npm run build:electron && npx electron .
```

Expected: Electron window opens, loads Vite dev server (if running) or blank page.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/main.ts
git commit -m "feat: add Electron main process entry with window and server lifecycle"
```

---

## Phase 2: Remove Tauri & Adapt Renderer

### Task 9: Remove Tauri directory and dependencies

**Files:**
- Delete: `desktop/src-tauri/` (entire directory)

- [ ] **Step 1: Delete Tauri directory**

```bash
rm -rf desktop/src-tauri
```

- [ ] **Step 2: Commit**

```bash
git add -A desktop/src-tauri/
git commit -m "refactor: remove Tauri Rust backend (src-tauri)"
```

---

### Task 10: Adapt desktopRuntime.ts

**Files:**
- Modify: `desktop/src/lib/desktopRuntime.ts`

- [ ] **Step 1: Rewrite desktopRuntime.ts for Electron preload API**

```typescript
// desktop/src/lib/desktopRuntime.ts
import { getDefaultBaseUrl, setBaseUrl } from '../api/client'

function isElectronRuntime() {
  if (typeof window === 'undefined') return false
  return 'electron' in window
}

export { isElectronRuntime as isTauriRuntime }

export async function initializeDesktopServerUrl() {
  if (!isElectronRuntime()) {
    const fallbackUrl = getDefaultBaseUrl()
    setBaseUrl(fallbackUrl)
    await waitForHealth(fallbackUrl)
    return fallbackUrl
  }

  const electron = (window as unknown as { electron: { server: { getBaseUrl: () => Promise<{ ok: boolean; baseUrl?: string; error?: string }> } } }).electron
  const result = await electron.server.getBaseUrl()
  if (!result.ok || !result.baseUrl) {
    throw new Error(result.error || 'Failed to get server URL from Electron')
  }
  setBaseUrl(result.baseUrl)
  await waitForHealth(result.baseUrl)
  return result.baseUrl
}

async function waitForHealth(serverUrl: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/health`, { cache: 'no-store' })
      if (response.ok) return
      lastError = new Error(`healthcheck returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    lastError instanceof Error
      ? `Local server healthcheck failed: ${lastError.message}`
      : 'Local server healthcheck failed',
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/lib/desktopRuntime.ts
git commit -m "refactor: adapt desktopRuntime for Electron preload API"
```

---

### Task 11: Adapt CrewCentralLogin.tsx

**Files:**
- Modify: `desktop/src/components/settings/CrewCentralLogin.tsx`

- [ ] **Step 1: Replace Tauri shell.open with Electron preload**

Replace lines 7-9 (the imports and shellOpen usage):

```typescript
// desktop/src/components/settings/CrewCentralLogin.tsx
//
// CrewCentral login UI component — shows login status and provides
// login/logout buttons. Opens browser for OAuth flow via Electron shell.openExternal.
// Uses server-side central-oauth API for session management.

import { useEffect } from 'react'
import { useCentralOAuthStore } from '../../stores/centralOAuthStore'

function openExternal(url: string) {
  if (typeof window !== 'undefined' && 'electron' in window) {
    const electron = (window as unknown as { electron: { shell: { openExternal: (u: string) => Promise<{ ok: boolean; error?: string }> } } }).electron
    electron.shell.openExternal(url).catch((err) => {
      console.error('[CrewCentralLogin] openExternal failed:', err)
    })
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function CrewCentralLogin() {
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useCentralOAuthStore()

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  const handleLogin = async () => {
    try {
      const { authorizeUrl } = await login()
      let validUrl: URL
      try {
        validUrl = new URL(authorizeUrl)
        if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
          throw new Error('Invalid protocol')
        }
      } catch {
        useCentralOAuthStore.setState({
          error: '授权地址无效，请联系管理员',
        })
        return
      }

      openExternal(authorizeUrl)
      startPolling()
    } catch {
      // store.login() errors are already captured into store.error
    }
  }

  if (status === null) {
    if (error) {
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
            <span className="text-xs text-[var(--color-error)]">连接失败</span>
          </div>
          <div className="text-xs text-[var(--color-error)]">{error}</div>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
      </div>
    )
  }

  if (status.loggedIn) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
          <span className="text-[var(--color-success)] text-xs">
            ✓ 已连接
            {status.displayName ? ` — ${status.displayName}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={isLoading}
          className="self-start px-3 py-1 text-xs rounded-md border border-[var(--color-border-separator)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
        >
          {isLoading ? '断开中...' : '断开连接'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">CrewCentral</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">未连接</span>
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">
        连接 CrewCentral 中控系统，自动获取模型列表并通过 CrewProxy 网关进行用量统计。
      </div>
      <button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="self-start rounded-md bg-[image:var(--gradient-btn-primary)] px-4 py-2 text-sm text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:brightness-105 disabled:opacity-50 transition-opacity"
      >
        {isLoading ? '启动中...' : '连接 CrewCentral'}
      </button>
      {error && (
        <div className="text-xs text-[var(--color-error)]">{error}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/components/settings/CrewCentralLogin.tsx
git commit -m "refactor: replace Tauri shell.open with Electron openExternal in CrewCentralLogin"
```

---

### Task 12: Adapt TitleBar, AppShell, WindowControls

**Files:**
- Modify: `desktop/src/components/layout/TitleBar.tsx`
- Modify: `desktop/src/components/layout/AppShell.tsx`
- Modify: `desktop/src/components/layout/WindowControls.tsx`

- [ ] **Step 1: Remove data-tauri-drag-region from TitleBar.tsx**

In `desktop/src/components/layout/TitleBar.tsx`, remove `data-tauri-drag-region` from the root div (line 11) and spacer div (line 14). Change:

```tsx
<div
  className="h-[var(--titlebar-height)] flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] select-none"
  data-tauri-drag-region
>
  {/* macOS traffic light spacer */}
  <div className="w-[78px] flex-shrink-0" data-tauri-drag-region />
```

To:

```tsx
<div
  className="h-[var(--titlebar-height)] flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] select-none"
  style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
>
  {/* macOS traffic light spacer */}
  <div className="w-[78px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
```

Also mark interactive elements (buttons) as `style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}`.

- [ ] **Step 2: Remove Tauri event listener from AppShell.tsx**

In `desktop/src/components/layout/AppShell.tsx`, remove the `useEffect` that listens for `native-menu-navigate` (lines 60-76). Change the imports:

```typescript
import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl, isTauriRuntime } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { StartupErrorView } from './StartupErrorView'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'
```

And remove the entire `useEffect` block that contains the Tauri event listener (lines 60-76).

- [ ] **Step 3: Adapt WindowControls.tsx**

Read the current WindowControls.tsx. Remove any Tauri-specific window control code. Replace with Electron window controls using `window.electron.shell` or native BrowserWindow controls (since Electron provides native window controls by default on Windows, we can simplify this).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/layout/TitleBar.tsx desktop/src/components/layout/AppShell.tsx desktop/src/components/layout/WindowControls.tsx
git commit -m "refactor: remove Tauri-specific DOM attributes and event listeners"
```

---

### Task 13: Update vite config, index.html, and global types

**Files:**
- Modify: `desktop/vite.config.ts`
- Modify: `desktop/index.html`
- Create: `desktop/src/types/global.d.ts`

- [ ] **Step 1: Update vite.config.ts for Electron**

```typescript
// desktop/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
```

- [ ] **Step 2: Update index.html CSP**

Remove Tauri-specific CSP directives. Change:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* https://*;"
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0&display=block" rel="stylesheet" />
    <title>AmbiCrew</title>
  </head>
  <body class="overflow-hidden">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create global.d.ts for window.electron types**

```typescript
// desktop/src/types/global.d.ts
interface ElectronAPI {
  platform: string
  auth: {
    getStatus: () => Promise<{ ok: boolean; status?: { loggedIn: boolean; displayName?: string }; error?: string }>
    login: () => Promise<{ ok: boolean; authorizeUrl?: string; error?: string }>
    logout: () => Promise<{ ok: boolean; error?: string }>
    onStatusChanged: (callback: (status: { loggedIn: boolean; displayName?: string }) => void) => () => void
  }
  shell: {
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
    showOpenDialog: (opts: { properties?: string[] }) => Promise<{ ok: boolean; canceled?: boolean; filePaths?: string[] }>
    getAppVersion: () => Promise<{ ok: boolean; version?: string }>
  }
  model: {
    list: () => Promise<{ ok: boolean; models?: Array<{ id: string; name: string; description: string; context: string }>; error?: string }>
    setActive: (id: string) => Promise<{ ok: boolean; error?: string }>
  }
  skills: {
    list: () => Promise<{ ok: boolean; skills?: unknown[]; error?: string }>
    setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
    listHub: () => Promise<{ ok: boolean; items?: unknown[]; error?: string }>
    download: (slug: string, version: string) => Promise<{ ok: boolean; error?: string }>
    delete: (id: string) => Promise<{ ok: boolean; error?: string }>
  }
  server: {
    getBaseUrl: () => Promise<{ ok: boolean; baseUrl?: string; error?: string }>
  }
}

interface Window {
  electron?: ElectronAPI
}
```

- [ ] **Step 4: Commit**

```bash
git add desktop/vite.config.ts desktop/index.html desktop/src/types/global.d.ts
git commit -m "chore: update Vite config, CSP, and add Electron type declarations"
```

---

## Phase 3: Auth Integration

### Task 14: Create tokenStore for Electron

**Files:**
- Create: `desktop/electron/auth/tokenStore.ts`

- [ ] **Step 1: Create tokenStore.ts**

```typescript
// desktop/electron/auth/tokenStore.ts
import { kvGet, kvSet, kvDelete } from '../db/database.js'

const KEY_TOKEN = 'auth.token'
const KEY_DISPLAY_NAME = 'auth.displayName'

interface TokenPayload {
  access_token: string
  refresh_token: string
  display_name?: string
}

export function saveTokens(payload: TokenPayload): void {
  kvSet(KEY_TOKEN, JSON.stringify({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  }))
  if (payload.display_name) {
    kvSet(KEY_DISPLAY_NAME, payload.display_name)
  }
}

export function loadTokens(): TokenPayload | null {
  const raw = kvGet(KEY_TOKEN)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { access_token: string; refresh_token: string }
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      display_name: kvGet(KEY_DISPLAY_NAME) || undefined,
    }
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return loadTokens()?.access_token ?? null
}

export function getRefreshToken(): string | null {
  return loadTokens()?.refresh_token ?? null
}

export function getDisplayName(): string | null {
  return kvGet(KEY_DISPLAY_NAME)
}

export function clearTokens(): void {
  kvDelete(KEY_TOKEN)
  kvDelete(KEY_DISPLAY_NAME)
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/auth/tokenStore.ts
git commit -m "feat: add token store for Electron (SQLite-backed)"
```

---

### Task 15: Create authController

**Files:**
- Create: `desktop/electron/auth/authController.ts`

- [ ] **Step 1: Create authController.ts**

```typescript
// desktop/electron/auth/authController.ts
import { loadTokens, saveTokens, clearTokens, getAccessToken, getRefreshToken } from './tokenStore.js'
import { getDeviceInfo, appendDeviceToLoginUrl } from './deviceManager.js'

type AuthState = 'logged_out' | 'logging_in' | 'logged_in' | 'expired' | 'logging_out'

interface AuthStatus {
  state: AuthState
  loggedIn: boolean
  displayName?: string
}

type StatusCallback = (status: AuthStatus) => void

function getLoginUrl(): string {
  return process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:5173/woicrew/auth/login?client_label=AmbiCode&device_label=win32'
}

function deriveApiBase(): string {
  if (process.env.AUTH_SERVER_BASE_URL) {
    return process.env.AUTH_SERVER_BASE_URL.replace(/\/+$/, '')
  }
  try {
    const url = new URL(getLoginUrl())
    const parts = url.pathname.split('/auth/')
    return `${url.origin}${parts[0] || ''}`
  } catch {
    return 'http://127.0.0.1:5173/woicrew'
  }
}

export class AuthController {
  private state: AuthState = 'logged_out'
  private displayName: string | undefined
  private listeners: Set<StatusCallback> = new Set()

  private emit() {
    const status: AuthStatus = {
      state: this.state,
      loggedIn: this.state === 'logged_in',
      displayName: this.displayName,
    }
    for (const cb of this.listeners) cb(status)
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getStatus(): AuthStatus {
    return {
      state: this.state,
      loggedIn: this.state === 'logged_in',
      displayName: this.displayName,
    }
  }

  async tryRestoreSession(): Promise<boolean> {
    const tokens = loadTokens()
    if (!tokens?.access_token) return false

    try {
      const base = deriveApiBase()
      const res = await fetch(`${base}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (res.ok) {
        const json = await res.json() as { data?: { displayName?: string } }
        this.displayName = json.data?.displayName || tokens.display_name
        this.state = 'logged_in'
        this.emit()
        return true
      }
      // Try refresh
      if (tokens.refresh_token) {
        const refreshed = await this.tryRefreshToken()
        if (refreshed) return true
      }
    } catch {
      // Fall through to expire
    }
    return false
  }

  async tryRefreshToken(): Promise<boolean> {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return false

    try {
      const base = deriveApiBase()
      const res = await fetch(`${base}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return false
      const json = await res.json() as { rc?: number; data?: { access_token?: string; refresh_token?: string } }
      if (json.rc !== 0 || !json.data?.access_token || !json.data?.refresh_token) return false
      saveTokens({
        access_token: json.data.access_token,
        refresh_token: json.data.refresh_token,
      })
      this.state = 'logged_in'
      this.emit()
      return true
    } catch {
      return false
    }
  }

  async login(): Promise<string> {
    this.state = 'logging_in'
    this.emit()

    const deviceInfo = await getDeviceInfo()
    let loginUrl = appendDeviceToLoginUrl(getLoginUrl(), deviceInfo)
    loginUrl = `${loginUrl}&redirect_scheme=ambicrew`

    // Return the URL for the renderer to open in external browser
    return loginUrl
  }

  async completeLogin(accessToken: string, refreshToken: string, displayName?: string): Promise<void> {
    saveTokens({ access_token: accessToken, refresh_token: refreshToken, display_name: displayName })
    this.displayName = displayName
    this.state = 'logged_in'
    this.emit()
  }

  async logout(): Promise<void> {
    this.state = 'logging_out'
    this.emit()
    clearTokens()
    this.displayName = undefined
    this.state = 'logged_out'
    this.emit()
  }

  expire(): void {
    this.state = 'expired'
    this.emit()
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/auth/authController.ts
git commit -m "feat: add auth controller with state machine and token refresh"
```

---

### Task 16: Create callbackServer and deviceManager

**Files:**
- Create: `desktop/electron/auth/callbackServer.ts`
- Create: `desktop/electron/auth/deviceManager.ts`

- [ ] **Step 1: Create deviceManager.ts**

```typescript
// desktop/electron/auth/deviceManager.ts
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { kvGet, kvSet } from '../db/database.js'

export interface DeviceInfo {
  device_uuid: string
  mac_address: string
  os_version: string
  client_version: string
  platform: string
}

let cachedDeviceInfo: DeviceInfo | null = null

function getMacAddress(): string {
  try {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac
        }
      }
    }
  } catch { /* ignore */ }
  return ''
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (cachedDeviceInfo) return cachedDeviceInfo

  let uuid = kvGet('device_uuid')
  if (!uuid) {
    uuid = randomUUID()
    kvSet('device_uuid', uuid)
  }

  cachedDeviceInfo = {
    device_uuid: uuid,
    mac_address: getMacAddress(),
    os_version: `${os.type()} ${os.release()}`,
    client_version: process.env.npm_package_version || '',
    platform: process.platform,
  }
  return cachedDeviceInfo
}

export function appendDeviceToLoginUrl(url: string, info: DeviceInfo): string {
  const u = new URL(url)
  u.searchParams.set('device_uuid', info.device_uuid)
  u.searchParams.set('mac_address', info.mac_address)
  u.searchParams.set('os_version', info.os_version)
  u.searchParams.set('client_version', info.client_version)
  u.searchParams.set('platform', info.platform)
  return u.toString()
}

// ---- Device Heartbeat ----

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function deriveApiBase(): string {
  const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:5173/woicrew/auth/login'
  try {
    const url = new URL(loginUrl)
    const parts = url.pathname.split('/auth/')
    return `${url.origin}${parts[0] || ''}`
  } catch {
    return 'http://127.0.0.1:5173/woicrew'
  }
}

export function startDeviceHeartbeat(options: {
  getAccessToken: () => string | null
  onTokenRefresh: () => Promise<boolean>
  onExpire: () => void
  onReboot: () => void
}): () => void {
  let registered = false
  let consecutive401 = 0
  let postLoginGrace = true
  setTimeout(() => { postLoginGrace = false }, 15_000)

  const base = deriveApiBase()

  async function sendHeartbeat() {
    const info = await getDeviceInfo()
    const token = options.getAccessToken()
    if (!token) return

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    if (!registered) {
      try {
        await fetch(`${base}/api/v1/devices/register`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            device_uuid: info.device_uuid,
            name: os.hostname(),
            mac: info.mac_address,
            os_version: info.os_version,
            client_version: info.client_version,
            hardware: os.arch(),
          }),
        })
        registered = true
      } catch { /* retry next time */ }
    }

    try {
      const res = await fetch(`${base}/api/v1/devices/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          device_uuid: info.device_uuid,
          mac_address: info.mac_address,
        }),
      })

      if (res.status === 401) {
        consecutive401++
        if (consecutive401 >= 3) {
          options.onExpire()
          return
        }
        await options.onTokenRefresh()
        return
      }

      consecutive401 = 0

      if (res.status === 403 && !postLoginGrace) {
        const json = await res.json().catch(() => ({})) as { rc?: number }
        if (json.rc === 40301 || json.rc === 40302) {
          options.onExpire()
          return
        }
      }

      if (res.ok) {
        const json = await res.json() as { commands?: Array<{ type: string }> }
        if (json.commands) {
          for (const cmd of json.commands) {
            if (cmd.type === 'reboot') {
              options.onReboot()
            }
          }
        }
      }
    } catch { /* network error, retry next cycle */ }
  }

  sendHeartbeat() // First immediate call
  heartbeatTimer = setInterval(sendHeartbeat, 15_000)

  return () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}
```

- [ ] **Step 2: Create callbackServer.ts**

```typescript
// desktop/electron/auth/callbackServer.ts
import http from 'node:http'

const CALLBACK_PORT = parseInt(process.env.AUTH_CALLBACK_PORT || '43123', 10)

export class CallbackServer {
  private server: http.Server | null = null
  private resolveAuth: ((params: URLSearchParams) => void) | null = null

  start(): Promise<URLSearchParams> {
    return new Promise((resolve) => {
      this.resolveAuth = resolve

      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${CALLBACK_PORT}`)
        if (url.pathname === '/callback') {
          const params = url.searchParams
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Login successful</h1><p>You may close this window.</p></body></html>')
          if (this.resolveAuth) {
            this.resolveAuth(params)
            this.resolveAuth = null
          }
        } else {
          res.writeHead(404)
          res.end('Not Found')
        }
      })

      this.server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        console.log(`[callback] Server listening on 127.0.0.1:${CALLBACK_PORT}`)
      })
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/auth/deviceManager.ts desktop/electron/auth/callbackServer.ts
git commit -m "feat: add device manager (heartbeat) and OAuth callback server"
```

---

### Task 17: Create auth IPC handlers

**Files:**
- Create: `desktop/electron/ipc/authIpc.ts`

- [ ] **Step 1: Create authIpc.ts**

```typescript
// desktop/electron/ipc/authIpc.ts
import { BrowserWindow } from 'electron'
import { registerWhitelistedInvoke } from './ipcRegistry.js'
import { AuthController } from '../auth/authController.js'
import { CallbackServer } from '../auth/callbackServer.js'
import { shell } from 'electron'

let authController: AuthController | null = null
let callbackServer: CallbackServer | null = null

export function getAuthController(): AuthController {
  if (!authController) throw new Error('AuthController not initialized')
  return authController
}

export function registerAuthIpc(options: {
  controller: AuthController
  callbackSrv: CallbackServer
}) {
  authController = options.controller
  callbackServer = options.callbackSrv

  registerWhitelistedInvoke('auth:getStatus', async () => {
    return { ok: true, status: authController!.getStatus() }
  })

  registerWhitelistedInvoke('auth:login', async () => {
    // 1. Start the callback server to receive OAuth redirect
    const callbackPromise = callbackServer!.start()

    // 2. Get login URL with device info
    const loginUrl = await authController!.login()

    // 3. Open browser
    await shell.openExternal(loginUrl)

    // 4. Wait for callback (with timeout)
    const TIMEOUT_MS = 180_000
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Login timed out after 3 minutes')), TIMEOUT_MS)
    )

    try {
      const params = await Promise.race([callbackPromise, timeout])
      const accessToken = params.get('access_token')?.trim()
      const refreshToken = params.get('refresh_token')?.trim()
      const displayName = params.get('display_name')?.trim()

      if (!accessToken || !refreshToken) {
        return { ok: false, error: 'Missing tokens in callback' }
      }

      await authController!.completeLogin(accessToken, refreshToken, displayName)

      // Notify renderer
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('auth:onStatusChanged', authController!.getStatus())

      return { ok: true, status: authController!.getStatus() }
    } catch (err) {
      callbackServer!.stop()
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerWhitelistedInvoke('auth:logout', async () => {
    await authController!.logout()
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('auth:onStatusChanged', authController!.getStatus())
    return { ok: true }
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/ipc/authIpc.ts
git commit -m "feat: add auth IPC handlers with OAuth callback flow"
```

---

### Task 18: Wire up auth in main.ts

**Files:**
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Update main.ts to include auth initialization**

Add to the `app.whenReady()` section after `setAppMenu()`, before `createWindow()`:

```typescript
// ... existing imports ...
import { AuthController } from './auth/authController.js'
import { CallbackServer } from './auth/callbackServer.js'
import { startDeviceHeartbeat } from './auth/deviceManager.js'
import { getAccessToken } from './auth/tokenStore.js'
import { registerAuthIpc } from './ipc/authIpc.js'

// In app.whenReady():
  const authController = new AuthController()
  const callbackSrv = new CallbackServer()
  registerAuthIpc({ controller: authController, callbackSrv: callbackSrv })

  // Try restore session
  const restored = await authController.tryRestoreSession()

  // Start device heartbeat if logged in
  if (restored) {
    startDeviceHeartbeat({
      getAccessToken: () => getAccessToken(),
      onTokenRefresh: () => authController.tryRefreshToken(),
      onExpire: () => authController.expire(),
      onReboot: () => {
        app.relaunch()
        app.exit(0)
      },
    })
  }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/main.ts
git commit -m "feat: wire auth controller, callback server, and device heartbeat into main"
```

---

### Task 19: Adapt centralOAuthStore for Electron

**Files:**
- Modify: `desktop/src/stores/centralOAuthStore.ts`

- [ ] **Step 1: Rewrite centralOAuthStore to use Electron preload for login/logout**

```typescript
// desktop/src/stores/centralOAuthStore.ts
import { create } from 'zustand'

type CentralOAuthStatus = {
  loggedIn: boolean
  displayName?: string
}

type CentralOAuthState = {
  status: CentralOAuthStatus | null
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  login: () => Promise<{ authorizeUrl: string }>
  logout: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

const isElectron = typeof window !== 'undefined' && 'electron' in window

function getElectronAPI() {
  return (window as unknown as { electron: NonNullable<Window['electron']> }).electron!
}

export const useCentralOAuthStore = create<CentralOAuthState>((set, get) => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  return {
    status: null,
    isLoading: false,
    error: null,

    fetchStatus: async () => {
      if (isElectron) {
        try {
          const result = await getElectronAPI().auth.getStatus()
          if (result.ok && result.status) {
            set({ status: result.status, error: null })
          } else {
            set({ error: result.error || 'Failed to get status' })
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) })
        }
      } else {
        // Fallback: fetch from server API
        try {
          const resp = await fetch('/api/central-oauth')
          const status = await resp.json() as CentralOAuthStatus
          set({ status, error: null })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) })
        }
      }
    },

    login: async () => {
      set({ isLoading: true, error: null })
      if (isElectron) {
        try {
          const result = await getElectronAPI().auth.login()
          if (result.ok && result.status) {
            set({ isLoading: false, status: result.status })
            return { authorizeUrl: '' } // Electron handles browser opening
          }
          set({ isLoading: false, error: result.error || 'Login failed' })
          throw new Error(result.error || 'Login failed')
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      } else {
        // Fallback: use server API for OAuth
        set({ isLoading: true, error: null })
        try {
          const resp = await fetch('/api/central-oauth/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverPort: 43124 }),
          })
          const data = await resp.json() as { authorizeUrl?: string; error?: string }
          if (data.error) throw new Error(data.error)
          set({ isLoading: false })
          return { authorizeUrl: data.authorizeUrl! }
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      }
    },

    logout: async () => {
      get().stopPolling()
      set({ isLoading: true })
      if (isElectron) {
        try {
          const result = await getElectronAPI().auth.logout()
          if (result.ok) {
            set({ status: { loggedIn: false }, isLoading: false })
          } else {
            set({ isLoading: false, error: result.error || 'Logout failed' })
          }
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } else {
        try {
          await fetch('/api/central-oauth', { method: 'DELETE' })
          set({ status: { loggedIn: false }, isLoading: false })
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },

    startPolling: () => {
      if (pollTimer) return
      // Electron mode doesn't need polling (callback server handles it)
      if (isElectron) return
      // Server mode: poll for status
      const poll = async () => {
        await get().fetchStatus()
        if (get().status?.loggedIn) return
        pollTimer = setTimeout(poll, 2000)
      }
      poll()
    },

    stopPolling: () => {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
    },
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/stores/centralOAuthStore.ts
git commit -m "refactor: adapt centralOAuthStore for Electron preload API"
```

---

## Phase 4: Sidebar Username

### Task 20: Replace GitHub link with username

**Files:**
- Modify: `desktop/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Replace GitHub link section (lines 147-157) with username display**

In `Sidebar.tsx`, add import for `useCentralOAuthStore`:

```typescript
import { useCentralOAuthStore } from '../../stores/centralOAuthStore'
```

In the component body, add:

```typescript
const centralStatus = useCentralOAuthStore((s) => s.status)
const isCentralLoggedIn = centralStatus?.loggedIn
const centralDisplayName = centralStatus?.displayName
```

Replace the GitHub anchor element (lines 146-157):

```tsx
{/* Before (lines 146-157): GitHub link */}
{/* After: */}
<div className={`flex items-center ${sidebarOpen ? 'gap-1.5' : 'flex-col gap-2'}`}>
  {isCentralLoggedIn ? (
    <span
      className={`sidebar-copy ${sidebarOpen ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} text-xs text-[var(--color-text-secondary)]`}
      title={centralDisplayName}
    >
      {centralDisplayName || 'CrewCentral'}
    </span>
  ) : (
    <button
      type="button"
      onClick={() => useUIStore.getState().setPendingSettingsTab('providers')}
      className={`sidebar-copy ${sidebarOpen ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors`}
    >
      登录
    </button>
  )}
  <button
    type="button"
    onClick={toggleSidebar}
    // ... (existing toggle button remains the same)
  >
```

- [ ] **Step 2: Remove GitHubIcon function (lines 458-464)**

Delete the `GitHubIcon` function component.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/layout/Sidebar.tsx
git commit -m "feat: replace GitHub link with CrewCentral username in sidebar"
```

---

## Phase 5: Skill Management

### Task 21: Create skillRoots

**Files:**
- Create: `desktop/electron/skills/skillRoots.ts`

- [ ] **Step 1: Create skillRoots.ts**

```typescript
// desktop/electron/skills/skillRoots.ts
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

export type SkillSource = 'user' | 'claude' | 'bundled'

export interface SkillRoot {
  kind: SkillSource
  path: string
}

export function getSkillRoots(): SkillRoot[] {
  const roots: SkillRoot[] = []

  // 1. User root (writable, primary) — {userData}/SKILLs
  roots.push({
    kind: 'user',
    path: path.join(app.getPath('userData'), 'SKILLs'),
  })

  // 2. Claude shared root — ~/.claude/skills (if exists)
  const claudeSkills = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'skills')
  if (fs.existsSync(claudeSkills)) {
    roots.push({ kind: 'claude', path: claudeSkills })
  }

  // 3. Bundled root
  if (app.isPackaged) {
    roots.push({
      kind: 'bundled',
      path: path.join(process.resourcesPath, 'SKILLs'),
    })
  } else {
    roots.push({
      kind: 'bundled',
      path: path.join(app.getAppPath(), '..', 'SKILLs'),
    })
  }

  return roots
}

export function syncBundledSkillsToUserData(): void {
  const roots = getSkillRoots()
  const bundledRoot = roots.find((r) => r.kind === 'bundled')
  const userRoot = roots.find((r) => r.kind === 'user')
  if (!bundledRoot || !userRoot || !fs.existsSync(bundledRoot.path)) return

  if (!fs.existsSync(userRoot.path)) {
    fs.mkdirSync(userRoot.path, { recursive: true })
  }

  // Copy bundled skill directories that don't exist in user root
  const entries = fs.readdirSync(bundledRoot.path, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dest = path.join(userRoot.path, entry.name)
    if (fs.existsSync(dest)) continue
    copyDirSync(path.join(bundledRoot.path, entry.name), dest)
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/skills/skillRoots.ts
git commit -m "feat: add skill roots manager (user/claude/bundled)"
```

---

### Task 22: Create skillHubClient

**Files:**
- Create: `desktop/electron/skills/skillHubClient.ts`

- [ ] **Step 1: Create skillHubClient.ts**

```typescript
// desktop/electron/skills/skillHubClient.ts
export interface HubSkillItem {
  slug: string
  name: string
  version: string
  description?: string
  package_hash?: string
}

export interface DeviceManifestSkill {
  skill_slug: string
  name: string
  version: string
  description?: string
  package_hash?: string
  config?: Record<string, unknown>
}

function getSkillHubBaseUrl(): string {
  if (process.env.SKILL_HUB_BASE_URL) {
    return process.env.SKILL_HUB_BASE_URL.replace(/\/+$/, '')
  }
  return 'http://127.0.0.1:5173/woicrew'
}

export async function fetchPublicManifest(signal?: AbortSignal): Promise<HubSkillItem[]> {
  const base = getSkillHubBaseUrl()
  const url = `${base}/index.json`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Hub manifest HTTP ${res.status}`)
  const json = await res.json() as { items?: HubSkillItem[] }
  return json.items || []
}

export async function fetchDeviceManifest(
  accessToken: string,
  deviceUuid: string,
  platform: string,
  signal?: AbortSignal,
): Promise<DeviceManifestSkill[]> {
  const base = getSkillHubBaseUrl()
  const url = `${base}/api/v1/skills/manifest?device_uuid=${encodeURIComponent(deviceUuid)}&platform=${encodeURIComponent(platform)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (!res.ok) throw new Error(`Device manifest HTTP ${res.status}`)
  const json = await res.json() as { data?: DeviceManifestSkill[] }
  return json.data || []
}

export async function fetchSkillDownloadToken(
  slug: string,
  accessToken: string,
): Promise<string> {
  const base = getSkillHubBaseUrl()
  const url = `${base}/api/v1/skills/${encodeURIComponent(slug)}/download-token`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Download token HTTP ${res.status}`)
  const json = await res.json() as { data?: { token?: string } }
  if (!json.data?.token) throw new Error('No download token in response')
  return json.data.token
}

export async function downloadSkillZip(token: string): Promise<ArrayBuffer> {
  const base = getSkillHubBaseUrl()
  const url = `${base}/api/v1/skills/download?token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Skill download HTTP ${res.status}`)
  return res.arrayBuffer()
}

export async function downloadPublicSkillZip(slug: string, version: string): Promise<ArrayBuffer> {
  const base = getSkillHubBaseUrl()
  const url = `${base}/skills/packages/${encodeURIComponent(slug)}/${encodeURIComponent(version)}.zip`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Public download HTTP ${res.status}`)
  return res.arrayBuffer()
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/skills/skillHubClient.ts
git commit -m "feat: add skill hub client for CrewCentral integration"
```

---

### Task 23: Create skillManager

**Files:**
- Create: `desktop/electron/skills/skillManager.ts`

- [ ] **Step 1: Create skillManager.ts**

```typescript
// desktop/electron/skills/skillManager.ts
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getSkillRoots, syncBundledSkillsToUserData, type SkillSource } from './skillRoots.js'
import {
  fetchDeviceManifest,
  fetchSkillDownloadToken,
  downloadSkillZip,
  type DeviceManifestSkill,
} from './skillHubClient.js'
import { kvGet, kvSet, kvDelete } from '../db/database.js'

export interface SkillListItem {
  id: string
  name: string
  description: string
  version?: string
  source: SkillSource
  enabled: boolean
  fromHub: boolean
}

interface SkillsConfig {
  version: number
  skills: Record<string, { enabled?: boolean; order?: number }>
}

function parseFrontmatter(content: string): { name?: string; description?: string; version?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)/)
    if (kv) result[kv[1]!] = kv[2]!.trim()
  }
  return result
}

export class SkillManager {
  private getAccessToken: () => string | null

  constructor(getAccessToken: () => string | null) {
    this.getAccessToken = getAccessToken
  }

  async startup(): Promise<void> {
    syncBundledSkillsToUserData()
  }

  listSkills(): SkillListItem[] {
    const roots = getSkillRoots()
    const config = this.loadConfig()
    const hubIds = this.getHubInstalledIds()
    const result: SkillListItem[] = []

    for (const root of roots) {
      if (!fs.existsSync(root.path)) continue
      const entries = fs.readdirSync(root.path, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillMdPath = path.join(root.path, entry.name, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const fm = parseFrontmatter(content)

        const cfg = config.skills[entry.name] || {}
        result.push({
          id: entry.name,
          name: fm.name || entry.name,
          description: fm.description || '',
          version: fm.version,
          source: root.kind,
          enabled: cfg.enabled !== false, // enabled by default
          fromHub: hubIds.has(entry.name),
        })
      }
    }

    // Deduplicate by id, preferring user root over claude over bundled
    const seen = new Map<string, SkillListItem>()
    const priority: Record<SkillSource, number> = { user: 3, claude: 2, bundled: 1 }
    for (const skill of result) {
      const existing = seen.get(skill.id)
      if (!existing || priority[skill.source] > priority[existing.source]) {
        seen.set(skill.id, skill)
      }
    }

    return Array.from(seen.values())
  }

  setEnabled(skillId: string, enabled: boolean): void {
    const config = this.loadConfig()
    if (!config.skills[skillId]) config.skills[skillId] = {}
    config.skills[skillId]!.enabled = enabled
    this.saveConfig(config)
  }

  async installFromHub(slug: string, version: string): Promise<void> {
    const token = this.getAccessToken()
    if (!token) throw new Error('Not authenticated')

    const downloadToken = await fetchSkillDownloadToken(slug, token)
    const zipBuffer = await downloadSkillZip(downloadToken)

    // Extract to user root
    const roots = getSkillRoots()
    const userRoot = roots.find((r) => r.kind === 'user')!
    const destDir = path.join(userRoot.path, slug)

    // Simple zip extraction using Node.js (for production, use adm-zip)
    const AdmZip = await import('adm-zip')
    // Note: adm-zip needs to be added as dependency
    const zip = new AdmZip.default(Buffer.from(zipBuffer))
    zip.extractAllTo(destDir, true)

    // Mark as hub-installed
    const hubIds = this.getHubInstalledIds()
    hubIds.add(slug)
    kvSet('skills.hub_installed_ids', JSON.stringify(Array.from(hubIds)))
  }

  deleteSkill(skillId: string): void {
    const roots = getSkillRoots()
    const userRoot = roots.find((r) => r.kind === 'user')
    if (!userRoot) throw new Error('User root not found')

    const skillDir = path.join(userRoot.path, skillId)
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true })
    }

    const hubIds = this.getHubInstalledIds()
    hubIds.delete(skillId)
    kvSet('skills.hub_installed_ids', JSON.stringify(Array.from(hubIds)))
  }

  async syncFromDeviceManifest(): Promise<void> {
    const token = this.getAccessToken()
    if (!token) return

    try {
      const deviceUuid = kvGet('device_uuid') || ''
      const manifest = await fetchDeviceManifest(token, deviceUuid, process.platform)

      // Check which skills need to be installed/updated
      const local = this.listSkills()
      for (const remoteSkill of manifest) {
        const localSkill = local.find((s) => s.id === remoteSkill.skill_slug)
        if (!localSkill || (localSkill.version && localSkill.version !== remoteSkill.version)) {
          try {
            await this.installFromHub(remoteSkill.skill_slug, remoteSkill.version)
          } catch (err) {
            console.error(`[skills] Failed to install ${remoteSkill.skill_slug}:`, err)
          }
        }
      }
    } catch (err) {
      console.error('[skills] Manifest sync failed:', err)
    }
  }

  private loadConfig(): SkillsConfig {
    const roots = getSkillRoots()
    const userRoot = roots.find((r) => r.kind === 'user')
    if (!userRoot) return { version: 1, skills: {} }

    const configPath = path.join(userRoot.path, 'skills.config.json')
    if (!fs.existsSync(configPath)) return { version: 1, skills: {} }

    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as SkillsConfig
    } catch {
      return { version: 1, skills: {} }
    }
  }

  private saveConfig(config: SkillsConfig): void {
    const roots = getSkillRoots()
    const userRoot = roots.find((r) => r.kind === 'user')
    if (!userRoot) return

    const configPath = path.join(userRoot.path, 'skills.config.json')
    const tmpPath = configPath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    fs.renameSync(tmpPath, configPath)
  }

  private getHubInstalledIds(): Set<string> {
    const raw = kvGet('skills.hub_installed_ids')
    if (!raw) return new Set()
    try {
      return new Set(JSON.parse(raw) as string[])
    } catch {
      return new Set()
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/skills/skillManager.ts
git commit -m "feat: add skill manager with discovery, install, and hub sync"
```

---

### Task 24: Create skills IPC handlers and wire into main.ts

**Files:**
- Create: `desktop/electron/ipc/skillsIpc.ts`
- Modify: `desktop/electron/main.ts`

- [ ] **Step 1: Create skillsIpc.ts**

```typescript
// desktop/electron/ipc/skillsIpc.ts
import { registerWhitelistedInvoke } from './ipcRegistry.js'
import type { SkillManager } from '../skills/skillManager.js'

let skillManager: SkillManager | null = null

export function registerSkillsIpc(manager: SkillManager) {
  skillManager = manager

  registerWhitelistedInvoke('skills:list', async () => {
    const skills = skillManager!.listSkills()
    return { ok: true, skills }
  })

  registerWhitelistedInvoke('skills:setEnabled', async (_event, id: string, enabled: boolean) => {
    skillManager!.setEnabled(id, enabled)
    return { ok: true }
  })

  registerWhitelistedInvoke('skills:listHub', async () => {
    try {
      const { fetchPublicManifest } = await import('../skills/skillHubClient.js')
      const items = await fetchPublicManifest()
      return { ok: true, items }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerWhitelistedInvoke('skills:download', async (_event, slug: string, version: string) => {
    try {
      await skillManager!.installFromHub(slug, version)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerWhitelistedInvoke('skills:delete', async (_event, id: string) => {
    try {
      skillManager!.deleteSkill(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
```

- [ ] **Step 2: Update main.ts to wire skills**

Add to the startup sequence in `main.ts`:

```typescript
import { SkillManager } from './skills/skillManager.js'
import { registerSkillsIpc } from './ipc/skillsIpc.js'

// After auth setup, before createWindow:
  const skillManager = new SkillManager(() => getAccessToken())
  await skillManager.startup()
  registerSkillsIpc(skillManager)

  // Sync skills from device manifest if logged in
  if (restored) {
    skillManager.syncFromDeviceManifest().catch((err) => {
      console.error('[main] Skill manifest sync failed:', err)
    })
  }
```

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/ipc/skillsIpc.ts desktop/electron/main.ts
git commit -m "feat: add skills IPC handlers and wire skill manager into main"
```

---

## Phase 6: Global Types & Final Cleanup

### Task 25: Update global.d.ts to include all types

**Files:**
- Modify: `desktop/src/types/global.d.ts`

- [ ] **Step 1: Verify global.d.ts is complete**

Ensure the file created in Task 13 covers all preload API methods. The types should match `desktop/electron/preload.ts`.

- [ ] **Step 2: Fix any remaining Tauri type references**

Search for remaining `@tauri-apps` imports and remove them:

```bash
rg '@tauri-apps' desktop/src/
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/types/global.d.ts
git commit -m "chore: finalize Electron type declarations and remove Tauri references"
```

---

### Task 26: Fix server-side API adaptations

**Files:**
- Modify: `desktop/electron/ipc/skillsIpc.ts` — ensure `server:getBaseUrl` is registered

- [ ] **Step 1: Add server:getBaseUrl handler to shellIpc.ts**

In `desktop/electron/ipc/shellIpc.ts`, add:

```typescript
import { getServerUrl } from '../server/serverManager.js'

// In registerShellIpc():
  registerWhitelistedInvoke('server:getBaseUrl', async () => {
    const url = getServerUrl()
    if (!url) return { ok: false, error: 'Server not ready' }
    return { ok: true, baseUrl: url }
  })
```

- [ ] **Step 2: Commit**

```bash
git add desktop/electron/ipc/shellIpc.ts
git commit -m "feat: add server:getBaseUrl IPC handler"
```

---

### Task 27: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Build Electron main process**

```bash
cd desktop && npm run build:electron
```

Expected: No TypeScript errors.

- [ ] **Step 2: Build renderer**

```bash
cd desktop && npm run build
```

Expected: Vite builds successfully, no Tauri import errors.

- [ ] **Step 3: Start Bun server**

```bash
cd .. && bun run src/server/index.ts
```

Expected: Server starts on port 43124.

- [ ] **Step 4: Start Electron app**

```bash
cd desktop && npx electron .
```

Expected: Window opens, connects to server, shows AmbiCrew UI.

- [ ] **Step 5: Verify auth flow**

Click "连接 CrewCentral" in settings → browser opens → login → tokens received.

- [ ] **Step 6: Verify username in sidebar**

After login, sidebar shows display name instead of GitHub icon.

- [ ] **Step 7: Verify skill management**

Settings → Skills tab shows installed skills. Hub listing works.

- [ ] **Step 8: Verify device heartbeat**

Check console for heartbeat logs (15s interval).

- [ ] **Step 9: Commit any fixes**

```bash
git add -A
git commit -m "fix: final adjustments from end-to-end testing"
```

---

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1: Scaffold | 1-8 | Electron deps, main.ts, preload, IPC, server manager, shell |
| 2: Remove Tauri | 9-13 | Delete src-tauri, adapt renderer, update config |
| 3: Auth | 14-19 | Token store, auth controller, callback server, device manager, auth IPC, centralOAuthStore |
| 4: Username | 20 | Replace GitHub link with username in sidebar |
| 5: Skills | 21-24 | Skill roots, hub client, skill manager, skills IPC |
| 6: Cleanup | 25-27 | Types, fixes, end-to-end verification |
