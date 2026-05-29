import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isDesktopRuntime } from '../lib/desktopRuntime'

export type TerminalSpawnResult = {
  session_id: number
  shell: string
  cwd: string
}

export type TerminalOutputPayload = {
  session_id: number
  data: string
}

export type TerminalExitPayload = {
  session_id: number
  code: number | null
  signal?: string | null
}

type Unlisten = () => void

export const terminalApi = {
  isAvailable: isDesktopRuntime,

  spawn(input: { cols: number; rows: number; cwd?: string }): Promise<TerminalSpawnResult> {
    if (!isDesktopRuntime()) {
      return Promise.reject(new Error('Terminal is available in the desktop app runtime.'))
    }
    return invoke<TerminalSpawnResult>('spawn_pty', {
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd ?? null,
      shell: null,
    })
  },

  write(sessionId: number, data: string): Promise<void> {
    return invoke('write_pty', { sessionId, data })
  },

  resize(sessionId: number, cols: number, rows: number): Promise<void> {
    return invoke('resize_pty', { sessionId, cols, rows })
  },

  kill(sessionId: number): Promise<void> {
    return invoke('kill_pty', { sessionId })
  },

  onOutput(handler: (payload: TerminalOutputPayload) => void): Unlisten {
    let unlisten: (() => void) | null = null
    listen<TerminalOutputPayload>('terminal:output', (event) => {
      handler(event.payload)
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },

  onExit(handler: (payload: TerminalExitPayload) => void): Unlisten {
    let unlisten: (() => void) | null = null
    listen<TerminalExitPayload>('terminal:exit', (event) => {
      handler(event.payload)
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },
}
