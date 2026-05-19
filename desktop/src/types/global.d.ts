interface ElectronAPI {
  platform: string
  auth: {
    getStatus: () => Promise<{ ok: boolean; status?: { loggedIn: boolean; displayName?: string }; error?: string }>
    login: () => Promise<{ ok: boolean; status?: { loggedIn: boolean; displayName?: string }; error?: string }>
    logout: () => Promise<{ ok: boolean; error?: string }>
    startHeartbeat: () => Promise<{ ok: boolean; error?: string }>
    stopHeartbeat: () => Promise<{ ok: boolean; error?: string }>
    onStatusChanged: (callback: (status: { loggedIn: boolean; displayName?: string }) => void) => () => void
  }
  shell: {
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
    showOpenDialog: (opts: { properties?: string[]; title?: string; defaultPath?: string }) => Promise<{ ok: boolean; canceled?: boolean; filePaths?: string[] }>
    getAppVersion: () => Promise<{ ok: boolean; version?: string }>
  }
  server: {
    getBaseUrl: () => Promise<{ ok: boolean; baseUrl?: string; error?: string }>
  }
  terminal: {
    spawn: (opts: { cols: number; rows: number; cwd?: string }) => Promise<{ session_id: number; shell: string; cwd: string }>
    write: (sessionId: number, data: string) => Promise<void>
    resize: (sessionId: number, cols: number, rows: number) => Promise<void>
    kill: (sessionId: number) => Promise<void>
    onOutput: (callback: (payload: { session_id: number; data: string }) => void) => () => void
    onExit: (callback: (payload: { session_id: number; code: number; signal: string | null }) => void) => () => void
  }
  notification: {
    send: (opts: { title: string; body?: string }) => Promise<boolean>
    flashFrame: () => Promise<void>
  }
  adapters: {
    restart: () => Promise<{ ok: boolean; error?: string }>
  }
}

interface Window {
  electron?: ElectronAPI
}

// Tauri module stubs — these modules are behind runtime guards and will not
// be loaded in Electron. Type stubs exist only to suppress TS2307 errors.
declare module '@tauri-apps/api/core' {
  export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
}
declare module '@tauri-apps/api/event' {
  export function listen<T = unknown>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>
}
declare module '@tauri-apps/api/window' {
  export function getCurrentWindow(): {
    startDragging: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onResized: (handler: () => void) => Promise<() => void>
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    requestUserAttention: (type: UserAttentionType) => Promise<void>
  }
  export enum UserAttentionType { Critical = 1, Informational = 2 }
}
declare module '@tauri-apps/api/app' {
  export function getVersion(): Promise<string>
}
declare module '@tauri-apps/plugin-shell' {
  export function open(path: string, options?: { cwd?: string }): Promise<void>
}
declare module '@tauri-apps/plugin-dialog' {
  export function open(options?: Record<string, unknown>): Promise<string | null>
}
declare module '@tauri-apps/plugin-notification' {
  export function isPermissionGranted(): Promise<boolean>
  export function requestPermission(): Promise<NotificationPermission>
  export function sendNotification(opts: { title: string; body?: string }): void
  export type Permission = 'granted' | 'denied' | 'default'
}
declare module '@tauri-apps/plugin-process' {
  export function relaunch(): Promise<void>
}
declare module '@tauri-apps/plugin-updater' {
  interface Update {
    version: string
    body: string | null
    download: (onEvent: (event: { event: string; data: { contentLength?: number; chunkLength: number } }) => void) => Promise<void>
    install: () => Promise<void>
    close: () => Promise<void>
  }
  export function check(options?: Record<string, unknown>): Promise<Update | null>
}
