import { getDefaultBaseUrl, setBaseUrl } from '../api/client'

/** Returns true when running inside the Electron desktop app. */
export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return 'electron' in window
}

/** @deprecated Use isDesktopRuntime() instead. */
export const isTauriRuntime = isDesktopRuntime

export async function initializeDesktopServerUrl() {
  if (!isDesktopRuntime()) {
    const fallbackUrl = getDefaultBaseUrl()
    setBaseUrl(fallbackUrl)
    await waitForHealth(fallbackUrl)
    return fallbackUrl
  }

  const electron = (window as unknown as { electron: { server: { getBaseUrl: () => Promise<{ ok: boolean; baseUrl?: string; error?: string }> } } }).electron
  const result = await electron.server.getBaseUrl()
  if (!result.ok || !result.baseUrl) {
    throw new Error(result.error || 'Failed to get server URL from Electron')
  }
  setBaseUrl(result.baseUrl)
  await waitForHealth(result.baseUrl)
  return result.baseUrl
}

async function waitForHealth(serverUrl: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/health`, { cache: 'no-store' })
      if (response.ok) return
      lastError = new Error(`healthcheck returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    lastError instanceof Error
      ? `Local server healthcheck failed: ${lastError.message}`
      : 'Local server healthcheck failed',
  )
}
