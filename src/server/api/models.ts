/**
 * Models REST API
 *
 * GET  /api/models          — 获取可用模型列表
 * GET  /api/models/current  — 获取当前选中的模型
 * PUT  /api/models/current  — 切换模型
 * GET  /api/effort          — 获取 Effort 等级
 * PUT  /api/effort          — 设置 Effort 等级
 */

import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { hasOpenAIAuthLogin, isCentralAuthMode, getCentralAccessToken } from '../../utils/auth.js'
import { OPENAI_CODEX_MODEL_CATALOG } from '../../services/openaiAuth/models.js'
import {
  fetchProxyModelList,
  parseDirectModels,
  type ProxyModelItem,
} from '../../services/central/proxy-client.js'

// ─── Default models — empty by design ──────────────────────────────────────
// AmbiCrew is built on Claude Code but is a separate product.
// Default models come from CrewProxy (when connected) or provider config.
// Hardcoded Anthropic model names are intentionally removed to avoid
// confusion with the user's locally installed Claude Code.
const DEFAULT_MODELS: ApiModelInfo[] = []

const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const

const DEFAULT_MODEL = ''
const DEFAULT_EFFORT = 'medium'

const settingsService = new SettingsService()
const providerService = new ProviderService()

type ApiModelInfo = {
  id: string
  name: string
  description: string
  context: string
}

function addUniqueModel(
  models: ApiModelInfo[],
  model: ApiModelInfo | null,
): void {
  if (!model || !model.id.trim()) {
    return
  }

  if (models.some(existing => existing.id === model.id)) {
    return
  }

  models.push(model)
}

function buildProviderModelList(models: {
  main: string
  haiku: string
  sonnet: string
  opus: string
}): ApiModelInfo[] {
  const modelList: ApiModelInfo[] = []

  addUniqueModel(modelList, {
    id: models.main,
    name: models.main,
    description: 'Main model',
    context: '',
  })
  addUniqueModel(modelList, models.haiku
    ? {
        id: models.haiku,
        name: models.haiku,
        description: 'Haiku model',
        context: '',
      }
    : null)
  addUniqueModel(modelList, models.sonnet
    ? {
        id: models.sonnet,
        name: models.sonnet,
        description: 'Sonnet model',
        context: '',
      }
    : null)
  addUniqueModel(modelList, models.opus
    ? {
        id: models.opus,
        name: models.opus,
        description: 'Opus model',
        context: '',
      }
    : null)

  return modelList
}

function getEnvConfiguredAnthropicModels(): ApiModelInfo[] {
  return buildProviderModelList({
    main: process.env.ANTHROPIC_MODEL?.trim() || '',
    haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() || '',
    sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() || '',
    opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() || '',
  })
}

function getOpenAIAuthModels(): ApiModelInfo[] {
  if (!hasOpenAIAuthLogin()) {
    return []
  }

  return OPENAI_CODEX_MODEL_CATALOG.map(model => ({
    id: model.value,
    name: model.label,
    description: model.description,
    context: '',
  }))
}

