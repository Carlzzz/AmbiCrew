import { describe, test, expect } from 'bun:test'
import { extractTrimStatusFromHeaders, consumeProxyTrimTokens } from './claudeAiLimits.js'

describe('proxy trim signal', () => {
  test('extracts positive integer and consume clears it', () => {
    extractTrimStatusFromHeaders(new Headers({ 'x-crew-trimmed-tokens': '3200' }))
    expect(consumeProxyTrimTokens()).toBe(3200)
    expect(consumeProxyTrimTokens()).toBe(0) // cleared after read
  })

  test('ignores missing / non-positive / non-numeric', () => {
    consumeProxyTrimTokens() // reset
    extractTrimStatusFromHeaders(new Headers({}))
    expect(consumeProxyTrimTokens()).toBe(0)
    extractTrimStatusFromHeaders(new Headers({ 'x-crew-trimmed-tokens': '0' }))
    expect(consumeProxyTrimTokens()).toBe(0)
    extractTrimStatusFromHeaders(new Headers({ 'x-crew-trimmed-tokens': 'abc' }))
    expect(consumeProxyTrimTokens()).toBe(0)
  })
})
