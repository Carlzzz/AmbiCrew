/**
 * Device manager for CrewCentral — handles device registration and heartbeat.
 *
 * Adapted from TestCrew src/main/auth/deviceManager.ts.
 * Key differences from the Electron version:
 * - Device UUID persisted to ~/.claude/device.json (instead of SQLite)
 * - No GUI dialogs; uses console + process.exit for reboot
 * - No app.getVersion(); reads the version from APP_VERSION (injected by the
 *   Tauri launcher from CARGO_PKG_VERSION), falling back to the MACRO global
 *   (injected by preload.ts) for non-desktop runs.
 */

import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

declare const MACRO: { VERSION: string }

export interface DeviceInfo {
  device_uuid: string
  mac_address: string
  os_version: string
  client_version: string
  platform: string
}

const DEVICE_FILE = 'device.json'

// ── Device UUID persistence ──────────────────────────────────────────────────

function deviceFilePath(): string {
  return join(getClaudeConfigHomeDir(), DEVICE_FILE)
}

async function loadDeviceUuid(): Promise<string | null> {
  try {
    const raw = await readFile(deviceFilePath(), 'utf-8')
    const data = JSON.parse(raw) as { device_uuid?: string }
    return data.device_uuid || null
  } catch {
    return null
  }
}

async function saveDeviceUuid(uuid: string): Promise<void> {
  const dir = getClaudeConfigHomeDir()
  await mkdir(dir, { recursive: true })
  await writeFile(deviceFilePath(), JSON.stringify({ device_uuid: uuid }), 'utf-8')
}

// ── Device info ──────────────────────────────────────────────────────────────

let cachedDeviceInfo: DeviceInfo | null = null

function getMacAddress(): string {
  try {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac
        }
      }
    }
  } catch { /* ignore */ }
  return ''
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (cachedDeviceInfo) return cachedDeviceInfo

  const mac = getMacAddress()

  let deviceUuid =
    (await loadDeviceUuid()) ||
    (() => {
      const id = randomUUID()
      saveDeviceUuid(id).catch(() => {})
      return id
    })()

  cachedDeviceInfo = {
    device_uuid: deviceUuid,
    mac_address: mac,
    os_version: `${os.type()} ${os.release()}`,
    client_version:
      process.env.APP_VERSION ||
      (typeof MACRO !== 'undefined' && MACRO?.VERSION) ||
      '0.0.0',
    platform: process.platform,
  }
  return cachedDeviceInfo
}

// ── API helpers ──────────────────────────────────────────────────────────────

function deriveApiBase(loginUrl: string): string {
  if (process.env.AUTH_SERVER_BASE_URL) {
    return process.env.AUTH_SERVER_BASE_URL.replace(/\/+$/, '')
  }
  try {
    const u = new URL(loginUrl)
    const parts = u.pathname.split('/auth/')
    return `${u.origin}${parts[0] || ''}`
  } catch {
    return 'http://127.0.0.1:5173/woicrew'
  }
}

function buildApiUrls(loginUrl: string) {
  const base = deriveApiBase(loginUrl)
  return {
    heartbeatUrl: `${base}/api/v1/devices/heartbeat`,
    registerUrl: `${base}/api/v1/devices/register`,
  }
}

// ── Kick / ban detection ────────────────────────────────────────────────────

const RC_DEVICE_BANNED = 40301
const RC_DEVICE_KICKED = 40302

