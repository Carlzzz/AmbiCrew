import { shell, dialog, app } from 'electron'
import { registerWhitelistedInvoke } from './ipcRegistry.js'

export function registerShellIpc() {
  registerWhitelistedInvoke('shell:openExternal', async (_event, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Invalid protocol' }
    }
    await shell.openExternal(url)
    return { ok: true }
  })

  registerWhitelistedInvoke('shell:showOpenDialog', async (_event, opts: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(opts)
    return { ok: true, canceled: result.canceled, filePaths: result.filePaths }
  })

  registerWhitelistedInvoke('shell:getAppVersion', async () => {
    return { ok: true, version: app.getVersion() }
  })
}
