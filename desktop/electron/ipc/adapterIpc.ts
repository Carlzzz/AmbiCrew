import { registerWhitelistedInvoke } from './ipcRegistry.js'
import { restartAdapters } from '../server/adapterManager.js'

export function registerAdapterIpc(): void {
  registerWhitelistedInvoke('adapters:restart', async () => {
    try {
      await restartAdapters()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
