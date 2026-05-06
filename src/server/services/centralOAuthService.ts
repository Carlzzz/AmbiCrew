/**
 * CentralOAuthService — CrewCentral OAuth for desktop
 *
 * 参照 HahaOAuthService 的 polling 模式，但认证对象是 CrewCentral 而非 Anthropic。
 * CrewCentral 登录完成后直接通过 redirect URL 返回 access_token+refresh_token，
 * 无需 PKCE code exchange。
 *
 * Token 复用 src/services/central/token-store.ts 持久化到
 * ~/.claude/central-auth.json，与 CLI 模式共享同一 token 文件。
 */

import {
  getDeviceInfo,
  appendDeviceToLoginUrl,
} from '../../services/central/device-manager.js'
import {
  clearTokens,
  getAccessToken,
  getDisplayName,
  getRefreshToken,
  loadTokens,
  saveTokens,
} from '../../services/central/token-store.js'

export type CentralOAuthStatus = {
  loggedIn: boolean
  displayName?: string
}

type CentralOAuthSession = {
  serverPort: number
  createdAt: number
}

const SESSION_TTL_MS = 5 * 60 * 1000

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

export class CentralOAuthService {
  private sessions = new Map<string, CentralOAuthSession>()

  private getLoginUrl(): string {
    return process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:5173/woicrew/auth/login?client_label=AmbiCode&device_label=win32'
  }

  async startSession({ serverPort }: { serverPort: number }): Promise<{ authorizeUrl: string }> {
    const deviceInfo = await getDeviceInfo()
    const loginUrl = new URL(appendDeviceToLoginUrl(this.getLoginUrl(), deviceInfo))
    loginUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${serverPort}/callback`)

    const authorizeUrl = loginUrl.toString()
    const session: CentralOAuthSession = {
      serverPort,
      createdAt: Date.now(),
    }
    // Use a simple key for the pending session
    this.sessions.set(String(serverPort), session)
    return { authorizeUrl }
  }

  async completeCallback(params: URLSearchParams): Promise<void> {
    const accessToken = params.get('access_token')?.trim()
    const refreshToken = params.get('refresh_token')?.trim()
    const displayName = params.get('display_name')?.trim() || undefined

    if (!accessToken || !refreshToken) {
      throw new Error('Missing access_token or refresh_token in callback')
    }

    await saveTokens({
      access_token: accessToken,
      refresh_token: refreshToken,
      display_name: displayName,
    })
  }

  async getStatus(): Promise<CentralOAuthStatus> {
    const token = getAccessToken()
    if (!token) {
      return { loggedIn: false }
    }
    return {
      loggedIn: true,
      displayName: getDisplayName() || undefined,
    }
  }

  async ensureFreshAccessToken(): Promise<string | null> {
    // First try the in-memory cached token
    let token = getAccessToken()
    if (token) return token

    // Try loading from disk
    const payload = await loadTokens()
    if (payload?.access_token) return payload.access_token

    return null
  }

  async refreshToken(): Promise<string | null> {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return null

    const base = deriveApiBase(this.getLoginUrl())
    try {
      const resp = await fetch(`${base}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!resp.ok) return null
      const json = (await resp.json()) as {
        rc?: number
        data?: { access_token?: string; refresh_token?: string }
      }
      if (json.rc !== 0 || !json.data?.access_token || !json.data?.refresh_token) {
        return null
      }
      await saveTokens({
        access_token: json.data.access_token,
        refresh_token: json.data.refresh_token,
      })
      return json.data.access_token
    } catch {
      return null
    }
  }

  async deleteTokens(): Promise<void> {
    await clearTokens()
  }

  pruneExpiredSessions(): void {
    const now = Date.now()
    for (const [key, s] of this.sessions.entries()) {
      if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(key)
    }
  }
}

export const centralOAuthService = new CentralOAuthService()
