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
