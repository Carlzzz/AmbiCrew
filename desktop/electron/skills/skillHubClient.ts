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

export async function listHubSkills(): Promise<HubSkillItem[]> {
  const base = getSkillHubBaseUrl()
  const resp = await fetch(`${base}/api/v1/skills/hub`)
  if (!resp.ok) throw new Error(`Skill hub returned ${resp.status}`)
  const json = await resp.json() as { data?: { items?: HubSkillItem[] } }
  return json.data?.items || []
}

export async function downloadSkill(slug: string, version: string): Promise<void> {
  const base = getSkillHubBaseUrl()
  const resp = await fetch(`${base}/api/v1/skills/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, version }),
  })
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
}
