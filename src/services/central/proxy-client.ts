/**
 * CrewProxy client — fetches model list from CrewProxy and handles health checks.
 *
 * Adapted from TestCrew src/main/llm/proxyClient.ts.
 * Reference: TestCrew src/main/llm/proxyClient.ts
 */

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'])

export type ProxyErrorCategory =
  | 'NETWORK_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR'
  | 'UNKNOWN'

export interface ProxyModelItem {
  modelId: string
  modelAlias: string
  imageSupport?: boolean
  contextWindow?: number
}

/**
 * Parse raw /models items into ProxyModelItem[]. Extracted as a pure function
 * so context_window parsing is unit-testable without a live proxy.
 * A positive numeric context_window is kept; missing / non-positive → undefined
 * (downstream falls back to preset windows).
 */
export function parseProxyModelItems(rawItems: unknown[]): ProxyModelItem[] {
  const items: ProxyModelItem[] = []
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue
    const rec = it as {
      model_id?: unknown
      model_alias?: unknown
      image_support?: unknown
      context_window?: unknown
    }
    if (typeof rec.model_id !== 'string' || typeof rec.model_alias !== 'string') continue
    const cw =
      typeof rec.context_window === 'number' && rec.context_window > 0
        ? rec.context_window
        : undefined
    items.push({
      modelId: rec.model_id,
      modelAlias: rec.model_alias,
      imageSupport: typeof rec.image_support === 'boolean' ? rec.image_support : undefined,
      ...(cw !== undefined && { contextWindow: cw }),
    })
  }
  return items
}

export function classifyProxyError(error: unknown, status?: number): ProxyErrorCategory {
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'AUTH_FAILED'
    if (status === 404) return 'MODEL_NOT_FOUND'
    if (status === 429) return 'QUOTA_EXCEEDED'
    if (status >= 500) return 'SERVER_ERROR'
  }

  if (error && typeof error === 'object') {
    const e = error as { code?: string; name?: string; message?: string }
    if (e.code && NETWORK_CODES.has(e.code)) return 'NETWORK_UNREACHABLE'
    if (e.name === 'SyntaxError') return 'INVALID_RESPONSE'
    if ((e.message ?? '').includes('Invalid JSON')) return 'INVALID_RESPONSE'
  }

  return 'UNKNOWN'
}

export function toUserMessage(category: ProxyErrorCategory): string {
  switch (category) {
    case 'NETWORK_UNREACHABLE':
      return '无法连接模型代理，请检查网络或代理地址后重试。'
    case 'AUTH_FAILED':
      return '认证已失效，请重新登录后重试。'
    case 'MODEL_NOT_FOUND':
      return '当前模型不可用，请重新选择模型。'
    case 'QUOTA_EXCEEDED':
      return '当前配额不足，请稍后重试或升级配额。'
    case 'INVALID_RESPONSE':
      return '代理返回数据异常，请稍后重试。'
    case 'SERVER_ERROR':
      return '代理服务暂时不可用，请稍后重试。'
    default:
      return '请求失败，请稍后重试。'
  }
}

// ── Header construction ──────────────────────────────────────────────────────

function buildHeaders(params: {
  token?: string
  username?: string
  sessionId?: string
}): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (params.token) {
    headers['x-api-key'] = params.token
    headers.Authorization = `Bearer ${params.token}`
  }
  if (params.username) {
    headers['x-llm-proxy-user'] = encodeURIComponent(params.username)
  }
  if (params.sessionId) {
    headers['X-WoiCrew-Session-Id'] = params.sessionId
  }
  return headers
}

// ── JSON parsing ─────────────────────────────────────────────────────────────

async function parseJsonSafe(resp: Response): Promise<unknown> {
  const text = await resp.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SyntaxError('Invalid JSON response')
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface ProxyRequestContext {
  baseUrl: string
  token?: string
  fallbackToken?: string
  username?: string
  sessionId?: string
}

/**
 * Check proxy health at GET {baseUrl}/healthz
 */
export async function checkProxyHealth(
  ctx: ProxyRequestContext,
): Promise<{ status: 'healthy' | 'unreachable' | 'degraded'; checkedAt: number }> {
  const now = Date.now()
  const tryFetch = async (token?: string) => {
    const url = ctx.baseUrl.endsWith('/') ? `${ctx.baseUrl}healthz` : `${ctx.baseUrl}/healthz`
    return fetch(url, {
      method: 'GET',
      headers: buildHeaders({ token, username: ctx.username, sessionId: ctx.sessionId }),
    })
  }
  try {
    let resp = await tryFetch(ctx.token)
    if (
      (resp.status === 401 || resp.status === 403) &&
      ctx.fallbackToken &&
      ctx.fallbackToken !== ctx.token
    ) {
      resp = await tryFetch(ctx.fallbackToken)
    }
    if (resp.ok) return { status: 'healthy', checkedAt: now }
    if (resp.status >= 500) return { status: 'degraded', checkedAt: now }
    return { status: 'unreachable', checkedAt: now }
  } catch {
    return { status: 'unreachable', checkedAt: now }
  }
}

/**
 * Fetch dynamic model list from CrewProxy at GET {baseUrl}/models
 */
export async function fetchProxyModelList(
  ctx: ProxyRequestContext,
): Promise<{ items: ProxyModelItem[] }> {
  const url = ctx.baseUrl.endsWith('/') ? `${ctx.baseUrl}models` : `${ctx.baseUrl}/models`

  const tryFetch = async (token?: string) => {
    return fetch(url, {
      method: 'GET',
      headers: buildHeaders({ token, username: ctx.username, sessionId: ctx.sessionId }),
      // Bound the model-list fetch so a hung gateway cannot pin the
      // /api/models handler (and thus the desktop fetchAll) indefinitely.
      // 8s is generous for a list endpoint; on timeout the caller falls
      // back to direct models / null.
      signal: AbortSignal.timeout(8_000),
    })
  }

  let resp = await tryFetch(ctx.token)
  if (
    (resp.status === 401 || resp.status === 403) &&
    ctx.fallbackToken &&
    ctx.fallbackToken !== ctx.token
  ) {
    resp = await tryFetch(ctx.fallbackToken)
  }

  if (!resp.ok) {
    const category = classifyProxyError(undefined, resp.status)
    const err = new Error(toUserMessage(category))
    ;(err as Error & { category?: ProxyErrorCategory }).category = category
    throw err
  }

  const data = (await parseJsonSafe(resp)) as { items?: unknown }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    const err = new Error(toUserMessage('INVALID_RESPONSE'))
    ;(err as Error & { category?: ProxyErrorCategory }).category = 'INVALID_RESPONSE'
    throw err
  }

  const items = parseProxyModelItems(data.items)

  return { items }
}

/**
 * Parse LLM_DIRECT_MODELS env: "DisplayName:modelId,Name2:id2"
 * Only splits on the first colon — the right side is the full model ID.
 */
export function parseDirectModels(raw: string): ProxyModelItem[] {
  if (!raw.trim()) return []
  return raw.split(',').map((entry) => {
    const part = entry.trim()
    if (!part) return null
    const colon = part.indexOf(':')
    const modelAlias = (colon === -1 ? part : part.slice(0, colon)).trim()
    const modelId = (colon === -1 ? part : part.slice(colon + 1)).trim() || modelAlias
    return { modelId, modelAlias }
  }).filter((m): m is ProxyModelItem => m !== null)
}
