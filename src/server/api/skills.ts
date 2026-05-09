/**
 * Skills REST API
 *
 * GET  /api/skills              — List all installed skills (metadata only)
 * GET  /api/skills/detail       — Full skill data (tree + files)
 *        ?source=user&name=xxx
 * POST /api/skills/install      — Download & install a hub skill
 *        { skillSlug: string, version?: string }
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'
import { execSync } from 'child_process'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getProjectDirsUpToHome } from '../../utils/markdownConfigLoader.js'
import { getCwd } from '../../utils/cwd.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  fetchHubManifest,
  fetchDeviceManifest,
  fetchSkillDownloadToken,
  downloadSkillToBuffer,
  type HubSkillItem,
} from '../../services/central/skill-client.js'
import {
  getAccessToken,
  loadTokens,
} from '../../services/central/token-store.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type SkillMeta = {
  name: string
  displayName?: string
  description: string
  source: 'user' | 'project' | 'plugin' | 'crewcentral'
  userInvocable: boolean
  version?: string
  contentLength: number
  hasDirectory: boolean
  pluginName?: string
}

type SkillSource = SkillMeta['source']

type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

type SkillFile = {
  path: string
  content: string
  language: string
  frontmatter?: Record<string, unknown>
  body?: string
  isEntry?: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILES = 50
const MAX_FILE_SIZE = 100 * 1024 // 100 KB
const SKIP_ENTRIES = new Set(['node_modules', '.git', '__pycache__', '.DS_Store'])

const LANG_MAP: Record<string, string> = {
  md: 'markdown', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', json: 'json',
  yaml: 'yaml', yml: 'yaml', sh: 'bash', bash: 'bash',
  py: 'python', toml: 'toml', css: 'css', html: 'html',
  txt: 'text', xml: 'xml', sql: 'sql', rs: 'rust', go: 'go',
}

// ─── Hub manifest cache ──────────────────────────────────────────────────────

let hubManifestCache: { items: HubSkillItem[]; ts: number } | null = null
const HUB_CACHE_TTL_MS = 120_000 // 2 min

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANG_MAP[ext] || 'text'
}

function normalizeFrontmatter(content: string, sourcePath?: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const parsed = parseFrontmatter(content, sourcePath)
  return {
    frontmatter: parsed.frontmatter as Record<string, unknown>,
    body: parsed.content,
  }
}

function getUserSkillsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'skills')
}

function getRequestedCwd(url: URL): string {
  return url.searchParams.get('cwd') || getCwd()
}

function getProjectSkillsDirs(cwd: string): string[] {
  return getProjectDirsUpToHome('skills', cwd)
}

async function loadSkillMeta(
  skillDir: string,
  skillName: string,
  source: SkillSource,
  pluginName?: string,
): Promise<SkillMeta | null> {
  const skillFile = path.join(skillDir, 'SKILL.md')
  try {
    const raw = await fs.readFile(skillFile, 'utf-8')
    const { frontmatter, body } = normalizeFrontmatter(raw, skillFile)

    const description =
      (frontmatter.description as string) ||
      body
        .split('\n')
        .find((l) => l.trim().length > 0)
        ?.trim() ||
      'No description'

    return {
      name: skillName,
      displayName: (frontmatter.name as string) || undefined,
      description,
      source,
      userInvocable: frontmatter['user-invocable'] !== false,
      version: frontmatter.version != null ? String(frontmatter.version) : undefined,
      contentLength: raw.length,
      hasDirectory: true,
      pluginName,
    }
  } catch {
    return null
  }
}

async function buildFileTree(
  dirPath: string,
): Promise<{ tree: FileTreeNode[]; files: SkillFile[] }> {
  const tree: FileTreeNode[] = []
  const files: SkillFile[] = []
  let fileCount = 0

  async function walk(currentPath: string, nodes: FileTreeNode[]) {
    if (fileCount >= MAX_FILES) return

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    // directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (fileCount >= MAX_FILES) break
      if (SKIP_ENTRIES.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = path.join(currentPath, entry.name)
      const relPath = path.relative(dirPath, fullPath)

      if (entry.isDirectory()) {
        const node: FileTreeNode = {
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: [],
        }
        nodes.push(node)
        await walk(fullPath, node.children!)
        if (node.children!.length === 0) delete node.children
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: relPath, type: 'file' })

        try {
          const stat = await fs.stat(fullPath)
          if (stat.size <= MAX_FILE_SIZE) {
            const content = await fs.readFile(fullPath, 'utf-8')
            const language = detectLanguage(entry.name)
            const isEntry = relPath === 'SKILL.md'

            if (isEntry && language === 'markdown') {
              const { frontmatter, body } = normalizeFrontmatter(content, fullPath)
              files.push({
                path: relPath,
                content: body,
                body,
                frontmatter,
                language,
                isEntry: true,
              })
            } else {
              files.push({
                path: relPath,
                content,
                language,
                isEntry: false,
              })
            }
            fileCount++
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(dirPath, tree)
  return { tree, files }
}

async function collectSkillsFromRoots(
  skillRoots: string[],
  source: SkillSource,
): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = []
  const seenNames = new Set<string>()

  for (const root of skillRoots) {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || seenNames.has(entry.name)) {
        continue
      }

      const meta = await loadSkillMeta(path.join(root, entry.name), entry.name, source)
      if (!meta) continue

      seenNames.add(entry.name)
      skills.push(meta)
    }
  }

  return skills
}

async function resolveSkillDir(
  source: SkillSource,
  name: string,
  cwd: string,
): Promise<string | null> {
  const skillRoots =
    source === 'user'
      ? [getUserSkillsDir()]
      : source === 'project'
        ? getProjectSkillsDirs(cwd)
        : []

  for (const root of skillRoots) {
    const skillDir = path.join(root, name)
    try {
      const stat = await fs.stat(skillDir)
      if (stat.isDirectory()) {
        return skillDir
      }
    } catch {
      // Try the next candidate root.
    }
  }

  return null
}

type PluginSkillLocation = {
  skillDir: string
  pluginName: string
}

function buildPluginSkillName(pluginName: string, skillDir: string): string {
  return `${pluginName}:${path.basename(skillDir)}`
}

async function collectPluginSkillDirectories(): Promise<Map<string, PluginSkillLocation>> {
  const locations = new Map<string, PluginSkillLocation>()

  let enabledPlugins: LoadedPlugin[]
  try {
    const result = await loadAllPluginsCacheOnly()
    enabledPlugins = result.enabled
  } catch {
    return locations
  }

  for (const plugin of enabledPlugins) {
    const candidateRoots = [plugin.skillsPath, ...(plugin.skillsPaths ?? [])]

    for (const root of candidateRoots) {
      if (!root) continue

      const directSkillFile = path.join(root, 'SKILL.md')
      try {
        const stat = await fs.stat(directSkillFile)
        if (stat.isFile()) {
          const name = buildPluginSkillName(plugin.name, root)
          if (!locations.has(name)) {
            locations.set(name, { skillDir: root, pluginName: plugin.name })
          }
          continue
        }
      } catch {
        // Fall through and inspect as a skills root.
      }

      let entries: import('fs').Dirent[]
      try {
        entries = await fs.readdir(root, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

        const skillDir = path.join(root, entry.name)
        const skillFile = path.join(skillDir, 'SKILL.md')
        try {
          const stat = await fs.stat(skillFile)
          if (!stat.isFile()) continue
        } catch {
          continue
        }

        const name = buildPluginSkillName(plugin.name, skillDir)
        if (!locations.has(name)) {
          locations.set(name, { skillDir, pluginName: plugin.name })
        }
      }
    }
  }

  return locations
}

async function collectPluginSkills(): Promise<SkillMeta[]> {
  const locations = await collectPluginSkillDirectories()
  const skills: SkillMeta[] = []

  for (const [name, location] of locations) {
    const meta = await loadSkillMeta(
      location.skillDir,
      name,
      'plugin',
      location.pluginName,
    )
    if (meta) {
      skills.push(meta)
    }
  }

  return skills
}

// ─── CrewCentral hub skills ──────────────────────────────────────────────────

async function getAccessTokenForHub(): Promise<string | null> {
  let token = getAccessToken()
  if (token) return token
  const payload = await loadTokens()
  return payload?.access_token ?? null
}

async function fetchHubItems(): Promise<HubSkillItem[]> {
  const now = Date.now()
  if (hubManifestCache && now - hubManifestCache.ts < HUB_CACHE_TTL_MS) {
    return hubManifestCache.items
  }

  const merged = new Map<string, HubSkillItem>()

  // 1. Public index.json — no auth required, matches TestCrew's approach
  try {
    const publicManifest = await fetchHubManifest()
    for (const item of publicManifest.items) {
      merged.set(item.id, item)
    }
  } catch {
    // Public manifest unavailable — will try authenticated endpoint below
  }

  // 2. Device-specific manifest (authenticated) — supplements public index
  const token = await getAccessTokenForHub()
  if (token) {
    try {
      const deviceManifest = await fetchDeviceManifest(token)
      for (const item of deviceManifest.items) {
        // Device-specific entries override public ones (e.g. with config)
        merged.set(item.id, item)
      }
    } catch {
      // Device manifest unavailable — public items are sufficient
    }
  }

  const items = Array.from(merged.values())
  if (items.length > 0) {
    hubManifestCache = { items, ts: now }
  }
  return items
}

async function hubItemToSkillMeta(item: HubSkillItem): Promise<SkillMeta> {
  const name = `crewcentral:${item.id}`
  const existingDir = path.join(getUserSkillsDir(), name)
  let hasDirectory = false
  try {
    const stat = await fs.stat(existingDir)
    hasDirectory = stat.isDirectory()
  } catch {
    // Not installed locally
  }

  return {
    name,
    displayName: item.name || item.id,
    description: item.description || `Hub skill: ${item.id}`,
    source: 'crewcentral',
    userInvocable: true,
    version: item.version,
    contentLength: 0,
    hasDirectory,
    pluginName: item.author,
  }
}

async function collectHubSkills(): Promise<SkillMeta[]> {
  const items = await fetchHubItems()
  return Promise.all(items.map(hubItemToSkillMeta))
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function handleSkillsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    switch (sub) {
      case undefined:
        if (req.method === 'GET') return await listSkills(url)
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      case 'detail':
        if (req.method === 'GET') return await getSkillDetail(url)
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      case 'install':
        if (req.method === 'POST') return await installHubSkill(req)
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      default:
        throw ApiError.notFound(`Unknown skills endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function listSkills(url: URL): Promise<Response> {
  const cwd = getRequestedCwd(url)
  const [userSkills, projectSkills, pluginSkills, hubSkills] = await Promise.all([
    collectSkillsFromRoots([getUserSkillsDir()], 'user'),
    collectSkillsFromRoots(getProjectSkillsDirs(cwd), 'project'),
    collectPluginSkills(),
    collectHubSkills(),
  ])

  const skills = [...userSkills, ...projectSkills, ...pluginSkills, ...hubSkills]
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return Response.json({ skills })
}

async function getSkillDetail(url: URL): Promise<Response> {
  const source = url.searchParams.get('source')
  const name = url.searchParams.get('name')

  if (!source || !name) {
    throw ApiError.badRequest('Missing required query parameters: source, name')
  }

  // Prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw ApiError.badRequest('Invalid skill name')
  }

  // CrewCentral skills — return hub metadata (may not be installed locally)
  if (source === 'crewcentral') {
    const slug = name.startsWith('crewcentral:') ? name.slice('crewcentral:'.length) : name
    const items = await fetchHubItems()
    const item = items.find((i) => i.id === slug)
    if (!item) {
      throw ApiError.notFound(`Hub skill not found: ${slug}`)
    }

    const meta = await hubItemToSkillMeta(item)
    // If installed locally, return full detail
    if (meta.hasDirectory) {
      const skillDir = path.join(getUserSkillsDir(), name)
      const { tree, files } = await buildFileTree(skillDir)
      return Response.json({ detail: { meta, tree, files, skillRoot: skillDir }, hubItem: item })
    }

    // Not installed — return metadata only, no file tree
    return Response.json({
      detail: {
        meta,
        tree: [],
        files: [],
        skillRoot: '',
        installable: true,
        hubItem: item,
      },
    })
  }

  if (source !== 'user' && source !== 'project' && source !== 'plugin') {
    throw ApiError.badRequest(`Unsupported source: ${source}`)
  }

  const cwd = getRequestedCwd(url)
  const pluginLocations =
    source === 'plugin' ? await collectPluginSkillDirectories() : null

  const pluginLocation = pluginLocations?.get(name)
  const skillDir =
    source === 'plugin'
      ? pluginLocation?.skillDir ?? null
      : await resolveSkillDir(source, name, cwd)

  if (!skillDir) {
    throw ApiError.notFound(`Skill not found: ${name}`)
  }

  const meta = await loadSkillMeta(
    skillDir,
    name,
    source,
    pluginLocation?.pluginName,
  )
  if (!meta) {
    throw ApiError.notFound(`Skill missing SKILL.md: ${name}`)
  }

  const { tree, files } = await buildFileTree(skillDir)

  return Response.json({
    detail: { meta, tree, files, skillRoot: skillDir },
  })
}

// ─── Install handler ─────────────────────────────────────────────────────────

async function installHubSkill(req: Request): Promise<Response> {
  let body: { skillSlug?: string; version?: string }
  try {
    body = (await req.json()) as { skillSlug?: string; version?: string }
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }

  const { skillSlug, version: _version } = body
  if (!skillSlug) {
    throw ApiError.badRequest('Missing required field: skillSlug')
  }

  // Look up the hub item to get its downloadUrl
  const items = await fetchHubItems()
  const hubItem = items.find((i) => i.id === skillSlug)
  let downloadUrl = hubItem?.downloadUrl

  // If no public downloadUrl, try authenticated download token
  if (!downloadUrl) {
    const token = await getAccessTokenForHub()
    if (!token) {
      throw new ApiError(401, 'Not authenticated with CrewCentral', 'UNAUTHORIZED')
    }
    const downloadToken = await fetchSkillDownloadToken(skillSlug, token)
    const baseUrl = process.env.SKILL_HUB_BASE_URL ||
      (process.env.CREWCENTRAL_AUTH_LOGIN_URL
        ? (() => {
            try {
              const u = new URL(process.env.CREWCENTRAL_AUTH_LOGIN_URL!)
              const parts = u.pathname.split('/auth/')
              return `${u.origin}${parts[0] || ''}`
            } catch { return 'http://127.0.0.1:5173/woicrew' }
          })()
        : 'http://127.0.0.1:5173/woicrew')
    downloadUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1/skills/download?token=${encodeURIComponent(downloadToken)}`
  }

  // Download ZIP
  let zipBuffer: ArrayBuffer
  try {
    zipBuffer = await downloadSkillToBuffer(downloadUrl)
  } catch (err) {
    throw new ApiError(502, `Failed to download skill: ${err instanceof Error ? err.message : String(err)}`, 'DOWNLOAD_FAILED')
  }

  // Extract to user skills directory
  const skillName = `crewcentral:${skillSlug}`
  const targetDir = path.join(getUserSkillsDir(), skillName)
  await fs.mkdir(targetDir, { recursive: true })

  // Write ZIP to temp file and extract
  const tmpZip = path.join(os.tmpdir(), `skill-${skillSlug}-${Date.now()}.zip`)
  try {
    await fs.writeFile(tmpZip, Buffer.from(zipBuffer))

    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${targetDir}' -Force"`,
        { timeout: 30_000 },
      )
    } else {
      execSync(`unzip -o "${tmpZip}" -d "${targetDir}"`, { timeout: 30_000 })
    }
  } finally {
    try { await fs.unlink(tmpZip) } catch { /* cleanup best-effort */ }
  }

  // Invalidate hub cache so listSkills picks up hasDirectory=true
  hubManifestCache = null

  return Response.json({
    ok: true,
    skillName,
    skillDir: targetDir,
  })
}
