/**
 * Claude Code Desktop App — HTTP + WebSocket Server
 *
 * 为桌面端 UI 提供 REST API 和 WebSocket 实时通信。
 * 读写与 CLI 完全相同的文件系统，确保 CLI/UI 数据互通。
 */

import { handleApiRequest } from './router.js'
import { handleWebSocket, type WebSocketData } from './ws/handler.js'
import { corsHeaders } from './middleware/cors.js'
import { requireAuth } from './middleware/auth.js'
import { teamWatcher } from './services/teamWatcher.js'
import { cronScheduler } from './services/cronScheduler.js'
import { handleProxyRequest } from './proxy/handler.js'
import { ProviderService } from './services/providerService.js'
import { handleHahaOAuthCallback } from './api/haha-oauth.js'
import { handleHahaOpenAIOAuthCallback } from './api/haha-openai-oauth.js'
import { ensureDesktopCliLauncherInstalled } from './services/desktopCliLauncherService.js'
import { startCentralTokenRefreshTimer } from './services/centralTokenRefreshTimer.js'
import { enableConfigs } from '../utils/config.js'
import { diagnosticsService } from './services/diagnosticsService.js'

function readArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function hasArgFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag)
}

function resolveServerOptions() {
  const portArg = readArgValue('--port')
  const port = Number.parseInt(portArg || process.env.SERVER_PORT || '3456', 10)
  const host = readArgValue('--host') || process.env.SERVER_HOST || '127.0.0.1'
  const cliPath = readArgValue('--cli-path')
  const authRequired = hasArgFlag('--auth-required')

  if (cliPath) {
    process.env.CLAUDE_CLI_PATH = cliPath
  }

  return { port, host, authRequired }
}

const SERVER_OPTIONS = resolveServerOptions()
const PORT = SERVER_OPTIONS.port
const HOST = SERVER_OPTIONS.host

