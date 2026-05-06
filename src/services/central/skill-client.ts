/**
 * Skill Hub client — fetches skill manifests and downloads skill packages
 * from CrewCentral.
 *
 * Reference: TestCrew src/main/libs/skillHubClient.ts
 */

export interface HubSkillItem {
  id: string
  name?: string
  version?: string
  description?: string
  author?: string
  category?: string
  downloadUrl: string
}

export interface HubManifest {
  version?: number
  items: HubSkillItem[]
}

function joinBaseUrl(baseUrl: string, suffix: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  const s = suffix.startsWith('/') ? suffix : `/${suffix}`
  return `${b}${s}`
}

function deriveApiBase(loginUrl: string): string {
  try {
    const u = new URL(loginUrl)
    const parts = u.pathname.split('/auth/')
    const basePath = parts[0] || ''
    return `${u.origin}${basePath}`
  } catch {
    return 'http://127.0.0.1:5173/woicrew'
  }
}

function getSkillHubBaseUrl(): string {
  // SKILL_HUB_BASE_URL takes priority
  if (process.env.SKILL_HUB_BASE_URL) {
    return process.env.SKILL_HUB_BASE_URL.replace(/\/+$/, '')
  }
  const loginUrl = process.env.CREWCENTRAL_AUTH_LOGIN_URL || ''
  return deriveApiBase(loginUrl)
}

export async function fetchHubManifest(signal?: AbortSignal): Promise<HubManifest> {
  const base = getSkillHubBaseUrl()
  const url = joinBaseUrl(base, '/index.json')
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`Hub manifest HTTP ${res.status}`)
  }
  return (await res.json()) as HubManifest
}

export async function downloadSkillToBuffer(
  url: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`Download failed HTTP ${res.status}`)
  }
  return res.arrayBuffer()
}

/**
 * Fetch the device-specific skill manifest from CrewCentral.
 * Requires a valid access token for authentication.
 */
export async function fetchDeviceManifest(
  accessToken: string,
  signal?: AbortSignal,
): Promise<HubManifest> {
  const base = getSkillHubBaseUrl()
  const url = joinBaseUrl(base, '/api/v1/skills/manifest')
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (!res.ok) {
    throw new Error(`Device skill manifest HTTP ${res.status}`)
  }
  const json = (await res.json()) as { rc?: number; data?: HubManifest }
  if (!json.data) throw new Error('Device skill manifest: no data in response')
  return json.data
}

/**
 * Get a download token for a specific skill.
 */
export async function fetchSkillDownloadToken(
  slug: string,
  accessToken: string,
): Promise<string> {
  const base = getSkillHubBaseUrl()
  const url = joinBaseUrl(base, `/api/v1/skills/${encodeURIComponent(slug)}/download-token`)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Skill download token HTTP ${res.status}`)
  }
  const json = (await res.json()) as { rc?: number; data?: { token?: string } }
  if (!json.data?.token) throw new Error('Skill download token: no token in response')
  return json.data.token
}
