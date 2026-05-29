import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getBaseUrl } from '../api/client'
import { isDesktopRuntime } from '../lib/desktopRuntime'
import { useSettingsStore } from './settingsStore'

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

  // Subscribe to Tauri push events for auth status changes
  if (isDesktopRuntime()) {
    listen<{ logged_in: boolean; display_name?: string }>('auth:statusChanged', (event) => {
      set({
        status: { loggedIn: event.payload.logged_in, displayName: event.payload.display_name },
        error: null,
      })
      if (event.payload.logged_in) {
        void useSettingsStore.getState().fetchAll()
      }
    }).catch(() => { /* ignore if not available */ })
  }

  return {
    status: null,
    isPolling: false,
    isLoading: false,
    error: null,

    fetchStatus: async () => {
      try {
        if (isDesktopRuntime()) {
          const result = await invoke<{ logged_in: boolean; display_name?: string }>('get_auth_status')
          set({ status: { loggedIn: result.logged_in, displayName: result.display_name }, error: null })
          return
        }
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
        if (isDesktopRuntime()) {
          await invoke('login')
          // Login completion comes via deep link → auth:statusChanged event
          set({ isLoading: false })
          return
        }

        // Non-desktop: server API with HTTP redirect_uri
        const resp = await fetch(apiUrl('/api/central-oauth/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverPort: currentServerPort() }),
        })
        const data = await resp.json() as { authorizeUrl?: string; error?: string }
        if (data.error) throw new Error(data.error)

        const url = data.authorizeUrl!
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
        set({ isLoading: false })
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
        if (isDesktopRuntime()) {
          await invoke('logout')
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
        if (get().status?.loggedIn) {
          void useSettingsStore.getState().fetchAll()
          return
        }
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
