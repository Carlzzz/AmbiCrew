import { ipcMain, type IpcMainInvokeEvent } from 'electron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>

const WHITELIST_INVOKE_CHANNELS = new Set([
  'auth:getStatus',
  'auth:login',
  'auth:logout',
  'auth:startHeartbeat',
  'auth:stopHeartbeat',
  'shell:openExternal',
  'shell:showOpenDialog',
  'shell:getAppVersion',
  'server:getBaseUrl',
])

export function registerWhitelistedInvoke(channel: string, handler: InvokeHandler): void {
  if (!WHITELIST_INVOKE_CHANNELS.has(channel)) {
    throw new Error(`IPC channel not whitelisted: ${channel}`)
  }
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      console.error(`[ipc] ${channel} error:`, err)
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })
}

export function registerOnChannel(
  channel: string,
  handler: (...args: unknown[]) => void,
): () => void {
  ipcMain.on(channel, (_event, ...args) => handler(...args))
  return () => ipcMain.removeAllListeners(channel)
}
