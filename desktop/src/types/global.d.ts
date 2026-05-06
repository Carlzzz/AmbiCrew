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
