import { create } from 'zustand'
import { isDesktopRuntime } from '../lib/desktopRuntime'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'restarting'
  | 'error'

type CheckOptions = {
  silent?: boolean
}

const DISMISSED_UPDATE_VERSION_KEY = 'cc-haha-dismissed-update-version'

type UpdateStore = {
  status: UpdateStatus
  availableVersion: string | null
  releaseNotes: string | null
  progressPercent: number
  downloadedBytes: number
  totalBytes: number | null
  error: string | null
  checkedAt: number | null
  shouldPrompt: boolean
  initialize: () => Promise<void>
  checkForUpdates: (options?: CheckOptions) => Promise<null>
  installUpdate: () => Promise<void>
  dismissPrompt: () => void
}

function writeDismissedUpdateVersion(version: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (version) {
      window.localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version)
    } else {
      window.localStorage.removeItem(DISMISSED_UPDATE_VERSION_KEY)
    }
  } catch {
    // Ignore storage write failures.
  }
}

function readDismissedUpdateVersion(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY)
  } catch {
    return null
  }
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: 'idle',
  availableVersion: null,
  releaseNotes: null,
  progressPercent: 0,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  checkedAt: null,
  shouldPrompt: false,

  initialize: async () => {
    if (!isDesktopRuntime()) return
    // Auto-check on startup after a short delay
    setTimeout(() => {
      get().checkForUpdates({ silent: true })
    }, 10_000)
  },

  checkForUpdates: async (options?: CheckOptions) => {
    if (!isDesktopRuntime()) return null
    set({ status: 'checking', error: null })
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      set({ checkedAt: Date.now() })
      if (!update) {
        set({ status: 'up-to-date' })
        return null
      }
      const dismissed = readDismissedUpdateVersion()
      const shouldPrompt = !options?.silent || update.version !== dismissed
      set({
        status: 'available',
        availableVersion: update.version,
        releaseNotes: update.body,
        shouldPrompt,
      })
    } catch (err) {
      if (!options?.silent) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      } else {
        set({ status: 'idle' })
      }
    }
    return null
  },

  installUpdate: async () => {
    if (!isDesktopRuntime()) return
    set({ status: 'downloading', progressPercent: 0, downloadedBytes: 0, totalBytes: null })
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (!update) {
        set({ status: 'up-to-date' })
        return
      }
      await update.download((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          set({ totalBytes: event.data.contentLength })
        } else if (event.event === 'Progress') {
          const downloaded = get().downloadedBytes + event.data.chunkLength
          const total = get().totalBytes
          set({
            downloadedBytes: downloaded,
            progressPercent: total ? Math.round((downloaded / total) * 100) : 0,
          })
        }
      })
      set({ status: 'restarting' })
      await update.install()
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  dismissPrompt: () => {
    writeDismissedUpdateVersion(get().availableVersion)
    set({ shouldPrompt: false })
  },
}))
