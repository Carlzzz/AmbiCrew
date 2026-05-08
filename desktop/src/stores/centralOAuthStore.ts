import { create } from 'zustand'
import { getBaseUrl } from '../api/client'

type CentralOAuthStatus = {
  loggedIn: boolean
  displayName?: string
}

type CentralOAuthState = {
  status: CentralOAuthStatus | null
  isPolling: boolean
  isLoading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

function apiUrl(path: string) {
  return `${getBaseUrl()}${path}`
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && 'electron' in window
}

function currentServerPort(): number {
  try {
    const port = new URL(getBaseUrl()).port
    const parsed = Number.parseInt(port, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch { /* fall through */ }
  return 43124
}

export const useCentralOAuthStore = create<CentralOAuthState>((set, get) => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  return {
    status: null,
    isPolling: false,
    isLoading: false,
    error: null,

    fetchStatus: async () => {
      try {
        if (isElectron()) {
          const electron = (window as unknown as {
            electron: { auth: { getStatus: () => Promise<{ ok: boolean; status?: CentralOAuthStatus }> } }
          }).electron
          const result = await electron.auth.getStatus()
          if (result.ok && result.status) {
            set({ status: result.status, error: null })
            return
          }
        }
        // Fallback: server API
        const resp = await fetch(apiUrl('/api/central-oauth'))
        const status = await resp.json() as CentralOAuthStatus
        set({ status, error: null })
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    login: async () => {
      set({ isLoading: true, error: null })
      try {
        if (isElectron()) {
          // Electron: login via IPC (uses testcrew:// protocol handler)
          const electron = (window as unknown as {
            electron: { auth: { login: () => Promise<{ ok: boolean; status?: CentralOAuthStatus; error?: string }> } }
          }).electron
          const result = await electron.auth.login()
          if (!result.ok) {
            throw new Error(result.error || 'Login failed')
          }
          set({ status: result.status || null, isLoading: false })
          return
        }

        // Non-Electron: server API with HTTP redirect_uri
        const resp = await fetch(apiUrl('/api/central-oauth/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverPort: currentServerPort() }),
        })
        const data = await resp.json() as { authorizeUrl?: string; error?: string }
        if (data.error) throw new Error(data.error)

        // Open browser
        const url = data.authorizeUrl!
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
        set({ isLoading: false })
        // Start polling for server-side login completion
        get().startPolling()
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },

    logout: async () => {
      get().stopPolling()
      set({ isLoading: true })
      try {
        if (isElectron()) {
          const electron = (window as unknown as {
            electron: { auth: { logout: () => Promise<{ ok: boolean }> } }
          }).electron
          await electron.auth.logout()
        } else {
          await fetch(apiUrl('/api/central-oauth'), { method: 'DELETE' })
        }
        set({ status: { loggedIn: false }, isLoading: false })
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },

    startPolling: () => {
      if (pollTimer) return
      set({ isPolling: true })
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
      set({ isPolling: false })
    },
  }
})