export function startServer(port = PORT, host = HOST) {
  enableConfigs()
  diagnosticsService.installConsoleCapture()
  diagnosticsService.installProcessCapture()
  ProviderService.setServerPort(port)

  // Ensure active provider env (AUTH_MODE, LLM_PROXY_BASE_URL, etc.) is applied
  // to process.env. The server doesn't call applySafeConfigEnvironmentVariables()
  // like the CLI does, so we sync the active provider's env directly.
  void new ProviderService().ensureActiveProviderSynced().then(() => {
    if (process.env.DESKTOP_MODE) {
      console.log(`[Server] AUTH_MODE=${process.env.AUTH_MODE || '(unset)'}, LLM_PROXY_BASE_URL=${process.env.LLM_PROXY_BASE_URL ? '***set***' : '(unset)'}`)
    }
  }).catch(() => {})

  const localConnectHost =
    host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost'
      ? '127.0.0.1'
      : host

  /**
   * Auth is required when explicitly opted in or when bound to a non-localhost address.
   * - Default localhost dev: no auth needed (tests pass as-is).
   * - Production / non-localhost (e.g. 0.0.0.0): auth enforced automatically.
   * - Explicit opt-in: SERVER_AUTH_REQUIRED=1 forces auth even on localhost.
   */
  const authRequired =
    SERVER_OPTIONS.authRequired ||
    process.env.SERVER_AUTH_REQUIRED === '1' ||
    host !== '127.0.0.1'

  const server = Bun.serve<WebSocketData>({
    port,
    hostname: host,
    idleTimeout: 60,

    async fetch(req, server) {
      const url = new URL(req.url)

      const origin = req.headers.get('Origin')

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin) })
      }

      // WebSocket upgrade
      if (url.pathname.startsWith('/ws/')) {
        // Enforce authentication when required
        if (authRequired) {
          const authError = requireAuth(req)
          if (authError) {
            const headers = new Headers(authError.headers)
            for (const [key, value] of Object.entries(corsHeaders(origin))) {
              headers.set(key, value)
            }
            return new Response(authError.body, { status: authError.status, headers })
          }
        }

        // Validate session ID format
        const sessionId = url.pathname.split('/').pop() || ''
        if (!sessionId || !/^[0-9a-zA-Z_-]{1,64}$/.test(sessionId)) {
          return new Response('Invalid session ID', { status: 400 })
        }
        const upgraded = server.upgrade(req, {
          data: {
            sessionId,
            connectedAt: Date.now(),
            channel: 'client',
            sdkToken: null,
            serverPort: port,
            serverHost: localConnectHost,
          },
        })
        if (upgraded) return undefined
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      // Internal SDK WebSocket used by the spawned Claude CLI.
      if (url.pathname.startsWith('/sdk/')) {
        const sessionId = url.pathname.split('/').pop() || ''
        if (!sessionId || !/^[0-9a-zA-Z_-]{1,64}$/.test(sessionId)) {
          return new Response('Invalid session ID', { status: 400 })
        }
        const upgraded = server.upgrade(req, {
          data: {
            sessionId,
            connectedAt: Date.now(),
            channel: 'sdk',
            sdkToken: url.searchParams.get('token'),
            serverPort: port,
            serverHost: localConnectHost,
          },
        })
        if (upgraded) return undefined
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      if (url.pathname === '/callback') {
        // CrewCentral callback: access_token + refresh_token in query
        if (url.searchParams.has('access_token')) {
          const { centralOAuthService } = await import(
            './services/centralOAuthService.js'
          )
          try {
            await centralOAuthService.completeCallback(url.searchParams)

            // Invalidate the token validation cache so the next CLI spawn
            // will validate the new token instead of using a stale one.
            centralOAuthService.invalidateTokenCache()

            // Restart any sessions that were stopped due to auth failures,
            // so they pick up the new credentials automatically.
            const { restartAuthFailedSessions } = await import(
              './ws/handler.js'
            )
            restartAuthFailedSessions()

            return new Response(renderCentralCallbackPage(true, null), {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return new Response(renderCentralCallbackPage(false, msg), {
              status: 400,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          }
        }
        return handleHahaOAuthCallback(url)
      }

      if (url.pathname === '/callback/openai') {
        return handleHahaOpenAIOAuthCallback(url)
      }

      // REST API
      if (url.pathname.startsWith('/api/')) {
        // Enforce authentication when required
        if (authRequired) {
          const authError = requireAuth(req)
          if (authError) {
            const headers = new Headers(authError.headers)
            for (const [key, value] of Object.entries(corsHeaders(origin))) {
              headers.set(key, value)
            }
            return new Response(authError.body, { status: authError.status, headers })
          }
        }

        try {
          const response = await handleApiRequest(req, url)
          // Add CORS headers to all responses
          const headers = new Headers(response.headers)
          for (const [key, value] of Object.entries(corsHeaders(origin))) {
            headers.set(key, value)
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          })
        } catch (error) {
          void diagnosticsService.recordEvent({
            type: 'api_request_failed',
            severity: 'error',
            summary: error instanceof Error ? error.message : String(error),
            details: { path: url.pathname, method: req.method, error },
          })
          console.error('[Server] API error:', error)
          return Response.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders() }
          )
        }
      }

      // Proxy — protocol-translating reverse proxy for OpenAI-compatible APIs
      if (url.pathname.startsWith('/proxy/')) {
        if (authRequired) {
          const authError = requireAuth(req)
          if (authError) {
            const headers = new Headers(authError.headers)
            for (const [key, value] of Object.entries(corsHeaders(origin))) {
              headers.set(key, value)
            }
            return new Response(authError.body, { status: authError.status, headers })
          }
        }
        try {
          const response = await handleProxyRequest(req, url)
          const headers = new Headers(response.headers)
          for (const [key, value] of Object.entries(corsHeaders(origin))) {
            headers.set(key, value)
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          })
        } catch (error) {
          void diagnosticsService.recordEvent({
            type: 'proxy_request_failed',
            severity: 'error',
            summary: error instanceof Error ? error.message : String(error),
            details: { path: url.pathname, method: req.method, error },
          })
          console.error('[Server] Proxy error:', error)
          return Response.json(
            { type: 'error', error: { type: 'api_error', message: 'Internal proxy error' } },
            { status: 500, headers: corsHeaders() },
          )
        }
      }

      // Health check
      if (url.pathname === '/health') {
        return Response.json(
          { status: 'ok', version: process.env.APP_VERSION || 'unknown', timestamp: new Date().toISOString() },
          { headers: corsHeaders(origin) },
        )
      }

      return new Response('Not Found', { status: 404 })
    },

    websocket: handleWebSocket,
  })

  // Start watching ~/.claude/teams/ for real-time WebSocket push
  teamWatcher.start()

  // Start the cron scheduler to execute scheduled tasks
  cronScheduler.start()

  // Proactively refresh CrewCentral tokens so they don't silently expire
  // while CLI subprocesses are idle (the Tauri frontend heartbeat doesn't
  // run in this process).
  startCentralTokenRefreshTimer()

  // Install the bundled CLI launcher (ambi) into ~/.local/bin BEFORE
  // signaling readiness. Otherwise the Electron main process opens the
  // window and the user may open a terminal before the binary is copied.
  const signalReady = () => {
    console.log(`[Server] Claude Code API server running at http://${host}:${port}`)
  }

  ensureDesktopCliLauncherInstalled()
    .then(() => signalReady())
    .catch((error) => {
      console.error(
        '[desktop-cli-launcher] failed to install bundled launcher:',
        error instanceof Error ? error.message : error,
      )
      signalReady()
    })

  return server
}

// ─── Graceful shutdown: kill all CLI subprocesses on exit ────────────────────
import { conversationService } from './services/conversationService.js'

function cleanupAllSessions() {
  const active = conversationService.getActiveSessions()
  if (active.length > 0) {
    console.log(`[Server] Shutting down — killing ${active.length} CLI subprocess(es)`)
    for (const sessionId of active) {
      conversationService.stopSession(sessionId)
    }
  }
}

process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM')
  cleanupAllSessions()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT')
  cleanupAllSessions()
  process.exit(0)
})

process.on('exit', () => {
  cleanupAllSessions()
})

function renderCentralCallbackPage(
  success: boolean,
  errorMsg: string | null,
): string {
  if (success) {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Login Success</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333}.card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{color:#16a34a;margin:0 0 12px}p{color:#666}</style>
</head><body><div class="card"><h1>Login Successful</h1><p>You can close this window and return to AmbiCrew.</p></div>
<script>setTimeout(() => window.close(), 1500)</script>
</body></html>`
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Login Failed</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333}.card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{color:#dc2626;margin:0 0 12px}pre{color:#666;white-space:pre-wrap;word-break:break-word;text-align:left;background:#f5f5f5;padding:12px;border-radius:6px}</style>
</head><body><div class="card"><h1>Login Failed</h1><pre>${escapeCentralHtml(errorMsg ?? 'Unknown error')}</pre></div>
</body></html>`
}

function escapeCentralHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Direct execution
if (import.meta.main) {
  startServer()
}
