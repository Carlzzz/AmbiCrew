/**
 * Filesystem browser & search API — supports directory browsing and file search
 * for the DirectoryPicker component and @-triggered file search popup.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execSync } from 'child_process'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const target = normalizeComparablePath(targetPath)
  const root = normalizeComparablePath(rootPath)
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function normalizeComparablePath(filePath: string): string {
  let resolved = path.resolve(filePath)
  // On Windows, normalize drive roots: "C:" → "C:\" to avoid confusion
  if (process.platform === 'win32' && /^[A-Za-z]:$/.test(resolved)) {
    resolved += '\\'
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isAllowedFilesystemPath(targetPath: string): boolean {
  const resolvedPath = path.resolve(targetPath)
  const homeDir = path.resolve(os.homedir())

  if (isWithinRoot(resolvedPath, homeDir) || isWithinRoot(resolvedPath, '/tmp')) {
    return true
  }

  // macOS reports /tmp as /private/tmp via native folder pickers and realpath().
  if (process.platform === 'darwin' && isWithinRoot(resolvedPath, '/private/tmp')) {
    return true
  }

  // Windows: allow any local drive root (C:\, D:\, etc.) since users commonly
  // have projects on non-system drives. The path must be an absolute drive path.
  if (process.platform === 'win32' && /^[A-Za-z]:[/\\]/.test(resolvedPath)) {
    return true
  }

  return false
}

export async function handleFilesystemRoute(pathname: string, url: URL): Promise<Response> {
  if (pathname === '/api/filesystem/browse') {
    return handleBrowse(url)
  }

  if (pathname === '/api/filesystem/file') {
    return handleServeFile(url)
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
}

async function handleServeFile(url: URL): Promise<Response> {
  const filePath = url.searchParams.get('path')
  if (!filePath) {
    return json({ error: 'Missing path parameter' }, 400)
  }

  const resolvedPath = path.resolve(filePath)

  if (!isAllowedFilesystemPath(resolvedPath)) {
    return json({ error: 'Access denied: path outside allowed directory' }, 403)
  }

  const ext = path.extname(resolvedPath).toLowerCase()
  const mimeType = IMAGE_MIME_TYPES[ext]

  if (!mimeType) {
    return json({ error: 'Unsupported file type' }, 400)
  }

  try {
    const stat = fs.statSync(resolvedPath)
    if (!stat.isFile()) {
      return json({ error: 'Not a file' }, 400)
    }
    // Limit to 50MB
    if (stat.size > 50 * 1024 * 1024) {
      return json({ error: 'File too large' }, 400)
    }

    const data = fs.readFileSync(resolvedPath)
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(stat.size),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return json({ error: 'File not found' }, 404)
  }
}

async function handleBrowse(url: URL): Promise<Response> {
  const targetPath = url.searchParams.get('path') || os.homedir() || '/'
  const resolvedPath = path.resolve(targetPath)

  if (!isAllowedFilesystemPath(resolvedPath)) {
    return json({ error: 'Access denied: path outside allowed directory' }, 403)
  }

  const searchQuery = url.searchParams.get('search') || ''
  const includeFiles = url.searchParams.get('includeFiles') === 'true'
  const maxResults = Math.min(parseInt(url.searchParams.get('maxResults') || '200', 10), 200)

  try {
    const stat = fs.statSync(resolvedPath)
    if (!stat.isDirectory()) {
      return json({ error: 'Not a directory', path: resolvedPath }, 400)
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const maxResultsLimit = maxResults
      const results = await gitFirstSearch(resolvedPath, query, includeFiles, maxResultsLimit)

      results.sort((a, b) => {
        const aBase = path.basename(a.path).toLowerCase()
        const bBase = path.basename(b.path).toLowerCase()
        const aExact = aBase === query
        const bExact = bBase === query
        if (aExact !== bExact) return aExact ? -1 : 1
        const aDepth = a.name.split('/').length
        const bDepth = b.name.split('/').length
        if (aDepth !== bDepth) return aDepth - bDepth
        return a.name.localeCompare(b.name)
      })

      return json({
        currentPath: resolvedPath,
        parentPath: path.dirname(resolvedPath),
        entries: results.slice(0, maxResultsLimit),
        query: searchQuery,
      })
    }

    // Browse mode: show all directories (and optionally files)
    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true })
    const filtered = entries.filter((e) => {
      if (e.isDirectory()) return true
      return includeFiles
    })

    const entries_list = filtered
      .map((e) => ({
        name: e.name,
        path: path.join(resolvedPath, e.name),
        isDirectory: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return json({
      currentPath: resolvedPath,
      parentPath: path.dirname(resolvedPath),
      entries: entries_list,
    })
  } catch (err) {
    return json({ error: `Cannot read directory: ${err}`, path: resolvedPath }, 500)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type SearchEntry = { name: string; path: string; isDirectory: boolean }

/**
 * Git-first file search: uses `git ls-files` (tracked + untracked with
 * exclude-standard) for git repos, falls back to recursive walk for non-git dirs.
 * This respects .gitignore and naturally excludes node_modules, build artifacts, etc.
 */
