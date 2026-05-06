import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import type { CentralAuthTokens } from './token-store.js'

let pendingResolve: ((v: CentralAuthTokens) => void) | null = null
let pendingReject: ((e: Error) => void) | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let callbackServer: Server | null = null

function clearPending(): void {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
  pendingResolve = null
  pendingReject = null
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.removeAllListeners()
    callbackServer.close()
    callbackServer = null
  }
}

/**
 * Parse tokens from a callback URL (supports both query and hash params).
 * CrewCentral redirects with: ?access_token=...&refresh_token=...&display_name=...
 * Some configurations use hash: #access_token=...&refresh_token=...
 */
function readOAuthParams(u: URL): CentralAuthTokens | null {
  let access_token = u.searchParams.get('access_token')
  let refresh_token = u.searchParams.get('refresh_token')
  let display_name = u.searchParams.get('display_name')?.trim() || undefined

  if ((!access_token || !refresh_token) && u.hash.length > 1) {
    const h = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash)
    access_token = access_token || h.get('access_token')
    refresh_token = refresh_token || h.get('refresh_token')
    if (!display_name) display_name = h.get('display_name')?.trim() || undefined
  }

  if (!access_token?.trim() || !refresh_token?.trim()) return null
  return {
    access_token: access_token.trim(),
    refresh_token: refresh_token.trim(),
    display_name,
  }
}

/**
 * Parse a custom protocol callback URL (e.g., ambicode://auth?access_token=...).
 */
export function parseCentralCallbackUrl(rawUrl: string, scheme: string): CentralAuthTokens | null {
  const trimmed = rawUrl.trim()
  try {
    const u = new URL(trimmed)
    if (u.protocol !== `${scheme}:`) return null
    return readOAuthParams(u)
  } catch {
    return null
  }
}

/**
 * Start a local HTTP callback server and return the redirect URL.
 * CrewCentral will redirect the browser to this URL after login.
 */
export async function startCallbackServer(): Promise<string> {
  stopCallbackServer()
  const port = process.env.AUTH_CALLBACK_PORT
    ? parseInt(process.env.AUTH_CALLBACK_PORT, 10)
    : 0

  return new Promise((resolve, reject) => {
    callbackServer = createServer()
    callbackServer.once('error', (err) => {
      reject(new Error(`Failed to start auth callback server: ${err.message}`))
    })

    callbackServer.listen(port, 'localhost', () => {
      const address = callbackServer!.address() as AddressInfo
      const port = address.port
      resolve(`http://localhost:${port}/callback`)
    })
  })
}

/**
 * Wait for the auth callback from CrewCentral.
 * @param timeoutMs Maximum wait time in milliseconds
 * @param onReady Called after the server is listening and the browser can be opened
 */
export function waitForCentralAuthTokens(
  timeoutMs: number,
  onReady: () => Promise<void>,
): Promise<CentralAuthTokens> {
  return new Promise((resolve, reject) => {
    if (pendingTimer) clearTimeout(pendingTimer)
    clearPending()

    pendingResolve = resolve
    pendingReject = reject

    if (!callbackServer) {
      reject(new Error('Callback server not started'))
      return
    }

    callbackServer.on('request', (req, res) => {
      const parsedUrl = new URL(
        req.url || '',
        `http://${req.headers.host || 'localhost'}`,
      )

      if (parsedUrl.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }

      const tokens = readOAuthParams(parsedUrl)
      if (!tokens) {
        res.writeHead(400)
        res.end('Missing access_token or refresh_token')
        return
      }

      // Send success page to browser
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<html><body><h1>Login successful</h1><p>You may close this window.</p></body></html>',
      )

      stopCallbackServer()

      if (pendingResolve) {
        clearTimeout(pendingTimer!)
        pendingResolve(tokens)
        clearPending()
      }
    })

    pendingTimer = setTimeout(() => {
      stopCallbackServer()
      if (pendingReject) pendingReject(new Error('Auth callback timeout'))
      clearPending()
    }, timeoutMs)

    // Notify caller that server is ready
    void onReady()
  })
}

/**
 * Clean up any pending waiters and the callback server.
 */
export function cleanup(): void {
  clearPending()
  stopCallbackServer()
}
