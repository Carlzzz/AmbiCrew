import { getAccessToken, invalidateCache } from '../auth/tokenStore.js'

export interface HubSkillItem {
  slug: string
  name: string
  version: string
  description?: string
  package_hash?: string
}

export interface DeviceManifestSkill {
  skill_slug: string
  name: string
  version: string
  description?: string
  package_hash?: string
  config?: Record<string, unknown>
}

function getSkillHubBaseUrl(): string {
  if (process.env.SKILL_HUB_BASE_URL) {
    return process.env.SKILL_HUB_BASE_URL.replace(/\/+$/, '')
  }
  return 'http://127.0.0.1:1420/woicrew'
}

function authHeaders(): Record<string, string> {
  invalidateCache()
  const token = getAccessToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export async function listHubSkills(): Promise<HubSkillItem[]> {
  const base = getSkillHubBaseUrl()
  const headers = { ...authHeaders() }
  const resp = await fetch(`${base}/api/v1/skills/hub`, { headers })
  if (!resp.ok) throw new Error(`Skill hub returned ${resp.status}`)
  const json = await resp.json() as { data?: { items?: HubSkillItem[] } }
  return json.data?.items || []
}

export async function downloadSkill(slug: string, version: string): Promise<void> {
  const base = getSkillHubBaseUrl()
  const resp = await fetch(`${base}/api/v1/skills/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ slug, version }),
  })
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
}
