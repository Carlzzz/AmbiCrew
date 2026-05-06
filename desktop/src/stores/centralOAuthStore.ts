import { create } from 'zustand'

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
    isPolling: false,
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
