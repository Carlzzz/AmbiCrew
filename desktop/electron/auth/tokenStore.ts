import { kvGet, kvSet, kvDelete } from '../db/database.js'

const KEY_TOKEN = 'auth.token'
const KEY_DISPLAY_NAME = 'auth.displayName'

interface TokenPayload {
  access_token: string
  refresh_token: string
  display_name?: string
}

export function saveTokens(payload: TokenPayload): void {
  kvSet(KEY_TOKEN, JSON.stringify({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  }))
  if (payload.display_name) {
    kvSet(KEY_DISPLAY_NAME, payload.display_name)
  }
}

export function loadTokens(): TokenPayload | null {
  const raw = kvGet(KEY_TOKEN)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { access_token: string; refresh_token: string }
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      display_name: kvGet(KEY_DISPLAY_NAME) || undefined,
    }
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return loadTokens()?.access_token ?? null
}

export function getRefreshToken(): string | null {
  return loadTokens()?.refresh_token ?? null
}

export function getDisplayName(): string | null {
  return kvGet(KEY_DISPLAY_NAME)
}

export function clearTokens(): void {
  kvDelete(KEY_TOKEN)
  kvDelete(KEY_DISPLAY_NAME)
}
