/**
 * Proactive CrewCentral token refresh for the server process.
 *
 * The Tauri/Electron frontend runs its own device heartbeat that refreshes
 * tokens, but the bun server subprocess has no such mechanism. Without this,
 * the access token silently expires in-memory and refresh token may also
 * expire before the next CLI spawn triggers ensureFreshAccessToken().
 *
 * This timer runs every 20 minutes and calls centralOAuthService.refreshToken()
 * if the cached token is older than TOKEN_VALIDATION_INTERVAL_MS (5 min).
 * It keeps both access and refresh tokens alive indefinitely.
 */

const REFRESH_INTERVAL_MS = 20 * 60 * 1000 // 20 minutes

let timer: ReturnType<typeof setInterval> | null = null

async function tick(): Promise<void> {
  // Only relevant in CrewCentral mode
  if (process.env.AUTH_MODE !== 'central') return

  try {
    const { centralOAuthService } = await import('./centralOAuthService.js')
    // ensureFreshAccessToken validates against server and refreshes if 401
    const token = await centralOAuthService.ensureFreshAccessToken()
    if (!token) {
      console.warn('[CentralTokenRefresh] No token available — user may need to /login')
      return
    }
    // Self-heal the device heartbeat: if we hold a valid token but the
    // heartbeat loop isn't running, (re)start it. Keeps the heartbeat bound
    // to the same lifecycle as token refresh so the device can't get stuck
    // "logged in but never sending heartbeats" (shows offline in CrewCentral).
    try {
      const { ensureHeartbeatRunning } = await import(
        '../../services/central/auth-controller.js'
      )
      ensureHeartbeatRunning()
    } catch (hbErr) {
      console.error(
        '[CentralTokenRefresh] ensureHeartbeatRunning failed:',
        hbErr instanceof Error ? hbErr.message : hbErr,
      )
    }
  } catch (err) {
    console.error(
      '[CentralTokenRefresh] Error:',
      err instanceof Error ? err.message : err,
    )
  }
}

export function startCentralTokenRefreshTimer(): void {
  if (timer) return
  // Don't start if not in central mode at boot. The timer will be a no-op
  // if AUTH_MODE changes later (ensureActiveProviderSynced is async), but
  // the tick() check handles that gracefully.
  timer = setInterval(tick, REFRESH_INTERVAL_MS)
  // First tick after 30s to let server fully initialize
  setTimeout(tick, 30_000)
}

export function stopCentralTokenRefreshTimer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
