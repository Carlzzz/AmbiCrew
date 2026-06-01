/**
 * 流式消息缓冲
 *
 * 将 content_delta 累积后按时间窗口或字符数批量 flush。
 * 用于 Telegram editMessage / 飞书流式卡片更新。
 */

export type FlushCallback = (text: string, isComplete: boolean) => void | Promise<void>

const DEFAULT_INTERVAL_MS = 500
const DEFAULT_CHAR_THRESHOLD = 200
/** Hard upper bound on a single onFlush() call.
 *  If onFlush silently hangs (e.g. a downstream HTTP without timeout),
 *  this prevents the whole chat handler chain from freezing.
 *  Generous so legitimate slow flushes still succeed. */
const FLUSH_TIMEOUT_MS = 20_000

export class MessageBuffer {
  private buffer = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing = false
  private pendingComplete = false

  constructor(
    private onFlush: FlushCallback,
    private intervalMs = DEFAULT_INTERVAL_MS,
    private charThreshold = DEFAULT_CHAR_THRESHOLD,
  ) {}

  /** Append text delta. Triggers flush if threshold reached. */
  append(text: string): void {
    this.buffer += text
    if (this.buffer.length >= this.charThreshold) {
      this.scheduleFlush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(false), this.intervalMs)
    }
  }

  /** Immediately flush all remaining content (called on message_complete). */
  async complete(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.flushing) {
      // A flush is in-flight; mark pending so it fires after current flush finishes
      this.pendingComplete = true
      return
    }
    await this.flush(true)
  }

  /** Reset the buffer for a new message. */
  reset(): void {
    this.buffer = ''
    this.pendingComplete = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    queueMicrotask(() => this.flush(false))
  }

  private async flush(isComplete: boolean): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.flushing) return
    if (this.buffer.length === 0) return

    this.flushing = true
    const text = this.buffer
    this.buffer = ''
    try {
      await withTimeout(this.onFlush(text, isComplete), FLUSH_TIMEOUT_MS)
    } catch (err) {
      console.error('[MessageBuffer] Flush error:', err)
    } finally {
      this.flushing = false
      // If complete() was called while we were flushing, do the final flush now
      if (this.pendingComplete) {
        this.pendingComplete = false
        await this.flush(true)
      }
    }
  }
}

function withTimeout<T>(value: void | Promise<T>, timeoutMs: number): Promise<T | void> {
  if (!value || typeof (value as Promise<T>).then !== 'function') return Promise.resolve(value)
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`onFlush timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([value as Promise<T>, timeout]).finally(() => clearTimeout(timer))
}
