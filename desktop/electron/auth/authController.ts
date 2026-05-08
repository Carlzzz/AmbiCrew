import { loadTokens, saveTokens, clearTokens, getAccessToken, getRefreshToken, invalidateCache } from './tokenStore.js'
import { getDeviceInfo, appendDeviceToLoginUrl } from './deviceManager.js'

type AuthState = 'logged_out' | 'logging_in' | 'logged_in' | 'expired' | 'logging_out'

interface AuthStatus {
  state: AuthState
  loggedIn: boolean
  displayName?: string
}

type StatusCallback = (status: AuthStatus) => void

export function deriveApiBase(): string {
  if (process.env.AUTH_SERVER_BASE_URL) {
    return process.env.AUTH_SERVER_BASE_URL.replace(/\/+$/, '')
  }
  try {
    const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:1420/woicrew/auth/login?client_label=AmbiCode&device_label=win32'
    const url = new URL(loginUrl)
    const parts = url.pathname.split('/auth/')
    return `${url.origin}${parts[0] || ''}`
  } catch {
    return 'http://127.0.0.1:1420/woicrew'
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

  /**
   * Check auth status from the shared token file (written by the server process).
   * Invalidates the in-memory cache first to pick up tokens written by the Bun server.
   */
  async checkServerAuthStatus(): Promise<boolean> {
    invalidateCache()
    const tokens = loadTokens()
    if (!tokens?.access_token) {
      this.state = 'logged_out'
      this.emit()
      return false
    }

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
      if (tokens.refresh_token) {
        const refreshed = await this.tryRefreshToken()
        if (refreshed) return true
      }
    } catch {
      if (this.state === 'logged_in') return true
    }

    this.state = 'logged_out'
    this.emit()
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

  /**
   * Build the login URL with redirect_scheme (not HTTP redirect_uri).
   * CrewCentral uses redirect_scheme to redirect the browser to a custom
   * protocol URL like testcrew://auth?access_token=... which the OS routes
   * back to the Electron app.
   */
  async buildLoginUrl(): Promise<string> {
    const deviceInfo = await getDeviceInfo()
    const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:1420/woicrew/auth/login?client_label=AmbiCode&device_label=win32'
    const u = new URL(loginUrl)

    // Ensure redirect_scheme is set so CrewCentral redirects to the custom protocol
    const scheme = process.env.AUTH_CALLBACK_SCHEME || 'testcrew'
    if (!u.searchParams.has('redirect_scheme')) {
      u.searchParams.set('redirect_scheme', scheme)
    }
    // Remove any HTTP redirect_uri — we use the custom protocol instead
    u.searchParams.delete('redirect_uri')

    return appendDeviceToLoginUrl(u.toString(), deviceInfo)
  }

  async completeLogin(accessToken: string, refreshToken: string, displayName?: string): Promise<void> {
    saveTokens({ access_token: accessToken, refresh_token: refreshToken, display_name: displayName })
    this.displayName = displayName
    this.state = 'logged_in'
    this.emit()

    // Fetch display name from CrewCentral API if not provided in callback
    if (!this.displayName) {
      void this.fetchDisplayNameFromApi(accessToken)
    }
  }

  private async fetchDisplayNameFromApi(accessToken: string): Promise<void> {
    try {
      const base = deriveApiBase()
      const res = await fetch(`${base}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.ok) {
        const json = await res.json() as { data?: { displayName?: string; nickname?: string } }
        const name = json.data?.displayName || json.data?.nickname
        if (name) {
          this.displayName = name
          // Update token file with display name
          saveTokens({ access_token: accessToken, refresh_token: getRefreshToken() || '', display_name: name })
          this.emit()
        }
      }
    } catch {
      // Non-critical, displayName fallback is 'CrewCentral'
    }
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
