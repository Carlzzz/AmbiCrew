import { startCallbackServer, waitForCentralAuthTokens } from './auth-bridge.js'
import { startDeviceHeartbeat, appendDeviceToLoginUrl, getDeviceInfo } from './device-manager.js'
import {
  clearTokens,
  getAccessToken,
  getDisplayName,
  getRefreshToken,
  loadTokens,
  saveTokens,
  type CentralAuthTokens,
} from './token-store.js'

export type AuthStatus = 'logged_out' | 'logging_in' | 'logged_in' | 'expired'

export interface AuthState {
  status: AuthStatus
  displayName?: string
  errorMessage?: string
}

type Deps = {
  openExternal: (url: string) => Promise<void>
  loginUrl: string
}

function deriveApiBase(_loginUrl: string): string {
  // AUTH_SERVER_BASE_URL takes priority
  if (process.env.AUTH_SERVER_BASE_URL) {
    return process.env.AUTH_SERVER_BASE_URL.replace(/\/+$/, '')
  }
  try {
    const u = new URL(_loginUrl)
    const parts = u.pathname.split('/auth/')
    const basePath = parts[0] || ''
    return `${u.origin}${basePath}`
  } catch {
    return 'http://127.0.0.1:5173/woicrew'
  }
}

async function fetchUserProfile(accessToken: string, loginUrl: string): Promise<{ displayName: string }> {
  const base = deriveApiBase(loginUrl)
  const resp = await fetch(`${base}/api/v1/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) {
    throw new Error(`fetchUserProfile: ${resp.status}`)
  }
  const json = (await resp.json()) as { rc?: number; data?: Record<string, unknown> }
  const d = json.data
  if (!d) throw new Error('fetchUserProfile: no data in response')
  return {
    displayName: String(d.display_name ?? d.email ?? ''),
  }
}

let state: AuthState = { status: 'logged_out' }
const listeners = new Set<(s: AuthState) => void>()
let stopHeartbeat: (() => void) | null = null

function startHeartbeatIfNeeded(): void {
  if (stopHeartbeat) return
  const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || ''
  if (!loginUrl) return
  stopHeartbeat = startDeviceHeartbeat({
    getAccessToken,
    getLoginUrl: () => loginUrl,
    onExpire: async (message) => {
      await clearTokens()
      update({ status: 'expired', errorMessage: message })
      update({ status: 'logged_out' })
    },
    tryRefreshToken: () => tryRefreshToken(),
  })
}

/**
 * Self-healing hook for the heartbeat. The token-refresh timer calls this on
 * every tick: if we still hold a valid token but the heartbeat is not running
 * (e.g. it was stopped by a transient onExpire, or never started because the
 * process didn't restore a session), restart it. Without this the process can
 * get stuck "logged in, token refreshing, but never sending heartbeats" — which
 * makes the device show offline in CrewCentral indefinitely.
 */
export function ensureHeartbeatRunning(): void {
  if (stopHeartbeat) return
  if (!getAccessToken()) return
  if (state.status !== 'logged_in') {
    state = { status: 'logged_in', displayName: getDisplayName() || '已登录' }
  }
  startHeartbeatIfNeeded()
}

function stopHeartbeatIfRunning(): void {
  if (stopHeartbeat) {
    stopHeartbeat()
    stopHeartbeat = null
  }
}

function update(next: AuthState): void {
  state = next
  if (next.status === 'logged_in') {
    startHeartbeatIfNeeded()
  } else if (next.status === 'logged_out' || next.status === 'expired') {
    stopHeartbeatIfRunning()
  }
  listeners.forEach((fn) => fn(state))
}

export function getAuthState(): AuthState {
  return state
}

export function onAuthStateChanged(listener: (s: AuthState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || ''
  const base = deriveApiBase(loginUrl)

  try {
    const resp = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!resp.ok) return false
    const json = (await resp.json()) as {
      rc?: number
      data?: { access_token?: string; refresh_token?: string }
    }
    if (json.rc !== 0 || !json.data?.access_token || !json.data?.refresh_token) {
      return false
    }
    await saveTokens({
      access_token: json.data.access_token,
      refresh_token: json.data.refresh_token,
    })
    return true
  } catch {
    return false
  }
}

export async function tryRestoreSession(): Promise<boolean> {
  const payload = await loadTokens()
  if (!payload) return false

  const displayName = payload.display_name || '已登录'
  update({ status: 'logged_in', displayName })

  // Verify in background
  const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || ''
  fetchUserProfile(payload.access_token, loginUrl)
    .then(async (profile) => {
      if (payload.display_name !== profile.displayName) {
        await saveTokens({ ...payload, display_name: profile.displayName })
      }
      update({ status: 'logged_in', displayName: profile.displayName })
    })
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (
        /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|fetch failed)\b/i.test(
          msg,
        )
      ) {
        // Network unreachable — keep local session
        return
      }
      if (/\b(401|403)\b/.test(msg)) {
        const refreshed = await tryRefreshToken()
        if (refreshed) {
          const newToken = getAccessToken()
          if (newToken) {
            try {
              const profile = await fetchUserProfile(newToken, loginUrl)
              update({ status: 'logged_in', displayName: profile.displayName })
              return
            } catch {
              // fall through to expire
            }
          }
        }
        await clearTokens()
        update({ status: 'expired', errorMessage: '登录状态已失效，请重新登录' })
        update({ status: 'logged_out' })
        return
      }
      // Inconclusive — keep local session
    })

  return true
}

export async function login(deps: Deps): Promise<AuthState> {
  update({ status: 'logging_in' })
  try {
    const callbackUrl = await startCallbackServer()
    const deviceInfo = await getDeviceInfo()
    const loginUrl = new URL(appendDeviceToLoginUrl(deps.loginUrl, deviceInfo))
    loginUrl.searchParams.set('redirect_uri', callbackUrl)

    const tokensPromise = waitForCentralAuthTokens(180_000, async () => {
      await deps.openExternal(loginUrl.toString())
    })

    const tokens = await tokensPromise
    await saveTokens(tokens)

    let displayName = tokens.display_name
    if (!displayName) {
      try {
        const profile = await fetchUserProfile(tokens.access_token, deps.loginUrl)
        displayName = profile.displayName
      } catch {
        // use fallback below
      }
    }

    const name = displayName || '已登录'
    update({ status: 'logged_in', displayName: name })
    return state
  } catch (error) {
    const message = error instanceof Error ? error.message : '登录失败'
    update({ status: 'logged_out', errorMessage: message })
    throw error
  }
}

export async function logout(): Promise<void> {
  await clearTokens()
  update({ status: 'logged_out' })
}
