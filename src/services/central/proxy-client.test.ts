import { describe, test, expect } from 'bun:test'
import { parseProxyModelItems, parseProxyDefaults } from './proxy-client.js'

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

describe('parseProxyDefaults', () => {
  test('returns four-slot mapping when payload is well-formed', () => {
    const d = parseProxyDefaults({ main: 'a', haiku: 'b', sonnet: 'c', opus: 'd' })
    expect(d).toEqual({ main: 'a', haiku: 'b', sonnet: 'c', opus: 'd' })
  })

  test('returns undefined when any slot is missing', () => {
    expect(parseProxyDefaults({ main: 'a', haiku: 'b', sonnet: 'c' })).toBeUndefined()
    expect(parseProxyDefaults({})).toBeUndefined()
  })

  test('returns undefined when any slot is empty or non-string', () => {
    expect(parseProxyDefaults({ main: '', haiku: 'b', sonnet: 'c', opus: 'd' })).toBeUndefined()
    expect(parseProxyDefaults({ main: 'a', haiku: 42, sonnet: 'c', opus: 'd' })).toBeUndefined()
  })

  test('returns undefined for non-object input', () => {
    expect(parseProxyDefaults(undefined)).toBeUndefined()
    expect(parseProxyDefaults(null)).toBeUndefined()
    expect(parseProxyDefaults('nope')).toBeUndefined()
  })
})
