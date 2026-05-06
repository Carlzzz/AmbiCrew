import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { kvGet, kvSet } from '../db/database.js'

export interface DeviceInfo {
  device_uuid: string
  mac_address: string
  os_version: string
  client_version: string
  platform: string
}

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

  let uuid = kvGet('device_uuid')
  if (!uuid) {
    uuid = randomUUID()
    kvSet('device_uuid', uuid)
  }

  cachedDeviceInfo = {
    device_uuid: uuid,
    mac_address: getMacAddress(),
    os_version: `${os.type()} ${os.release()}`,
    client_version: process.env.npm_package_version || '',
    platform: process.platform,
  }
  return cachedDeviceInfo
}

export function appendDeviceToLoginUrl(url: string, info: DeviceInfo): string {
  const u = new URL(url)
  u.searchParams.set('device_uuid', info.device_uuid)
  u.searchParams.set('mac_address', info.mac_address)
  u.searchParams.set('os_version', info.os_version)
  u.searchParams.set('client_version', info.client_version)
  u.searchParams.set('platform', info.platform)
  return u.toString()
}

// ---- Device Heartbeat ----

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function deriveApiBase(): string {
  const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || 'http://127.0.0.1:1420/woicrew/auth/login'
  try {
    const url = new URL(loginUrl)
    const parts = url.pathname.split('/auth/')
    return `${url.origin}${parts[0] || ''}`
  } catch {
    return 'http://127.0.0.1:1420/woicrew'
  }
}

export function startDeviceHeartbeat(options: {
  getAccessToken: () => string | null
  onTokenRefresh: () => Promise<boolean>
  onExpire: () => void
  onReboot: () => void
}): () => void {
  let registered = false
  let consecutive401 = 0
  let postLoginGrace = true
  setTimeout(() => { postLoginGrace = false }, 15_000)

  const base = deriveApiBase()

  async function sendHeartbeat() {
    const info = await getDeviceInfo()
    const token = options.getAccessToken()
    if (!token) return

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    if (!registered) {
      try {
        await fetch(`${base}/api/v1/devices/register`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            device_uuid: info.device_uuid,
            name: os.hostname(),
            mac: info.mac_address,
            os_version: info.os_version,
            client_version: info.client_version,
            hardware: os.arch(),
          }),
        })
        registered = true
      } catch { /* retry next time */ }
    }

    try {
      const res = await fetch(`${base}/api/v1/devices/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          device_uuid: info.device_uuid,
          mac_address: info.mac_address,
        }),
      })

      if (res.status === 401) {
        consecutive401++
        if (consecutive401 >= 3) {
          options.onExpire()
          return
        }
        await options.onTokenRefresh()
        return
      }

      consecutive401 = 0

      if (res.status === 403 && !postLoginGrace) {
        const json = await res.json().catch(() => ({})) as { rc?: number }
        if (json.rc === 40301 || json.rc === 40302) {
          options.onExpire()
          return
        }
      }

      if (res.ok) {
        const json = await res.json() as { commands?: Array<{ type: string }> }
        if (json.commands) {
          for (const cmd of json.commands) {
            if (cmd.type === 'reboot') {
              options.onReboot()
            }
          }
        }
      }
    } catch { /* network error, retry next cycle */ }
  }

  sendHeartbeat() // First immediate call
  heartbeatTimer = setInterval(sendHeartbeat, 15_000)

  return () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}
