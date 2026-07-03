import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'

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

type ReleaseAsset = {
  platform: 'windows' | 'macos' | 'linux'
  download_url: string
  file_name: string
  file_size_bytes: number | null
  md5: string
  sha256: string
}

type LatestReleaseResponse = {
  is_latest: boolean
  current_version: string | null
  target_version: string | null
  update_policy: 'optional' | 'forced' | null
  assets: ReleaseAsset[]
  release_notes_excerpt: string | null
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

// Current platform asset, populated by checkForUpdates(), consumed by installUpdate().
let currentAsset: ReleaseAsset | null = null

function detectPlatform(): 'windows' | 'macos' | 'linux' {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  return 'linux'
}

// Track download progress from the Rust backend
type ProgressPayload = {
  percent: number
  downloaded_bytes: number
  total_bytes: number
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
    // Listen for download progress events from the Rust backend
    try {
      await listen<ProgressPayload>('update-download-progress', (event) => {
        set({
          downloadedBytes: event.payload.downloaded_bytes,
          totalBytes: event.payload.total_bytes,
          progressPercent: event.payload.percent,
        })
      })
    } catch {
      // Event listener setup failed — degradation (progress bar stays indeterminate)
    }

    // Run an initial update check 5s after startup (silent — no prompt if up-to-date)
    setTimeout(() => {
      void get().checkForUpdates({ silent: true })
    }, 5000)
  },

  checkForUpdates: async (options?: CheckOptions) => {
    const { status: currentStatus } = get()
    // Don't start a new check if already downloading or restarting
    if (currentStatus === 'downloading' || currentStatus === 'restarting') return null

    set({ status: 'checking', error: null })

    try {
      const version = await getVersion()
      // Use the Rust backend to bypass webview CORS restrictions — the dev
      // webview origin isn't in CrewCentral's CORS allowlist, so a direct
      // fetch() fails with "Failed to fetch".
      const json = await invoke<LatestReleaseResponse & { rc?: number; data?: LatestReleaseResponse }>(
        'check_for_updates',
        { currentVersion: version },
      )

      if (!json || typeof json !== 'object') {
        throw new Error('Invalid response from update server')
      }

      const data: LatestReleaseResponse =
        json.data ?? (json as LatestReleaseResponse)

      if (data.is_latest || !data.target_version) {
        set({
          status: 'up-to-date',
          checkedAt: Date.now(),
          shouldPrompt: false,
        })
        return null
      }

      const platform = detectPlatform()
      const asset = data.assets.find((a) => a.platform === platform)

      if (!asset) {
        // No asset for our platform — treat as latest
        set({
          status: 'up-to-date',
          checkedAt: Date.now(),
          shouldPrompt: false,
        })
        return null
      }

      set({
        availableVersion: data.target_version,
        releaseNotes: data.release_notes_excerpt,
        totalBytes: asset.file_size_bytes,
        checkedAt: Date.now(),
      })

      if (data.update_policy === 'forced') {
        // Forced update — start download immediately after a brief tick so the
        // 'checking' state renders first
        currentAsset = asset
        setTimeout(() => {
          void get().installUpdate()
        }, 100)
      } else {
        currentAsset = asset
        set({
          status: 'available',
          shouldPrompt: true,
        })
      }

      return null
    } catch (err) {
      // Silent check — suppress notification if it was automatic
      const isSilent = options?.silent === true
      set({
        status: 'error',
        error: isSilent
          ? null
          : err instanceof Error
            ? err.message
            : 'Update check failed',
        checkedAt: Date.now(),
      })
      return null
    }
  },

  installUpdate: async () => {
    if (!currentAsset) {
      set({ status: 'error', error: 'No download information available. Please check for updates again.' })
      return
    }

    set({ status: 'downloading', error: null })

    try {
      const result = await invoke<{ temp_path: string; file_size_bytes: number }>(
        'download_update',
        {
          url: currentAsset!.download_url,
          expectedSha256: currentAsset!.sha256,
        },
      )

      set({ status: 'restarting' })

      // Brief delay so the UI shows "restarting" before we exit
      setTimeout(() => {
        void invoke('install_update', { installerPath: result.temp_path })
      }, 500)
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Download or installation failed',
      })
    }
  },

  dismissPrompt: () => {
    set({ shouldPrompt: false })
  },
}))
