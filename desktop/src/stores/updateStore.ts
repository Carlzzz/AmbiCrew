import { create } from 'zustand'

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
    // Update checking will be wired via electron-updater in a future phase
  },

  checkForUpdates: async () => {
    set({ status: 'idle' })
    return null
  },

  installUpdate: async () => {
    // Will be wired via electron-updater in a future phase
  },

  dismissPrompt: () => {
    writeDismissedUpdateVersion(get().availableVersion)
    set({ shouldPrompt: false })
  },
}))