function parseJsonBody(text: string): Record<string, unknown> | null {
  const t = text.trim()
  if (!t) return null
  try {
    const o = JSON.parse(t) as unknown
    return o && typeof o === 'object' && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isKickOrBanRc(rc: unknown): boolean {
  const n = typeof rc === 'string' ? Number(rc) : rc
  return n === RC_DEVICE_BANNED || n === RC_DEVICE_KICKED
}

// ── Heartbeat management ────────────────────────────────────────────────────

export interface DeviceManagerDeps {
  /** Get the current access token (return null if logged out). */
  getAccessToken: () => string | null
  /** Get the login URL for deriving API base. */
  getLoginUrl: () => string
  /** Called when the session should be expired (kick/ban/auth failure). */
  onExpire: (message: string) => void
  /** Try to refresh the token. Return true if refresh succeeded. */
  tryRefreshToken: () => Promise<boolean>
}

const HEARTBEAT_INTERVAL_MS = 15_000
const POST_LOGIN_GRACE_MS = 15_000
const MAX_CONSECUTIVE_401 = 3

export function startDeviceHeartbeat(deps: DeviceManagerDeps): () => void {
  let lastLoggedInAt = 0
  let consecutive401 = 0
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const sendHeartbeat = async () => {
    if (stopped) return
    const token = deps.getAccessToken()
    if (!token) return

    const { heartbeatUrl } = buildApiUrls(deps.getLoginUrl())
    const info = await getDeviceInfo()

    try {
      const res = await fetch(heartbeatUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_uuid: info.device_uuid,
          mac_address: info.mac_address || undefined,
        }),
      })
      const text = await res.text()
      const body = parseJsonBody(text)

      if (res.status === 401) {
        const refreshed = await deps.tryRefreshToken()
        if (refreshed) {
          consecutive401 = 0
          return
        }
        consecutive401 += 1
        if (consecutive401 >= MAX_CONSECUTIVE_401) {
          deps.onExpire('Token 已失效，请重新登录')
        }
        return
      }

      if (res.status === 403) {
        const withinGrace = Date.now() - lastLoggedInAt < POST_LOGIN_GRACE_MS
        if (isKickOrBanRc(body?.rc)) {
          const msg =
            typeof body?.message === 'string' && body.message.trim()
              ? body.message
              : '设备已被强制下线或封禁'
          deps.onExpire(msg)
        } else if (!withinGrace) {
          deps.onExpire('访问被拒绝，请重新登录')
        }
        return
      }

      if (!res.ok) return

      consecutive401 = 0
    } catch {
      // Network unreachable — silently retry on next interval
    }
  }

  const sendRegisterAndHeartbeat = async () => {
    if (stopped) return
    const token = deps.getAccessToken()
    if (!token) return

    const { registerUrl, heartbeatUrl } = buildApiUrls(deps.getLoginUrl())
    const info = await getDeviceInfo()

    try {
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_uuid: info.device_uuid,
          name: info.platform,
          mac_address: info.mac_address,
          os_version: info.os_version,
          client_version: info.client_version,
          hardware: {
            platform: info.platform,
            arch: os.arch(),
          },
        }),
      })
      const text = await res.text()
      const body = parseJsonBody(text)

      if (res.status === 401) {
        await deps.tryRefreshToken()
      } else if (res.status === 403) {
        if (isKickOrBanRc(body?.rc)) {
          const msg =
            typeof body?.message === 'string' && body.message.trim()
              ? body.message
              : '设备已被强制下线或封禁'
          deps.onExpire(msg)
        }
      } else if (res.ok) {
        consecutive401 = 0
      }
    } catch {
      // Network unreachable — retry on next heartbeat
    }

    sendHeartbeat()
  }

  // Start heartbeat timer
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

  // Send initial register + heartbeat if already logged in
  if (deps.getAccessToken()) {
    lastLoggedInAt = Date.now()
    sendRegisterAndHeartbeat()
  }

  return () => {
    stopped = true
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}

/**
 * Append device info query parameters to the login URL so CrewCentral can
 * associate the device with the login session.
 */
export function appendDeviceToLoginUrl(loginUrl: string, info: DeviceInfo): string {
  try {
    const url = new URL(loginUrl)
    url.searchParams.set('device_uuid', info.device_uuid)
    if (info.mac_address) url.searchParams.set('mac_address', info.mac_address)
    url.searchParams.set('os_version', info.os_version)
    url.searchParams.set('client_version', info.client_version)
    url.searchParams.set('platform', info.platform)
    return url.toString()
  } catch {
    return loginUrl
  }
}
