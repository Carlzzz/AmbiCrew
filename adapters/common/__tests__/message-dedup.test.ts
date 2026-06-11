import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageDedup } from '../message-dedup.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('MessageDedup', () => {
  let dedup: MessageDedup
  let tmpFile: string

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `dedup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    dedup = new MessageDedup(1000, 100, tmpFile) // 1s TTL, 100 max entries
  })

  afterEach(() => {
    dedup.destroy()
    try { fs.unlinkSync(tmpFile) } catch {}
  })

  it('returns true for new messages', () => {
    expect(dedup.tryRecord('msg-1')).toBe(true)
    expect(dedup.tryRecord('msg-2')).toBe(true)
  })

  it('returns false for duplicate messages', () => {
    expect(dedup.tryRecord('msg-1')).toBe(true)
    expect(dedup.tryRecord('msg-1')).toBe(false)
    expect(dedup.tryRecord('msg-1')).toBe(false)
  })

  it('allows same ID after TTL expires', async () => {
    const shortFile = `${tmpFile}.short`
    const shortDedup = new MessageDedup(50, 100, shortFile) // 50ms TTL
    expect(shortDedup.tryRecord('msg-1')).toBe(true)
    expect(shortDedup.tryRecord('msg-1')).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(shortDedup.tryRecord('msg-1')).toBe(true)
    shortDedup.destroy()
    try { fs.unlinkSync(shortFile) } catch {}
  })

  it('evicts oldest entry when at capacity', () => {
    const smallFile = `${tmpFile}.small`
    const smallDedup = new MessageDedup(60_000, 3, smallFile) // max 3 entries
    expect(smallDedup.tryRecord('a')).toBe(true)
    expect(smallDedup.tryRecord('b')).toBe(true)
    expect(smallDedup.tryRecord('c')).toBe(true)
    // Adding 4th should evict 'a'
    expect(smallDedup.tryRecord('d')).toBe(true)
    // 'a' was evicted, should be treated as new
    expect(smallDedup.tryRecord('a')).toBe(true)
    // Now store has {c, d, a} — 'b' was evicted when 'a' was re-inserted
    // 'c' should still be deduped (was not evicted)
    expect(smallDedup.tryRecord('c')).toBe(false)
    smallDedup.destroy()
    try { fs.unlinkSync(smallFile) } catch {}
  })

  it('handles distinct messages independently', () => {
    expect(dedup.tryRecord('msg-1')).toBe(true)
    expect(dedup.tryRecord('msg-2')).toBe(true)
    expect(dedup.tryRecord('msg-1')).toBe(false)
    expect(dedup.tryRecord('msg-2')).toBe(false)
    expect(dedup.tryRecord('msg-3')).toBe(true)
  })

  it('persists and restores across instances', () => {
    dedup.tryRecord('persist-1')
    dedup.tryRecord('persist-2')
    dedup.destroy()

    // Create new instance from same file
    const restored = new MessageDedup(1000, 100, tmpFile)
    expect(restored.tryRecord('persist-1')).toBe(false) // should be deduplicated
    expect(restored.tryRecord('persist-2')).toBe(false)
    expect(restored.tryRecord('persist-3')).toBe(true)  // new message
    restored.destroy()
  })
})
