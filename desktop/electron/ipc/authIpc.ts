import { app, shell, BrowserWindow } from 'electron'
import { registerWhitelistedInvoke } from './ipcRegistry.js'
import { AuthController } from '../auth/authController.js'
import { startDeviceHeartbeat } from '../auth/deviceManager.js'
import { getAccessToken, invalidateCache } from '../auth/tokenStore.js'

let authController: AuthController | null = null
let stopHeartbeat: (() => void) | null = null

// --- Custom protocol handler for testcrew:// OAuth callback ---

const AUTH_PROTOCOL_SCHEME = process.env.AUTH_CALLBACK_SCHEME?.trim() || 'testcrew'

let pendingAuthResolve: ((tokens: { access_token: string; refresh_token: string; display_name?: string }) => void) | null = null

/** Parse tokens from a protocol callback URL like testcrew://auth?access_token=...&refresh_token=... */
function parseProtocolCallback(url: string): { access_token: string; refresh_token: string; display_name?: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${AUTH_PROTOCOL_SCHEME}:`) return null
    const accessToken = parsed.searchParams.get('access_token')?.trim()
    const refreshToken = parsed.searchParams.get('refresh_token')?.trim()
    if (!accessToken || !refreshToken) return null
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      display_name: parsed.searchParams.get('display_name')?.trim() || undefined,
    }
  } catch {
    return null
  }
}

/** Called when the OS routes a testcrew:// URL back to this app */
export function dispatchCentralAuthUrl(url: string): boolean {
  const tokens = parseProtocolCallback(url)
  if (!tokens) return false

  if (pendingAuthResolve) {
    pendingAuthResolve(tokens)
    pendingAuthResolve = null
    return true
  }

  // Spontaneous deep link (app was launched by the protocol URL itself)
  if (authController) {
    void authController.completeLogin(tokens.access_token, tokens.refresh_token, tokens.display_name)
    startHeartbeatIfLoggedIn()
    notifyRenderer()
    return true
  }

  return false
}

/** Wait for tokens from the protocol callback, with timeout */
function waitForAuthTokens(timeoutMs: number): Promise<{ access_token: string; refresh_token: string; display_name?: string }> {
  return new Promise((resolve, reject) => {
    pendingAuthResolve = resolve
    setTimeout(() => {
      if (pendingAuthResolve === resolve) {
        pendingAuthResolve = null
        reject(new Error('Login timed out'))
      }
    }, timeoutMs)
  })
}

/** Find a protocol URL in argv (Windows) */
export function findProtocolUrlInArgv(argv: string[]): string | null {
  const prefix = `${AUTH_PROTOCOL_SCHEME}://`
  for (const arg of argv) {
    if (arg.startsWith(prefix) || arg.includes(`${AUTH_PROTOCOL_SCHEME}://auth`)) {
      return arg
    }
  }
  return null
}

/** Register macOS open-url handler */
export function registerOpenUrlHandler(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (!dispatchCentralAuthUrl(url)) {
      console.warn('[auth] open-url ignored (no pending waiter):', url.slice(0, 96))
    }
  })
}

// --- Heartbeat management ---

function startHeartbeatIfLoggedIn(): void {
  if (stopHeartbeat || !authController?.getStatus().loggedIn) return

  stopHeartbeat = startDeviceHeartbeat({
    getAccessToken: () => {
      invalidateCache()
      return getAccessToken()
    },
    onTokenRefresh: () => authController!.tryRefreshToken(),
    onExpire: () => authController!.expire(),
    onReboot: () => {
      app.relaunch()
      app.exit(0)
    },
  })
}

function notifyRenderer(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && authController) {
    win.webContents.send('auth:onStatusChanged', authController.getStatus())
  }
}

// --- IPC Registration ---

export function getAuthController(): AuthController {
  if (!authController) throw new Error('AuthController not initialized')
  return authController
}

export function registerAuthIpc(options: {
  controller: AuthController
}) {
  authController = options.controller

  registerWhitelistedInvoke('auth:getStatus', async () => {
    return { ok: true, status: authController!.getStatus() }
  })

  /**
   * Central mode login:
   * 1. Build login URL with redirect_scheme=testcrew
   * 2. Open browser
   * 3. Wait for testcrew:// callback via protocol handler
   * 4. Store tokens and update state
   */
  registerWhitelistedInvoke('auth:login', async () => {
    try {
      // Build login URL with redirect_scheme (not HTTP redirect_uri)
      const loginUrl = await authController!.buildLoginUrl()

      // Start waiting for protocol callback
      const tokenPromise = waitForAuthTokens(180_000)

      // Open browser
      await shell.openExternal(loginUrl)

      // Wait for tokens from testcrew:// callback
      const tokens = await tokenPromise

      // Complete login
      await authController!.completeLogin(tokens.access_token, tokens.refresh_token, tokens.display_name)

      // Start heartbeat
      startHeartbeatIfLoggedIn()

      // Notify renderer
      notifyRenderer()

      return { ok: true, status: authController!.getStatus() }
    } catch (err) {
      pendingAuthResolve = null
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerWhitelistedInvoke('auth:logout', async () => {
    await authController!.logout()
    if (stopHeartbeat) {
      stopHeartbeat()
      stopHeartbeat = null
    }
    notifyRenderer()
    return { ok: true }
  })

  registerWhitelistedInvoke('auth:startHeartbeat', async () => {
    startHeartbeatIfLoggedIn()
    return { ok: true }
  })

  registerWhitelistedInvoke('auth:stopHeartbeat', async () => {
    if (stopHeartbeat) {
      stopHeartbeat()
      stopHeartbeat = null
    }
    return { ok: true }
  })
}
