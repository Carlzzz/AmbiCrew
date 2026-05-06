import { loadTokens, saveTokens, clearTokens, getAccessToken, getRefreshToken } from './tokenStore.js'
import { getDeviceInfo, appendDeviceToLoginUrl } from './deviceManager.js'

type AuthState = 'logged_out' | 'logging_in' | 'logged_in' | 'expired' | 'logging_out'

interface AuthStatus {
  state: AuthState
  loggedIn: boolean
  displayName?: string
}

type StatusCallback = (status: AuthStatus) => void

function getLoginUrl(): string {
  return process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:1420/woicrew/auth/login?client_label=AmbiCode&device_label=win32'
}

function deriveApiBase(): string {
  if (process.env.AUTH_SERVER_BASE_URL) {
    return process.env.AUTH_SERVER_BASE_URL.replace(/\/+$/, '')
  }
  try {
    const url = new URL(getLoginUrl())
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

  async tryRestoreSession(): Promise<boolean> {
    const tokens = loadTokens()
    if (!tokens?.access_token) return false

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
      // Try refresh
      if (tokens.refresh_token) {
        const refreshed = await this.tryRefreshToken()
        if (refreshed) return true
      }
    } catch {
      // Fall through to expire
    }
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

  async login(): Promise<string> {
    this.state = 'logging_in'
    this.emit()

    const deviceInfo = await getDeviceInfo()
    let loginUrl = appendDeviceToLoginUrl(getLoginUrl(), deviceInfo)
    loginUrl = `${loginUrl}&redirect_scheme=ambicrew`

    // Return the URL for the renderer to open in external browser
    return loginUrl
  }

  async completeLogin(accessToken: string, refreshToken: string, displayName?: string): Promise<void> {
    saveTokens({ access_token: accessToken, refresh_token: refreshToken, display_name: displayName })
    this.displayName = displayName
    this.state = 'logged_in'
    this.emit()
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