async function gitFirstSearch(
  rootPath: string,
  query: string,
  includeFiles: boolean,
  maxResults: number,
): Promise<SearchEntry[]> {
  const gitFiles = tryGitLsFiles(rootPath)
  if (gitFiles !== null) {
    return filterGitResults(rootPath, gitFiles, query, includeFiles, maxResults)
  }
  return fallbackWalkSearch(rootPath, query, includeFiles, maxResults)
}

function tryGitLsFiles(cwd: string): string[] | null {
  try {
    // Get tracked files + untracked (but respecting .gitignore via --exclude-standard)
    const output = execSync(
      'git ls-files --cached --others --exclude-standard',
      { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 5000 },
    )
    return output.split('\n').filter(Boolean)
  } catch {
    return null
  }
}

function filterGitResults(
  rootPath: string,
  files: string[],
  query: string,
  includeFiles: boolean,
  maxResults: number,
): SearchEntry[] {
  const results: SearchEntry[] = []
  const seenDirs = new Set<string>()

  for (const relativePath of files) {
    if (results.length >= maxResults) break
    const basename = path.basename(relativePath).toLowerCase()
    const relLower = relativePath.toLowerCase()

    if (basename.includes(query) || relLower.includes(query)) {
      const fullPath = path.join(rootPath, relativePath)
      // Check if it's a directory entry (git ls-files only lists files,
      // but we can infer directories from path segments)
      if (includeFiles) {
        results.push({
          name: relativePath.replace(/\\/g, '/'),
          path: fullPath,
          isDirectory: false,
        })
      }
    }

    // Also match directory segments
    const dirParts = path.dirname(relativePath).split(/[/\\]/)
    let dirAccum = ''
    for (const part of dirParts) {
      if (!part || part === '.') continue
      dirAccum = dirAccum ? `${dirAccum}/${part}` : part
      if (part.toLowerCase().includes(query) && !seenDirs.has(dirAccum)) {
        seenDirs.add(dirAccum)
        if (results.length < maxResults) {
          results.push({
            name: dirAccum,
            path: path.join(rootPath, dirAccum),
            isDirectory: true,
          })
        }
      }
    }
  }

  return results
}

function fallbackWalkSearch(
  rootPath: string,
  query: string,
  includeFiles: boolean,
  maxResults: number,
): SearchEntry[] {
  const results: SearchEntry[] = []
  const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.venv', '.cache'])
  const MAX_DEPTH = 8

  const walk = (dir: string, depth: number) => {
    if (results.length >= maxResults || depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (results.length >= maxResults) return
      const isDir = e.isDirectory()
      if (isDir && IGNORED_DIRS.has(e.name)) continue
      const fullPath = path.join(dir, e.name)
      if (e.name.toLowerCase().includes(query)) {
        if (isDir || includeFiles) {
          results.push({
            name: path.relative(rootPath, fullPath).replace(/\\/g, '/'),
            path: fullPath,
            isDirectory: isDir,
          })
        }
      }
      if (isDir) {
        walk(fullPath, depth + 1)
      }
    }
  }

  walk(rootPath, 0)
  return results
}