function getStandaloneModelList(): ApiModelInfo[] {
  const models = [...getEnvConfiguredAnthropicModels()]

  if (models.length === 0) {
    models.push(...DEFAULT_MODELS)
  }

  for (const model of getOpenAIAuthModels()) {
    addUniqueModel(models, model)
  }

  return models
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleModelsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[1] // 'models' | 'effort'
    const sub = segments[2] // 'current' | undefined

    // ── /api/effort ───────────────────────────────────────────────────
    if (resource === 'effort') {
      return await handleEffort(req)
    }

    // ── /api/models/* ─────────────────────────────────────────────────
    switch (sub) {
      case undefined:
        // GET /api/models — 优先从激活的 Provider 读取模型列表
        if (req.method !== 'GET') throw methodNotAllowed(req.method)
        return await handleModelsList()

      case 'current':
        return await handleCurrentModel(req)

      default:
        throw ApiError.notFound(`Unknown models endpoint: ${sub}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleModelsList(): Promise<Response> {
  const { providers, activeId } = await providerService.listProviders()
  const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null

  // In CrewCentral auth mode (env var or active provider is crewcentral),
  // always use CrewProxy models regardless of which provider is marked active.
  // This prevents stale local provider configs from leaking into the model list.
  const isCrewCentral = isCentralAuthMode() || activeProvider?.presetId === 'crewcentral'
  if (isCrewCentral) {
    const centralProvider = providers.find((p) => p.presetId === 'crewcentral')
    const proxyUrl = centralProvider?.baseUrl || process.env.LLM_PROXY_BASE_URL?.trim() || ''
    const proxyModels = await tryFetchProxyModels(proxyUrl || undefined)
    if (proxyModels) {
      return Response.json({
        models: proxyModels,
        provider: centralProvider
          ? { id: centralProvider.id, name: centralProvider.name }
          : null,
      })
    }
    // Proxy unavailable — fall back to CrewCentral provider's configured models
    if (centralProvider) {
      const modelList = buildProviderModelList(centralProvider.models)
      return Response.json({
        models: modelList,
        provider: { id: centralProvider.id, name: centralProvider.name },
      })
    }
    return Response.json({ models: DEFAULT_MODELS, provider: null })
  }

  if (activeProvider) {
    const modelList = buildProviderModelList(activeProvider.models)
    return Response.json({
      models: modelList,
      provider: { id: activeProvider.id, name: activeProvider.name },
    })
  }
  return Response.json({ models: getStandaloneModelList(), provider: null })
}

/**
 * Attempt to fetch model list from CrewProxy.
 * When providerBaseUrl is given (from CrewCentral provider config), it takes
 * priority over environment variables — this ensures the correct proxy endpoint
 * is used even if process.env contains stale values from a different provider.
 */
async function tryFetchProxyModels(providerBaseUrl?: string): Promise<ApiModelInfo[] | null> {
  const proxyBaseUrl =
    providerBaseUrl?.trim() ||
    process.env.LLM_PROXY_BASE_URL?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim()
  if (!proxyBaseUrl) {
    console.warn('[models] No proxy base URL available (providerBaseUrl=%s, LLM_PROXY_BASE_URL=%s)',
      providerBaseUrl ?? 'undefined', process.env.LLM_PROXY_BASE_URL ?? 'undefined')
    return tryGetDirectModels()
  }

  try {
    let token = (await getCentralAccessToken()) ||
      process.env.LLM_PROXY_API_KEY?.trim() ||
      process.env.LLM_DIRECT_API_KEY?.trim() ||
      undefined

    // Fallback: load token directly from disk when AUTH_MODE isn't set yet
    // (e.g. server just started and env sync hasn't completed)
    if (!token) {
      try {
        const { loadTokens } = await import('../../services/central/token-store.js')
        const payload = await loadTokens()
        token = payload?.access_token || undefined
      } catch {}
    }

    if (!token) {
      console.warn('[models] No auth token available for proxy fetch (AUTH_MODE=%s)', process.env.AUTH_MODE)
    }

    const result = await fetchProxyModelList({
      baseUrl: proxyBaseUrl.replace(/\/+$/, ''),
      token,
    })

    return result.items.map((m: ProxyModelItem) => ({
      id: m.modelId,
      name: m.modelAlias,
      description: m.imageSupport ? 'Supports image input' : '',
      context: '',
    }))
  } catch (err) {
    console.error('[models] Proxy model fetch failed (url=%s): %s',
      proxyBaseUrl, err instanceof Error ? err.message : String(err))
    return tryGetDirectModels()
  }
}

/**
 * Parse model list from LLM_DIRECT_MODELS env var.
 * Format: "DisplayName:modelId,Name2:id2"
 */
function tryGetDirectModels(): ApiModelInfo[] | null {
  const raw = process.env.LLM_DIRECT_MODELS?.trim()
  if (!raw) return null
  const items = parseDirectModels(raw)
  if (items.length === 0) return null
  return items.map((m) => ({
    id: m.modelId,
    name: m.modelAlias,
    description: '',
    context: '',
  }))
}

async function handleCurrentModel(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    // Build the full model list: prefer active provider's models, fall back to defaults
    const { providers, activeId } = await providerService.listProviders()
    const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null
    const settings = activeProvider
      ? await providerService.getManagedSettings()
      : await settingsService.getUserSettings()
    const explicitModel = (settings.model as string) || ''
    const contextTier = (settings.modelContext as string) || undefined
    const env = (settings.env as Record<string, string>) || {}
    const envModel = process.env.ANTHROPIC_MODEL?.trim() || ''

    let currentModelId: string
    let currentModelName: string

    if (activeProvider) {
      // Provider is active — only use the provider-managed cc-haha settings.
      const providerEnvModel = env.ANTHROPIC_MODEL
      if (providerEnvModel && !explicitModel) {
        currentModelId = providerEnvModel
        currentModelName = providerEnvModel
      } else {
        currentModelId = explicitModel || providerEnvModel || activeProvider.models.main
        currentModelName = currentModelId
      }

      // For crewcentral, validate against proxy models to avoid sending stale
      // local-model names (from previous providers) to CrewProxy
      if (activeProvider.presetId === 'crewcentral') {
        const proxyModels = await tryFetchProxyModels()
        if (proxyModels && proxyModels.length > 0) {
          const isValid = proxyModels.some((m) => m.id === currentModelId)
          if (!isValid || !currentModelId) {
            const defaultModel = activeProvider.models.main
            const defaultIsValid = defaultModel && proxyModels.some((m) => m.id === defaultModel)
            const resolved = defaultIsValid ? defaultModel : proxyModels[0].id
            const resolvedEntry = proxyModels.find((m) => m.id === resolved)
            currentModelId = resolved
            currentModelName = resolvedEntry?.name ?? resolved
            // Persist the corrected model so the stale value doesn't resurface
            const currentEnv = (settings.env as Record<string, string>) || {}
            await providerService.updateManagedSettings({
              model: currentModelId,
              env: { ...currentEnv, ANTHROPIC_MODEL: currentModelId },
            })
          }
        } else {
          currentModelId = ''
          currentModelName = ''
        }
      }
    } else {
      // No provider — try models from CrewProxy / env first, fall back to defaults
      currentModelId = explicitModel || envModel
      if (!currentModelId) {
        const proxyModels = await tryFetchProxyModels()
        currentModelId = proxyModels?.[0]?.id || DEFAULT_MODEL
      }
      currentModelName = currentModelId
    }

    const lookupId = contextTier ? `${currentModelId}:${contextTier}` : currentModelId

    // Build available models for name lookup
    let availableModels: ApiModelInfo[]
    if (activeProvider) {
      if (activeProvider.presetId === 'crewcentral') {
        const proxyModels = await tryFetchProxyModels()
        availableModels = proxyModels ?? buildProviderModelList(activeProvider.models)
      } else {
        availableModels = buildProviderModelList(activeProvider.models)
      }
    } else {
      availableModels = getStandaloneModelList()
    }

    const modelEntry = availableModels.find((m) => m.id === lookupId)
      || availableModels.find((m) => m.id === currentModelId)
      || {
        id: currentModelId,
        name: currentModelName,
        description: 'Custom model',
        context: contextTier || 'unknown',
      }

    return Response.json({ model: { ...modelEntry, context: contextTier || modelEntry.context } })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const modelId = body.modelId
    if (typeof modelId !== 'string' || !modelId) {
      throw ApiError.badRequest('Missing or invalid "modelId" in request body')
    }

    // Parse composite IDs like 'claude-opus-4-7-20250610:1m'
    // Persist the base model ID for CLI compatibility and context tier separately
    const colonIdx = modelId.indexOf(':')
    const baseId = colonIdx !== -1 ? modelId.slice(0, colonIdx) : modelId
    const contextTier = colonIdx !== -1 ? modelId.slice(colonIdx + 1) : undefined

    const updates: Record<string, unknown> = { model: baseId }
    if (contextTier) {
      updates.modelContext = contextTier
    } else {
      // Clear context tier when switching to a non-composite model
      updates.modelContext = undefined
    }
    const { activeId } = await providerService.listProviders()
    if (activeId) {
      await providerService.updateManagedSettings(updates)
      // Also update ANTHROPIC_MODEL in env so the CLI picks up the model change
      const provider = await providerService.getProvider(activeId)
      if (provider.presetId === 'crewcentral') {
        const currentSettings = await providerService.getManagedSettings()
        const currentEnv = (currentSettings.env as Record<string, string>) || {}
        await providerService.updateManagedSettings({
          env: { ...currentEnv, ANTHROPIC_MODEL: baseId },
        })
      }
    } else {
      await settingsService.updateUserSettings(updates)
    }
    return Response.json({ ok: true, model: modelId })
  }

  throw methodNotAllowed(req.method)
}

async function handleEffort(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const settings = await settingsService.getUserSettings()
    const level = (settings.effort as string) || DEFAULT_EFFORT
    return Response.json({ level, available: EFFORT_LEVELS })
  }

  if (req.method === 'PUT') {
    const body = await parseJsonBody(req)
    const level = body.level
    if (typeof level !== 'string') {
      throw ApiError.badRequest('Missing or invalid "level" in request body')
    }
    if (!EFFORT_LEVELS.includes(level as (typeof EFFORT_LEVELS)[number])) {
      throw ApiError.badRequest(
        `Invalid effort level: "${level}". Valid levels: ${EFFORT_LEVELS.join(', ')}`,
      )
    }
    await settingsService.updateUserSettings({ effort: level })
    return Response.json({ ok: true, level })
  }

  throw methodNotAllowed(req.method)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
