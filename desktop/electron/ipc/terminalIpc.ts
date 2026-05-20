import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'

type SessionId = number

interface TerminalSession {
  ptyProcess: pty.IPty
  shell: string
  cwd: string
}

const sessions = new Map<SessionId, TerminalSession>()
let nextSessionId = 1

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

function getShellArgs(shell: string): string[] {
  // PowerShell needs no extra args, bash/zsh work fine with empty args too
  return []
}

function buildSpawnEnv(): { [key: string]: string } {
  const env = { ...process.env } as { [key: string]: string }

  if (process.platform === 'win32') {
    const userBin = join(homedir(), '.local', 'bin')
    const currentPath = env.PATH || ''
    const segments = currentPath.split(';').map(s => s.trim().toLowerCase())
    if (!segments.includes(userBin.toLowerCase())) {
      env.PATH = `${userBin};${currentPath}`
    }
  }

  return env
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:spawn', (_event: IpcMainInvokeEvent, opts: { cols: number; rows: number; cwd?: string }) => {
    const shell = getDefaultShell()
    const cwd = opts.cwd || process.cwd()
    const sessionId = nextSessionId++

    const ptyProcess = pty.spawn(shell, getShellArgs(shell), {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: buildSpawnEnv(),
    })

    sessions.set(sessionId, { ptyProcess, shell, cwd })

    ptyProcess.onData((data: string) => {
      const sender = _event.sender
      if (!sender.isDestroyed()) {
        sender.send('terminal:output', { session_id: sessionId, data })
      }
    })

    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      const sender = _event.sender
      if (!sender.isDestroyed()) {
        sender.send('terminal:exit', { session_id: sessionId, code: exitCode, signal: signal?.toString() ?? null })
      }
      sessions.delete(sessionId)
    })

    return { session_id: sessionId, shell, cwd }
  })

  ipcMain.handle('terminal:write', (_event: IpcMainInvokeEvent, sessionId: SessionId, data: string) => {
    const session = sessions.get(sessionId)
    if (session) {
      session.ptyProcess.write(data)
    }
  })

  ipcMain.handle('terminal:resize', (_event: IpcMainInvokeEvent, sessionId: SessionId, cols: number, rows: number) => {
    const session = sessions.get(sessionId)
    if (session) {
      session.ptyProcess.resize(cols, rows)
    }
  })

  ipcMain.handle('terminal:kill', (_event: IpcMainInvokeEvent, sessionId: SessionId) => {
    const session = sessions.get(sessionId)
    if (session) {
      session.ptyProcess.kill()
      sessions.delete(sessionId)
    }
  })
}
