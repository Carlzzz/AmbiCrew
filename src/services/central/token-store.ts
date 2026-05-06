import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export interface CentralAuthTokens {
  access_token: string
  refresh_token: string
  display_name?: string
}

interface StoredPayload {
  v: 1
  access_token: string
  refresh_token: string
  display_name?: string
}

const AUTH_FILE = 'central-auth.json'

function filePath(): string {
  return join(getClaudeConfigHomeDir(), AUTH_FILE)
}

let cached: StoredPayload | null = null

export function getAccessToken(): string | null {
  return cached?.access_token ?? null
}

export function getRefreshToken(): string | null {
  return cached?.refresh_token ?? null
}

export function getDisplayName(): string | null {
  return cached?.display_name ?? null
}

export async function saveTokens(tokens: CentralAuthTokens): Promise<void> {
  const payload: StoredPayload = {
    v: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    display_name: tokens.display_name,
  }
  cached = payload
  const dir = getClaudeConfigHomeDir()
  await mkdir(dir, { recursive: true })
  await writeFile(filePath(), JSON.stringify(payload), 'utf-8')
}

export async function loadTokens(): Promise<StoredPayload | null> {
  try {
    const raw = await readFile(filePath(), 'utf-8')
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

export async function clearTokens(): Promise<void> {
  cached = null
  try {
    await unlink(filePath())
  } catch {
    // file may not exist
  }
}
