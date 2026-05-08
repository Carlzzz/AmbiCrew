import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'

interface StoredPayload {
  v: 1
  access_token: string
  refresh_token: string
  display_name?: string
}

interface TokenPayload {
  access_token: string
  refresh_token: string
  display_name?: string
}

function filePath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(dir, 'central-auth.json')
}

let cached: StoredPayload | null = null

function readCache(): StoredPayload | null {
  if (cached) return cached
  try {
    const raw = readFileSync(filePath(), 'utf-8')
    const parsed = JSON.parse(raw) as StoredPayload
    if (parsed && parsed.v === 1 && parsed.access_token && parsed.refresh_token) {
      cached = parsed
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function writeCache(payload: StoredPayload): void {
  cached = payload
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath(), JSON.stringify(payload), 'utf-8')
}

export function saveTokens(payload: TokenPayload): void {
  writeCache({
    v: 1,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    display_name: payload.display_name,
  })
}

export function loadTokens(): TokenPayload | null {
  const stored = readCache()
  if (!stored) return null
  return {
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    display_name: stored.display_name,
  }
}

export function getAccessToken(): string | null {
  return readCache()?.access_token ?? null
}

export function getRefreshToken(): string | null {
  return readCache()?.refresh_token ?? null
}

export function getDisplayName(): string | null {
  return readCache()?.display_name ?? null
}

export function clearTokens(): void {
  cached = null
  try {
    if (existsSync(filePath())) unlinkSync(filePath())
  } catch {
    // file may not exist
  }
}

/** Invalidate the in-memory cache so the next read hits disk. */
export function invalidateCache(): void {
  cached = null
}
