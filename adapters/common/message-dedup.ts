/**
 * 消息去重 — 持久化版
 *
 * 防止 WebSocket 重连、进程重启等场景下消息重复处理。
 * 内存 Map 用于快速查询，磁盘 JSON 用于跨重启恢复。
 *
 * 持久化策略：
 * - 每次 tryRecord 都写内存，但只有累计 DIRTY_THRESHOLD 条新记录
 *   或距上次落盘超过 FLUSH_INTERVAL_MS 时才写磁盘。
 * - destroy() 和进程退出时立即落盘。
 * - 文件格式：JSON array of [id, timestamp] pairs，按时间升序。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const DEFAULT_TTL_MS = 24 * 60 * 60_000  // 24 hours
const DEFAULT_MAX_ENTRIES = 50000
const SWEEP_INTERVAL_MS = 60_000    // 1 minute
const FLUSH_INTERVAL_MS = 30_000    // 30 seconds
const DIRTY_THRESHOLD = 20          // flush after N new records

function getDefaultFilePath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapter-dedup.json')
}

export class MessageDedup {
  private store = new Map<string, number>()
  private sweepTimer: ReturnType<typeof setInterval>
  private flushTimer: ReturnType<typeof setInterval>
  private dirtyCount = 0
  private filePath: string

  constructor(
    private ttlMs = DEFAULT_TTL_MS,
    private maxEntries = DEFAULT_MAX_ENTRIES,
    filePath?: string,
  ) {
    this.filePath = filePath ?? getDefaultFilePath()
    this.loadFromDisk()
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.flushTimer = setInterval(() => this.flushIfDirty(), FLUSH_INTERVAL_MS)
  }

  /** Returns true if this is a NEW message, false if duplicate. */
  tryRecord(id: string): boolean {
    const now = Date.now()
    const existing = this.store.get(id)

    if (existing !== undefined && now - existing < this.ttlMs) {
      return false // duplicate
    }

    // Evict oldest if at capacity
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }

    this.store.set(id, now)
    this.dirtyCount++

    if (this.dirtyCount >= DIRTY_THRESHOLD) {
      this.flush()
    }

    return true
  }

  private sweep(): void {
    const now = Date.now()
    let swept = false
    for (const [key, ts] of this.store) {
      if (now - ts >= this.ttlMs) {
        this.store.delete(key)
        swept = true
      } else {
        break // Map preserves insertion order; once fresh, rest is fresh
      }
    }
    if (swept) this.dirtyCount++
  }

  private flushIfDirty(): void {
    if (this.dirtyCount > 0) this.flush()
  }

  private flush(): void {
    this.dirtyCount = 0
    try {
      const dir = path.dirname(this.filePath)
      fs.mkdirSync(dir, { recursive: true })
      // Store as array of [id, timestamp] for compact JSON
      const entries: [string, number][] = []
      for (const [id, ts] of this.store) {
        entries.push([id, ts])
      }
      const tmp = `${this.filePath}.tmp.${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify(entries))
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      // Non-fatal — dedup still works in memory
      console.error('[MessageDedup] flush failed:', err instanceof Error ? err.message : err)
    }
  }

  private loadFromDisk(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const entries = JSON.parse(raw) as [string, number][]
      if (!Array.isArray(entries)) return

      const now = Date.now()
      for (const [id, ts] of entries) {
        if (typeof id === 'string' && typeof ts === 'number' && now - ts < this.ttlMs) {
          this.store.set(id, ts)
        }
      }
    } catch {
      // File doesn't exist or is corrupt — start fresh
    }
  }

  destroy(): void {
    clearInterval(this.sweepTimer)
    clearInterval(this.flushTimer)
    this.flush()
    this.store.clear()
  }
}
