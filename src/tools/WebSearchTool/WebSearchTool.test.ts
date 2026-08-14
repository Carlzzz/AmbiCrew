import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import { WebSearchTool } from './WebSearchTool.js'

// Controllable test state: base URL + settings are injected via module mocks
// so the tool's call() path is fully deterministic.
let mockBaseUrl: string | null = 'http://proxy.local'
let mockSettings: { webSearch: { mode: string } } = { webSearch: { mode: 'tavily' } }

mock.module('../../services/api/client.js', () => ({
  getCustomBaseUrl: () => mockBaseUrl,
  configureApiKeyHeaders: async (headers: Record<string, string>) => {
    headers['x-api-key'] = 'test-token'
  },
}))

mock.module('../../utils/settings/settings.js', () => ({
  getSettings_DEPRECATED: () => mockSettings,
}))

const originalFetch = globalThis.fetch

beforeEach(() => {
  mockBaseUrl = 'http://proxy.local'
  mockSettings = { webSearch: { mode: 'tavily' } }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function stubFetch(results: Array<{ title: string; url: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const stub: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  globalThis.fetch = stub
  return { calls }
}

function makeContext(model = 'gpt-5.4'): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: model,
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: {} as never,
    getAppState: (() => ({})) as never,
    setAppState: (() => {}) as never,
    setInProgressToolUseIDs: (() => {}) as never,
  }
}

describe('WebSearchTool call()', () => {
  test('auto mode omits provider so the proxy auto-selects', async () => {
    mockSettings = { webSearch: { mode: 'auto' } }
    const { calls } = stubFetch([{ title: 'Example', url: 'https://example.com' }])

    const result = await WebSearchTool.call(
      { query: 'test query' },
      makeContext('gpt-5.4'),
      undefined,
      undefined,
      undefined,
    )

    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect('provider' in body).toBe(false)
    expect(body.query).toBe('test query')

    // Generic label since the concrete provider is decided by the proxy
    expect(result.data.results[1]).toMatchObject({
      tool_use_id: 'proxy-web-search',
      content: [{ title: 'Example', url: 'https://example.com' }],
    })
  })

  test('tavily mode is normalized to auto and omits provider', async () => {
    mockSettings = { webSearch: { mode: 'tavily' } }
    const { calls } = stubFetch([{ title: 'Example', url: 'https://example.com' }])

    await WebSearchTool.call(
      { query: 'test query' },
      makeContext('gpt-5.4'),
      undefined,
      undefined,
      undefined,
    )

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect('provider' in body).toBe(false)
  })

  test('degrades gracefully when the proxy is unreachable instead of throwing', async () => {
    mockBaseUrl = null
    mockSettings = { webSearch: { mode: 'tavily' } }

    const result = await WebSearchTool.call(
      { query: 'test query' },
      makeContext('gpt-5.4'),
      undefined,
      undefined,
      undefined,
    )

    // No unhandled error: call() returns an "unavailable" output for the model
    expect(result.data.query).toBe('test query')
    expect(typeof result.data.results[0]).toBe('string')
    expect(String(result.data.results[0])).toContain('unavailable')
    expect(typeof result.data.durationSeconds).toBe('number')
  })
})
