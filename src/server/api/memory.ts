/**
 * Memory files API — browse and read auto-memory files across projects
 *
 * GET  /api/memory          — List memory files grouped by project
 * GET  /api/memory/file     — Read a specific memory file content
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'

const MEMORY_DIR_NAME = 'memory'
const MEMORY_INDEX_NAME = 'MEMORY.md'

type MemoryFileInfo = {
  name: string
  path: string
  description: string
  type: string
  modifiedAt: string
}

type ProjectMemory = {
  projectPath: string
  projectName: string
  files: MemoryFileInfo[]
  indexExists: boolean
}

type ListResponse = {
  projects: ProjectMemory[]
  totalFiles: number
}

function getProjectsDir(): string {
  const configHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configHome, 'projects')
}

function unsanitizePath(sanitized: string): string {
  return sanitized.replace(/-/g, path.sep)
}

export async function handleMemoryApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  const sub = segments[2]

  if (!sub && req.method === 'GET') {
    return listMemoryFiles(url)
  }

  if (sub === 'file' && req.method === 'GET') {
    return readMemoryFile(url)
  }

  return json({ error: 'Not found' }, 404)
}

async function listMemoryFiles(_url: URL): Promise<Response> {
  const projectsDir = getProjectsDir()
  let projectDirs: string[]

  try {
    projectDirs = await fs.readdir(projectsDir)
  } catch {
    return json({ projects: [], totalFiles: 0 })
  }

  const projects: ProjectMemory[] = []
  let totalFiles = 0

  for (const sanitizedDir of projectDirs) {
    const memoryDir = path.join(projectsDir, sanitizedDir, MEMORY_DIR_NAME)
    let entries: string[]
    try {
      entries = await fs.readdir(memoryDir)
    } catch {
      continue
    }

    const mdFiles = entries.filter((e) => e.endsWith('.md'))
    if (mdFiles.length === 0) continue

    const projectPath = unsanitizePath(sanitizedDir)
    const projectName = projectPath.split(/[/\\]/).pop() || projectPath
    const indexExists = mdFiles.includes(MEMORY_INDEX_NAME)

    const files: MemoryFileInfo[] = []
    for (const fileName of mdFiles) {
      if (fileName === MEMORY_INDEX_NAME) continue
      const filePath = path.join(memoryDir, fileName)
      try {
        const stat = await fs.stat(filePath)
        const content = await fs.readFile(filePath, 'utf-8')
        const { frontmatter } = parseFrontmatter(content)
        files.push({
          name: fileName.replace('.md', ''),
          path: filePath,
          description: (frontmatter as Record<string, unknown>)?.description as string || '',
          type: (frontmatter as Record<string, unknown>)?.metadata?.type as string || 'unknown',
          modifiedAt: stat.mtime.toISOString(),
        })
      } catch {
        files.push({
          name: fileName.replace('.md', ''),
          path: filePath,
          description: '',
          type: 'unknown',
          modifiedAt: new Date().toISOString(),
        })
      }
    }

    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    totalFiles += files.length

    projects.push({ projectPath, projectName, files, indexExists })
  }

  projects.sort((a, b) => {
    const aLatest = a.files[0]?.modifiedAt || ''
    const bLatest = b.files[0]?.modifiedAt || ''
    return bLatest.localeCompare(aLatest)
  })

  return json({ projects, totalFiles })
}

async function readMemoryFile(url: URL): Promise<Response> {
  const filePath = url.searchParams.get('path')
  if (!filePath) {
    return json({ error: 'Missing path parameter' }, 400)
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter(content)
    const stat = await fs.stat(filePath)
    return json({
      path: filePath,
      name: path.basename(filePath, '.md'),
      content,
      frontmatter,
      body,
      modifiedAt: stat.mtime.toISOString(),
    })
  } catch {
    return json({ error: 'File not found' }, 404)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
