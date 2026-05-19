/**
 * Adapter Sidecar Manager — spawn / restart / stop the IM adapter process.
 *
 * Mirrors serverManager.ts but for the adapter sidecar binary.
 * Reads ~/.claude/adapters.json to determine which platform flags
 * (--feishu, --telegram, --wechat, --dingtalk) to pass.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app } from 'electron'

let adapterProcess: ChildProcess | null = null

function getConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapters.json')
}

type AdapterConfig = {
  telegram?: { botToken?: string }
  feishu?: { appId?: string; appSecret?: string }
  wechat?: { accountId?: string; botToken?: string }
  dingtalk?: { clientId?: string; clientSecret?: string }
}

function readAdapterConfig(): AdapterConfig {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8')) as AdapterConfig
  } catch {
    return {}
  }
}

function adapterExePath(): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(process.resourcesPath, `adapter-sidecar${ext}`)
}

function findBunExe(): string {
  if (process.platform === 'win32') return 'bun.exe'
  return 'bun'
}

function adapterEntryPath(): string {
  return path.join(app.getAppPath(), 'sidecars', 'adapter-sidecar.ts')
}

function adapterCwd(): string {
  return path.join(app.getAppPath(), '..')
}

function buildAdapterFlags(config: AdapterConfig): string[] {
  const flags: string[] = []
  if (config.telegram?.botToken) flags.push('--telegram')
  if (config.feishu?.appId && config.feishu.appSecret) flags.push('--feishu')
  if (config.wechat?.accountId && config.wechat.botToken) flags.push('--wechat')
  if (config.dingtalk?.clientId && config.dingtalk.clientSecret) flags.push('--dingtalk')
  return flags
}

const SERVER_PORT = 43124

export async function startAdapters(): Promise<void> {
  const config = readAdapterConfig()
  const flags = buildAdapterFlags(config)

  if (flags.length === 0) {
    console.log('[adapter] No adapter credentials found — skipping adapter sidecar startup')
    return
  }

  if (adapterProcess) {
    console.warn('[adapter] Adapter process already running — skipping duplicate start')
    return
  }

  const adapterServerUrl = `ws://127.0.0.1:${SERVER_PORT}`

  if (app.isPackaged) {
    const exePath = adapterExePath()
    adapterProcess = spawn(exePath, flags, {
      env: {
        ...process.env,
        DESKTOP_MODE: '1',
        CLAUDE_RUNTIME_DIR: path.join(process.resourcesPath, 'runtime'),
        CLAUDE_APP_ROOT: process.resourcesPath,
        ADAPTER_SERVER_URL: adapterServerUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } else {
    const bunExe = findBunExe()
    const entryPath = adapterEntryPath()
    const cwd = adapterCwd()
    adapterProcess = spawn(bunExe, ['run', entryPath, ...flags], {
      cwd,
      env: {
        ...process.env,
        DESKTOP_MODE: '1',
        CLAUDE_RUNTIME_DIR: path.join(cwd, 'runtime'),
        ADAPTER_SERVER_URL: adapterServerUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  adapterProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[adapter]', data.toString().trim())
  })

  adapterProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[adapter]', data.toString().trim())
  })

  adapterProcess.on('error', (err) => {
    console.error('[adapter] Process error:', err)
    adapterProcess = null
  })

  adapterProcess.on('exit', (code, signal) => {
    console.log(`[adapter] exited with code=${code} signal=${signal}`)
    adapterProcess = null
  })

  console.log(`[adapter] Started with flags: ${flags.join(' ')}`)
}

export async function restartAdapters(): Promise<void> {
  console.log('[adapter] Restarting adapter sidecar...')
  stopAdapters()
  // Small delay to let the old process fully exit and release ports
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await startAdapters()
}

export function stopAdapters(): void {
  if (!adapterProcess) return

  console.log('[adapter] Stopping adapter sidecar...')
  try {
    adapterProcess.kill('SIGTERM')
  } catch {
    // Process may have already exited
  }

  const proc = adapterProcess
  const killTimer = setTimeout(() => {
    try {
      proc.kill('SIGKILL')
    } catch {
      // Already dead
    }
  }, 5000)

  adapterProcess.on('exit', () => {
    clearTimeout(killTimer)
    adapterProcess = null
  })

  adapterProcess = null
}
