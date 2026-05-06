import { BrowserWindow, shell } from 'electron'
import { registerWhitelistedInvoke } from './ipcRegistry.js'
import { AuthController } from '../auth/authController.js'
import { CallbackServer } from '../auth/callbackServer.js'

let authController: AuthController | null = null
let callbackServer: CallbackServer | null = null

export function getAuthController(): AuthController {
  if (!authController) throw new Error('AuthController not initialized')
  return authController
}

export function registerAuthIpc(options: {
  controller: AuthController
  callbackSrv: CallbackServer
}) {
  authController = options.controller
  callbackServer = options.callbackSrv

  registerWhitelistedInvoke('auth:getStatus', async () => {
    return { ok: true, status: authController!.getStatus() }
  })

  registerWhitelistedInvoke('auth:login', async () => {
    // 1. Start the callback server to receive OAuth redirect
    const callbackPromise = callbackServer!.start()

    // 2. Get login URL with device info
    const loginUrl = await authController!.login()

    // 3. Open browser
    await shell.openExternal(loginUrl)

    // 4. Wait for callback (with timeout)
    const TIMEOUT_MS = 180_000
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Login timed out after 3 minutes')), TIMEOUT_MS)
    )

    try {
      const params = await Promise.race([callbackPromise, timeout])
      const accessToken = params.get('access_token')?.trim()
      const refreshToken = params.get('refresh_token')?.trim()
      const displayName = params.get('display_name')?.trim()

      if (!accessToken || !refreshToken) {
        return { ok: false, error: 'Missing tokens in callback' }
      }

      await authController!.completeLogin(accessToken, refreshToken, displayName)

      // Notify renderer
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('auth:onStatusChanged', authController!.getStatus())

      return { ok: true, status: authController!.getStatus() }
    } catch (err) {
      callbackServer!.stop()
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerWhitelistedInvoke('auth:logout', async () => {
    await authController!.logout()
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('auth:onStatusChanged', authController!.getStatus())
    return { ok: true }
  })
}
