import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { getSkillDirCommands, clearSkillCaches } from '../../skills/loadSkillsDir.js'
import { handleSkillsApi } from '../api/skills.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalClaudeConfigDir: string | undefined
let originalSkillHubBaseUrl: string | undefined
let originalFetch: typeof globalThis.fetch
let originalCwdState: string

function makeRequest(urlStr: string): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), { method: 'GET' })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

async function writeSkill(root: string, skillName: string, content: string): Promise<void> {
  const skillDir = path.join(root, skillName)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
}

function stubHubManifest(items: Array<{ id: string; name?: string; description?: string; version?: string; downloadUrl: string }>) {
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input)
    if (url.endsWith('/index.json')) {
      return new Response(JSON.stringify({ items }))
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

describe('Skills API', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-skills-test-'))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalSkillHubBaseUrl = process.env.SKILL_HUB_BASE_URL
    originalFetch = globalThis.fetch
    originalCwdState = getCwdState()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpHome, '.claude')
    process.env.SKILL_HUB_BASE_URL = 'http://skill-hub.test'
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [] }))) as typeof fetch
    setCwdState(tmpHome)
    clearSkillCaches()
  })

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }

    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }

    if (originalSkillHubBaseUrl === undefined) {
      delete process.env.SKILL_HUB_BASE_URL
    } else {
      process.env.SKILL_HUB_BASE_URL = originalSkillHubBaseUrl
    }
    globalThis.fetch = originalFetch

    setCwdState(originalCwdState)
    clearSkillCaches()
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('lists user and project skills for the requested cwd', async () => {
    const userSkillsRoot = path.join(tmpHome, '.claude', 'skills')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')

    await writeSkill(
      userSkillsRoot,
      'user-skill',
      ['---', 'description: User scope', '---', '', '# User skill'].join('\n'),
    )
    await writeSkill(
      path.join(projectRoot, '.claude', 'skills'),
      'project-skill',
      ['---', 'description: Project scope', '---', '', '# Project skill'].join('\n'),
    )

    const { req, url, segments } = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; source: string }> }
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'user-skill', source: 'user' }))
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'project-skill', source: 'project' }))
  })

  it('reports installed CrewCentral skills with local content length and invocation name', async () => {
    const userSkillsRoot = path.join(tmpHome, '.claude', 'skills')
    const skillContent = ['---', 'description: Hub installed skill', '---', '', '# Hub skill body'].join('\n')

    stubHubManifest([
      {
        id: 'weather',
        name: 'Weather',
        description: 'Hub weather skill',
        version: '1.2.3',
        downloadUrl: 'http://skill-hub.test/weather.zip',
      },
      {
        id: 'not-installed',
        name: 'Not Installed',
        description: 'Available from hub only',
        version: '1.0.0',
        downloadUrl: 'http://skill-hub.test/not-installed.zip',
      },
    ])
    await writeSkill(userSkillsRoot, 'crewcentral_weather', skillContent)

    const { req, url, segments } = makeRequest('/api/skills')
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; source: string; contentLength: number; hasDirectory: boolean }> }
    expect(body.skills).not.toContainEqual(expect.objectContaining({ name: 'crewcentral_weather', source: 'user' }))
    expect(body.skills).toContainEqual(expect.objectContaining({
      name: 'crewcentral:weather',
      source: 'crewcentral',
      contentLength: skillContent.length,
      hasDirectory: true,
    }))

    clearSkillCaches()
    const commands = await getSkillDirCommands(tmpHome)
    expect(commands).toContainEqual(expect.objectContaining({
      name: 'crewcentral:weather',
      source: 'userSettings',
      userInvocable: true,
      contentLength: '# Hub skill body'.length,
    }))
  })

  it('keeps uninstalled CrewCentral skills at zero local content length', async () => {
    stubHubManifest([
      {
        id: 'not-installed',
        name: 'Not Installed',
        description: 'Available from hub only',
        version: '1.0.0',
        downloadUrl: 'http://skill-hub.test/not-installed.zip',
      },
    ])

    const { req, url, segments } = makeRequest('/api/skills')
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; source: string; contentLength: number; hasDirectory: boolean }> }
    expect(body.skills).toContainEqual(expect.objectContaining({
      name: 'crewcentral:not-installed',
      source: 'crewcentral',
      contentLength: 0,
      hasDirectory: false,
    }))
  })

  it('resolves project skill details from the nearest project skills directory', async () => {
    const projectRoot = path.join(tmpHome, 'workspace')
    const nestedRoot = path.join(projectRoot, 'packages', 'app')
    const nestedSkillsRoot = path.join(nestedRoot, '.claude', 'skills')
    const parentSkillsRoot = path.join(projectRoot, '.claude', 'skills')

    await writeSkill(
      parentSkillsRoot,
      'shared-skill',
      ['---', 'description: Parent version', '---', '', 'parent body'].join('\n'),
    )
    await writeSkill(
      nestedSkillsRoot,
      'shared-skill',
      ['---', 'description: Child version', '---', '', 'child body'].join('\n'),
    )

    const { req, url, segments } = makeRequest(
      `/api/skills/detail?source=project&name=shared-skill&cwd=${encodeURIComponent(nestedRoot)}`,
    )
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      detail: { meta: { description: string }; skillRoot: string; files: Array<{ path: string; body?: string }> }
    }

    expect(body.detail.meta.description).toBe('Child version')
    expect(body.detail.skillRoot).toBe(path.join(nestedSkillsRoot, 'shared-skill'))
    expect(body.detail.files).toContainEqual(
      expect.objectContaining({ path: 'SKILL.md', body: 'child body' }),
    )
  })

})
