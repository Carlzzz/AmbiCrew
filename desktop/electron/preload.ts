import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,

  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    startHeartbeat: () => ipcRenderer.invoke('auth:startHeartbeat'),
    stopHeartbeat: () => ipcRenderer.invoke('auth:stopHeartbeat'),
    onStatusChanged: (callback: (status: { loggedIn: boolean; displayName?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: { loggedIn: boolean; displayName?: string }) => callback(status)
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

  server: {
    getBaseUrl: () => ipcRenderer.invoke('server:getBaseUrl'),
  },

  terminal: {
    spawn: (opts: { cols: number; rows: number; cwd?: string }) =>
      ipcRenderer.invoke('terminal:spawn', opts),
    write: (sessionId: number, data: string) =>
      ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId: number, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    kill: (sessionId: number) =>
      ipcRenderer.invoke('terminal:kill', sessionId),
    onOutput: (callback: (payload: { session_id: number; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { session_id: number; data: string }) => callback(payload)
      ipcRenderer.on('terminal:output', handler)
      return () => ipcRenderer.removeListener('terminal:output', handler)
    },
    onExit: (callback: (payload: { session_id: number; code: number; signal: string | null }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { session_id: number; code: number; signal: string | null }) => callback(payload)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
  },

  notification: {
    send: (opts: { title: string; body?: string }) =>
      ipcRenderer.invoke('notification:send', opts),
    flashFrame: () =>
      ipcRenderer.invoke('notification:flashFrame'),
  },

  adapters: {
    restart: () => ipcRenderer.invoke('adapters:restart'),
  },
})
