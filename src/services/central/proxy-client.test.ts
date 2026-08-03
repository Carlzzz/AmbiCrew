import { describe, test, expect } from 'bun:test'
import { parseProxyModelItems } from './proxy-client.js'

describe('parseProxyModelItems context_window parsing', () => {
  test('parses context_window when present and positive', () => {
    const items = parseProxyModelItems([
      { model_id: 'm1', model_alias: 'm1', context_window: 272000 },
    ])
    expect(items[0]!.contextWindow).toBe(272000)
  })

  test('leaves contextWindow undefined when field missing or non-positive', () => {
    const items = parseProxyModelItems([
      { model_id: 'm1', model_alias: 'm1' },
      { model_id: 'm2', model_alias: 'm2', context_window: 0 },
      { model_id: 'm3', model_alias: 'm3', context_window: -5 },
    ])
    expect(items[0]!.contextWindow).toBeUndefined()
    expect(items[1]!.contextWindow).toBeUndefined()
    expect(items[2]!.contextWindow).toBeUndefined()
  })

  test('skips malformed items and preserves modelId/modelAlias/imageSupport', () => {
    const items = parseProxyModelItems([
      null,
      { model_id: 'm1' },
      { model_id: 'm1', model_alias: 'm1', image_support: true, context_window: 128000 },
    ])
    expect(items.length).toBe(1)
    expect(items[0]!.modelId).toBe('m1')
    expect(items[0]!.modelAlias).toBe('m1')
    expect(items[0]!.imageSupport).toBe(true)
    expect(items[0]!.contextWindow).toBe(128000)
  })
})
