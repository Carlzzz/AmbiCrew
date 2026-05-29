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

export const useUpdateStore = create<UpdateStore>(() => ({
  status: 'idle',
  availableVersion: null,
  releaseNotes: null,
  progressPercent: 0,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  checkedAt: null,
  shouldPrompt: false,
  initialize: async () => {},
  checkForUpdates: async () => null,
  installUpdate: async () => {},
  dismissPrompt: () => {},
}))
