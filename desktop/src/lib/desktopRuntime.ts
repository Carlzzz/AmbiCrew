import { getDefaultBaseUrl, setBaseUrl } from '../api/client'
import { invoke } from '@tauri-apps/api/core'

/** Returns true when running inside the Tauri desktop app. */
export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window
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

  const url: string | null = await invoke('get_server_url')
  if (!url) {
    throw new Error('Server not started yet')
  }
  setBaseUrl(url)
  await waitForHealth(url)
  return url
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
