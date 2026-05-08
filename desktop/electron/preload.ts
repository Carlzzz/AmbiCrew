import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,

  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    startHeartbeat: () => ipcRenderer.invoke('auth:startHeartbeat'),
    stopHeartbeat: () => ipcRenderer.invoke('auth:stopHeartbeat'),
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

  server: {
    getBaseUrl: () => ipcRenderer.invoke('server:getBaseUrl'),
  },
})
