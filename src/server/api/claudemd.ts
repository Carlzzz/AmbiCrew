/**
 * CLAUDE.md file management API
 *
 * GET  /api/claudemd         — List CLAUDE.md files across all levels
 * GET  /api/claudemd/file    — Read file content (+ frontmatter)
 * POST /api/claudemd/file    — Create or update a file
 * DELETE /api/claudemd/file  — Delete a file
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { ApiError } from '../middleware/errorHandler.js'

const PROJECT_FILE_NAMES = ['CLAUDE.md', 'CLAUDE.local.md']
const DOT_CLAUDE_DIR = '.claude'
const RULES_DIR = '.claude/rules'

type FileInfo = {
  name: string
  path: string
  exists: boolean
  level: 'user' | 'project' | 'project-local' | 'rules'
  projectPath?: string
}

type ProjectFiles = {
  projectPath: string
  files: FileInfo[]
}

type ListResponse = {
  user: FileInfo
  projects: ProjectFiles[]
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getUserClaudeMdPath(): string {
  return path.join(getClaudeConfigHomeDir(), 'CLAUDE.md')
}

function getProjectDir(workDir: string): string {
  // Walk up from workDir to find the git root, stop at home dir
  let current = path.resolve(workDir)
  const home = os.homedir()
  while (current !== path.dirname(current) && current !== home) {
    if (fs.existsSync(path.join(current, '.git'))) return current
    current = path.dirname(current)
  }
  return path.resolve(workDir)
}

function scanProjectFiles(projectDir: string): FileInfo[] {
  const files: FileInfo[] = []

  for (const name of PROJECT_FILE_NAMES) {
    const filePath = path.join(projectDir, name)
    files.push({
      name,
      path: filePath,
      exists: fs.existsSync(filePath),
      level: name === 'CLAUDE.local.md' ? 'project-local' : 'project',
      projectPath: projectDir,
    })
  }

  // .claude/CLAUDE.md
  const dotClaudeFile = path.join(projectDir, DOT_CLAUDE_DIR, 'CLAUDE.md')
  files.push({
    name: '.claude/CLAUDE.md',
    path: dotClaudeFile,
    exists: fs.existsSync(dotClaudeFile),
    level: 'project',
    projectPath: projectDir,
  })

  // .claude/rules/*.md
  const rulesDir = path.join(projectDir, RULES_DIR)
  if (fs.existsSync(rulesDir)) {
    try {
      for (const entry of fs.readdirSync(rulesDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const rulePath = path.join(rulesDir, entry.name)
          files.push({
            name: `.claude/rules/${entry.name}`,
            path: rulePath,
            exists: true,
            level: 'rules',
            projectPath: projectDir,
          })
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return files
}

async function handleList(req: Request, url: URL): Promise<Response> {
  const workDir = url.searchParams.get('workDir') || ''
  const allProjects = url.searchParams.get('all') === 'true'

  const userPath = getUserClaudeMdPath()
  const userFile: FileInfo = {
    name: 'CLAUDE.md',
    path: userPath,
    exists: fs.existsSync(userPath),
    level: 'user',
  }

  const projects: ProjectFiles[] = []

  if (workDir) {
    const projectDir = getProjectDir(workDir)
    projects.push({
      projectPath: projectDir,
      files: scanProjectFiles(projectDir),
    })
  }

  if (allProjects && workDir) {
    // Scan parent directories up to home
    const home = os.homedir()
    const startDir = path.dirname(getProjectDir(workDir))
    let current = startDir
    while (current !== path.dirname(current) && current !== home && current.length > home.length) {
      if (fs.existsSync(path.join(current, '.git'))) {
        projects.push({
          projectPath: current,
          files: scanProjectFiles(current),
        })
      }
      current = path.dirname(current)
    }
  }

  return json({ user: userFile, projects })
}

async function handleReadFile(url: URL): Promise<Response> {
  const filePath = url.searchParams.get('path')
  if (!filePath) {
    throw ApiError.badRequest('Missing path parameter')
  }

  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw ApiError.notFound('File not found')
  }

  const content = fs.readFileSync(resolved, 'utf-8')
  const { frontmatter, content: body } = parseFrontmatter(content, resolved)

  return json({
    path: resolved,
    content,
    frontmatter,
    body,
    name: path.basename(resolved),
  })
}

async function handleWriteFile(req: Request): Promise<Response> {
  const body = await req.json().catch(() => {
    throw ApiError.badRequest('Invalid JSON body')
  })
  const { path: filePath, content } = body
  if (!filePath || content === undefined) {
    throw ApiError.badRequest('Missing path or content')
  }

  const resolved = path.resolve(filePath)
  const dir = path.dirname(resolved)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(resolved, content, 'utf-8')
  return json({ ok: true, path: resolved })
}

async function handleDeleteFile(req: Request): Promise<Response> {
  const body = await req.json().catch(() => {
    throw ApiError.badRequest('Invalid JSON body')
  })
  const { path: filePath } = body
  if (!filePath) {
    throw ApiError.badRequest('Missing path')
  }

  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw ApiError.notFound('File not found')
  }

  fs.unlinkSync(resolved)
  return json({ ok: true, path: resolved })
}

export async function handleClaudeMdApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    switch (sub) {
      case undefined:
        if (req.method !== 'GET') {
          throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
        }
        return await handleList(req, url)

      case 'file': {
        switch (req.method) {
          case 'GET':
            return await handleReadFile(url)
          case 'POST':
            return await handleWriteFile(req)
          case 'DELETE':
            return await handleDeleteFile(req)
          default:
            throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
        }
      }

      default:
        throw ApiError.notFound(`Unknown claudemd endpoint: ${sub}`)
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message, code: error.code }, error.status)
    }
    console.error('[claudemd] API error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
}
