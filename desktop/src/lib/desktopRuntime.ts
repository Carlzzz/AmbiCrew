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

  // Wait for the sidecar server to start (it may take a few seconds after install)
  let url: string | null = null
  for (let attempt = 0; attempt < 40; attempt++) {
    url = await invoke('get_server_url')
    if (url) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!url) {
    throw new Error('Server failed to start within 20 seconds')
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
