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
  code: number
  signal?: string | null
}

type Unlisten = () => void

function getElectronTerminal() {
  return (window as unknown as { electron: { terminal: ElectronTerminalAPI } }).electron.terminal
}

interface ElectronTerminalAPI {
  spawn: (opts: { cols: number; rows: number; cwd?: string }) => Promise<TerminalSpawnResult>
  write: (sessionId: number, data: string) => Promise<void>
  resize: (sessionId: number, cols: number, rows: number) => Promise<void>
  kill: (sessionId: number) => Promise<void>
  onOutput: (callback: (payload: TerminalOutputPayload) => void) => Unlisten
  onExit: (callback: (payload: TerminalExitPayload) => void) => Unlisten
}

export const terminalApi = {
  isAvailable: isDesktopRuntime,

  spawn(input: { cols: number; rows: number; cwd?: string }): Promise<TerminalSpawnResult> {
    if (!isDesktopRuntime()) {
      return Promise.reject(new Error('Terminal is available in the desktop app runtime.'))
    }
    return getElectronTerminal().spawn(input)
  },

  write(sessionId: number, data: string): Promise<void> {
    return getElectronTerminal().write(sessionId, data)
  },

  resize(sessionId: number, cols: number, rows: number): Promise<void> {
    return getElectronTerminal().resize(sessionId, cols, rows)
  },

  kill(sessionId: number): Promise<void> {
    return getElectronTerminal().kill(sessionId)
  },

  onOutput(handler: (payload: TerminalOutputPayload) => void): Unlisten {
    return getElectronTerminal().onOutput(handler)
  },

  onExit(handler: (payload: TerminalExitPayload) => void): Unlisten {
    return getElectronTerminal().onExit(handler)
  },
}
