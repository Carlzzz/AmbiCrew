# AmbiCrew Electron Migration Design

Date: 2026-05-06

## Overview

Convert AmbiCrew desktop from Tauri (Rust) to Electron (Node.js), add CrewCentral OAuth login integration, skill management, and device management. All patterns reference the existing TestCrew Electron project.

## Three Workstreams

### 1. GitHub Link → Username Display

**Location:** `desktop/src/components/layout/Sidebar.tsx:147-157`

- Remove `<a href="https://github.com/NanmiCoder/AmbiCrew">` and `GitHubIcon` component
- Read `status.displayName` from `useCentralOAuthStore`
- Logged in: show display name, click opens settings
- Not logged in: show "登录" entry, click triggers CrewCentral login

### 2. Tauri → Electron Conversion

**Remove:**
- `desktop/src-tauri/` (entire Rust backend)
- All `@tauri-apps/*` packages from package.json

**Add:** `desktop/electron/`
- `main.ts` — BrowserWindow creation, lifecycle, startup sequence
- `preload.ts` — contextBridge API (auth, shell, model, skills, server)
- `ipc/ipcRegistry.ts` — whitelist-based IPC handler registration
- `ipc/authIpc.ts` — auth:getStatus, auth:login, auth:logout
- `ipc/shellIpc.ts` — file dialogs, external links
- `ipc/modelIpc.ts` — model list/selection
- `ipc/skillsIpc.ts` — skill CRUD, hub integration
- `auth/authController.ts` — state machine (logged_out/logging_in/logged_in/expired)
- `auth/callbackServer.ts` — OAuth callback HTTP server (port from AUTH_CALLBACK_PORT)
- `auth/tokenStore.ts` — token persistence to ~/.claude/central-auth.json
- `auth/deviceManager.ts` — device UUID, MAC, heartbeat (15s)
- `skills/skillManager.ts` — three-root discovery, install, enable/disable, delete
- `skills/skillHubClient.ts` — CrewCentral manifest + download-token flow
- `skills/skillRoots.ts` — user/claude/bundled root management
- `server/serverManager.ts` — Bun server child process lifecycle
- `shell/appMenu.ts` — native app menu
- `shell/singleInstance.ts` — single instance lock
- `shell/updateManager.ts` — electron-updater
- `db/database.ts` — sql.js SQLite for key-value storage

**Startup sequence (main.ts, app.whenReady):**
1. Open SQLite database
2. Start Bun server child process
3. Get DeviceInfo (UUID from DB, MAC from os.networkInterfaces)
4. Restore tokens from tokenStore
5. Create AuthController
6. Create CallbackServer for OAuth
7. Create BrowserWindow with preload
8. Register all IPC handlers
9. Start device heartbeat (15s interval)
10. Create SkillManager, sync bundled skills
11. Start auto-update check

**Preload API surface (window.electron):**
- `auth`: getStatus, login, logout, onStatusChanged
- `shell`: openExternal, showOpenDialog, getAppVersion
- `model`: list, setActive
- `skills`: list, setEnabled, listHub, download, delete
- `server`: getBaseUrl
- `platform`: process.platform

**Files requiring adaptation:**
- `desktopRuntime.ts` — replace Tauri invoke with preload API
- `CrewCentralLogin.tsx` — shell.open → window.electron.shell.openExternal
- `TitleBar.tsx` — remove data-tauri-drag-region
- `AppShell.tsx` — remove Tauri event listener
- `WindowControls.tsx` — adapt for Electron
- `package.json` — swap Tauri deps for Electron deps
- `vite.config.ts` — Electron build config

### 3. Skill & Device Management

**Skills:** Three-root discovery (user/claude/bundled), CrewCentral hub integration via device manifest + download-token flow, enable/disable per skill, install/delete from hub.

**Devices:** UUID persisted in SQLite, MAC from os.networkInterfaces, 15s heartbeat to CrewCentral with 401 refresh / 403 (banned/kicked) handling, pending commands (reboot) support.

## Key Dependencies

```json
{
  "electron": "^40.3.0",
  "electron-builder": "^26.0.12",
  "electron-updater": "^6.3.0",
  "sql.js": "^1.14.1"
}
```

## Reference Projects

- TestCrew: `C:\Users\zhaocao\Documents\GitHub\TestCrew` — Electron patterns
- CrewCentral: `C:\Users\zhaocao\Documents\GitHub\CrewCentral` — Skill distribution API
- CrewProxy: `C:\Users\zhaocao\Documents\GitHub\CrewProxy` — LLM proxy gateway
