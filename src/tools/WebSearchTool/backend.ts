import {
  configureApiKeyHeaders,
  getCustomBaseUrl,
} from '../../services/api/client.js'
import { logForDebugging } from '../../utils/debug.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { Input, Output, SearchResult } from './WebSearchTool.js'

export type WebSearchMode =
  | 'auto'
  | 'anthropic'
  | 'tavily'
  | 'brave'
  | 'disabled'

export type WebSearchProvider = 'anthropic' | 'tavily' | 'brave' | 'disabled'

export type WebSearchSettings = {
  mode?: WebSearchMode
}

export type ResolvedWebSearch = {
  provider: WebSearchProvider
  settings: WebSearchSettings
}

type ExternalSearchHit = {
  title: string
  url: string
}

const WEB_SEARCH_MODES = new Set<WebSearchMode>([
  'auto',
  'anthropic',
  'tavily',
  'brave',
  'disabled',
])

const unsupportedNativeModels = new Set<string>()

export function isLikelyClaudeModel(model: string | undefined): boolean {
  if (!model) {
    return false
  }

  return /(^|[/:._-])claude([/:._-]|$)/.test(model.toLowerCase())
}

export function getConfiguredWebSearchSettings(
  settings: Pick<SettingsJson, 'webSearch'> = getSettings_DEPRECATED(),
): WebSearchSettings {
  const raw = settings.webSearch
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  const modeCandidate = raw.mode ?? 'auto'

  return {
    mode: WEB_SEARCH_MODES.has(modeCandidate) ? modeCandidate : 'auto',
  }
}

export function resolveWebSearchProvider(
  model: string | undefined,
  settings: WebSearchSettings = getConfiguredWebSearchSettings(),
): ResolvedWebSearch {
  const mode = settings.mode ?? 'auto'

  if (mode === 'disabled') return { provider: 'disabled', settings }
  if (mode === 'anthropic') {
    return {
      provider: canUseAnthropicNativeWebSearch(model) ? 'anthropic' : 'disabled',
      settings,
    }
  }
  // auto / tavily / brave 归一化:key 已收敛到 proxy,非 Claude 模型统一走 proxy auto-select
  if (canUseAnthropicNativeWebSearch(model)) return { provider: 'anthropic', settings }
  return { provider: 'tavily', settings }
}

export function isWebSearchEnabledForModel(
  model: string | undefined,
  settings: WebSearchSettings = getConfiguredWebSearchSettings(),
): boolean {
  return resolveWebSearchProvider(model, settings).provider !== 'disabled'
}

export function shouldFallbackFromNativeError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error)
  return (
    /\b(400|422)\b/.test(message) ||
    /web_search|server tool|tool schema|input_schema|extra input|unsupported/i.test(
      message,
    )
  )
}

export function markAnthropicNativeUnsupported(model: string | undefined): void {
  const key = normalizeModelKey(model)
  if (key) {
    unsupportedNativeModels.add(key)
  }
}

export async function searchWithExternalProvider(
  provider: 'tavily' | 'brave' | undefined,
  input: Input,
  signal: AbortSignal,
): Promise<Output> {
  const startTime = performance.now()
  const hits = await searchViaProxy(provider, input, signal)
  const durationSeconds = (performance.now() - startTime) / 1000

  return makeExternalSearchOutput(provider, input.query, hits, durationSeconds)
}

async function searchViaProxy(
  provider: 'tavily' | 'brave' | undefined,
  input: Input,
  signal: AbortSignal,
): Promise<ExternalSearchHit[]> {
  const baseUrl = getCustomBaseUrl()
  if (!baseUrl) {
    throw new Error(
      'CrewProxy base URL is not configured (set LLM_PROXY_BASE_URL or ANTHROPIC_BASE_URL)',
    )
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  await configureApiKeyHeaders(headers, false)
  logForDebugging(
    `WebSearchTool searchViaProxy: fetch start provider=${provider} query=${input.query}`,
  )
  const fetchStart = performance.now()
  const response = await fetch(`${baseUrl}/v1/websearch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider,
      query: input.query,
      allowed_domains: input.allowed_domains,
      blocked_domains: input.blocked_domains,
    }),
    signal,
  })
  logForDebugging(
    `WebSearchTool searchViaProxy: fetch done status=${response.status} duration_ms=${Math.round(
      performance.now() - fetchStart,
    )}`,
  )
  if (!response.ok) {
    throw new Error(`Web search via proxy failed: ${response.status}`)
  }
  const body = (await response.json()) as {
    results?: Array<{ title?: unknown; url?: unknown }>
  }
  return (body.results ?? [])
    .map(hit => normalizeHit(hit.title, hit.url))
    .filter((hit): hit is ExternalSearchHit => hit != null)
}

export function makeWebSearchUnavailableOutput(
  query: string,
  durationSeconds: number,
  reason: string,
): Output {
  return {
    query,
    results: [reason],
    durationSeconds,
  }
}

function canUseAnthropicNativeWebSearch(model: string | undefined): boolean {
  const key = normalizeModelKey(model)
  return isLikelyClaudeModel(model) && (!key || !unsupportedNativeModels.has(key))
}

function normalizeModelKey(model: string | undefined): string | null {
  const trimmed = model?.trim().toLowerCase()
  return trimmed || null
}

function normalizeHit(title: unknown, url: unknown): ExternalSearchHit | null {
  if (typeof title !== 'string' || typeof url !== 'string') {
    return null
  }

  return { title, url }
}

function makeExternalSearchOutput(
  provider: 'tavily' | 'brave' | undefined,
  query: string,
  hits: ExternalSearchHit[],
  durationSeconds: number,
): Output {
  // 当 provider 未显式指定（auto 模式）时由 proxy 自动选择，这里用通用标签展示。
  const providerLabel = provider ?? 'proxy'
  const result: SearchResult = {
    tool_use_id: `${providerLabel}-web-search`,
    content: hits,
  }

  return {
    query,
    results: [`Search provider: ${providerLabel}`, result],
    durationSeconds,
  }
}
