import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let mockBaseUrl: string | null = 'http://proxy.local'

// Proxy helper mock: backend.ts routes external search through the local
// CrewProxy, so the base URL and auth headers come from the proxy client.
mock.module('../../services/api/client.js', () => ({
  getCustomBaseUrl: () => mockBaseUrl,
  configureApiKeyHeaders: async (headers: Record<string, string>) => {
    headers['x-api-key'] = 'test-token'
  },
}))

import {
  isLikelyClaudeModel,
  isWebSearchEnabledForModel,
  resolveWebSearchProvider,
  searchWithExternalProvider,
  shouldFallbackFromNativeError,
} from './backend.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  mockBaseUrl = 'http://proxy.local'
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

describe('WebSearch backend resolver', () => {
  test('detects Claude models by model name instead of provider URL', () => {
    expect(isLikelyClaudeModel('claude-sonnet-4-5')).toBe(true)
    expect(isLikelyClaudeModel('anthropic/claude-3-7-sonnet')).toBe(true)
    expect(isLikelyClaudeModel('anthropic.claude-opus-4-1')).toBe(true)
    expect(isLikelyClaudeModel('MiniMax-M2.7-highspeed')).toBe(false)
  })

  test('auto mode prefers native Anthropic web search for Claude model names', () => {
    expect(resolveWebSearchProvider('anthropic/claude-3-7-sonnet', { mode: 'auto' }).provider).toBe(
      'anthropic',
    )
  })

  test('auto mode falls back to Tavily for non-Claude models', () => {
    expect(resolveWebSearchProvider('gpt-5.4', { mode: 'auto' }).provider).toBe('tavily')
  })

  test('tavily/brave modes are normalized to proxy auto-select', () => {
    expect(resolveWebSearchProvider('gpt-5.4', { mode: 'tavily' }).provider).toBe('tavily')
    expect(resolveWebSearchProvider('gpt-5.4', { mode: 'brave' }).provider).toBe('tavily')
    expect(resolveWebSearchProvider('gpt-5.4', { mode: 'disabled' }).provider).toBe('disabled')
  })

  test('isEnabled reflects native Claude or external provider availability', () => {
    expect(isWebSearchEnabledForModel('claude-sonnet-4-5', { mode: 'auto' })).toBe(true)
    expect(isWebSearchEnabledForModel('qwen3-coder', { mode: 'auto' })).toBe(true)
    expect(isWebSearchEnabledForModel('qwen3-coder', { mode: 'disabled' })).toBe(false)
    expect(isWebSearchEnabledForModel('qwen3-coder', { mode: 'anthropic' })).toBe(false)
  })

  test('falls back on native tool schema/provider mismatch errors', () => {
    expect(
      shouldFallbackFromNativeError(
        new Error('422 Extra inputs are not permitted: web_search_20250305'),
      ),
    ).toBe(true)
    expect(shouldFallbackFromNativeError(new Error('network timeout'))).toBe(false)
  })
})

describe('WebSearch proxy path', () => {
  test('routes external search to proxy /v1/websearch with provider and query', async () => {
    const { calls } = stubFetch([{ title: 'Example', url: 'https://example.com' }])
    const output = await searchWithExternalProvider(
      'tavily',
      {
        query: 'test query',
        allowed_domains: ['docs.example.com'],
        blocked_domains: ['blocked.example.com'],
      },
      new AbortController().signal,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://proxy.local/v1/websearch')
    expect(calls[0].init.method).toBe('POST')

    const headers = (calls[0].init.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['x-api-key']).toBe('test-token')

    const body = JSON.parse(String(calls[0].init.body))
    expect(body).toEqual({
      provider: 'tavily',
      query: 'test query',
      allowed_domains: ['docs.example.com'],
      blocked_domains: ['blocked.example.com'],
    })

    expect(output.results[1]).toEqual({
      tool_use_id: 'tavily-web-search',
      content: [{ title: 'Example', url: 'https://example.com' }],
    })
  })

  test('throws when no proxy base URL is configured', async () => {
    mockBaseUrl = null
    await expect(
      searchWithExternalProvider(
        'brave',
        { query: 'test query' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('CrewProxy base URL is not configured')
  })

  test('throws when the proxy responds with a non-OK status', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 502 })) as unknown as typeof fetch
    await expect(
      searchWithExternalProvider(
        'tavily',
        { query: 'test query' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Web search via proxy failed: 502')
  })
})
