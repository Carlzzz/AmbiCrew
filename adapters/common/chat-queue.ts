/**
 * 会话串行队列
 *
 * 同一 chatId 的消息串行处理，防并发冲突。
 * 不同 chatId 之间互不影响。
 * 参考 openclaw-lark chat-queue.ts 的 Promise 链设计。
 *
 * 软超时（TASK_TIMEOUT_MS）：单个任务超过阈值视为卡死，强制让队列前进
 * 而不是让整条 chat 永久 hang。正常对话单步耗时（流式生成 + 卡片回调）
 * 远小于这个值；触发超时意味着上游有 bug，error 日志带 chatId 便于定位。
 */

const DEFAULT_TASK_TIMEOUT_MS = 60_000
let taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS

/** Test-only: override the per-task timeout so tests don't need to wait 60s. */
export function __setTaskTimeoutForTest(ms: number): void {
  taskTimeoutMs = ms
}

/** Test-only: restore the production default. */
export function __resetTaskTimeoutForTest(): void {
  taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS
}

const queues = new Map<string, Promise<void>>()

function withTimeout<T>(fn: () => Promise<T>, chatId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`[ChatQueue] task for chat ${chatId} timed out after ${taskTimeoutMs}ms`)
      console.error(err.message)
      reject(err)
    }, taskTimeoutMs)

    fn().then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function enqueue(chatId: string, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(chatId) ?? Promise.resolve()
  const wrapped = () => withTimeout(fn, chatId)
  // 无论前一个任务 resolve 还是 reject（包括 timeout），下一个都要跑——
  // 这样单个卡死/失败的任务不会污染整条 chat。
  const next = prev.then(wrapped, wrapped).catch((err) => {
    console.error(`[ChatQueue] Error in task for chat ${chatId}:`, err)
  })
  queues.set(chatId, next)
  // Clean up after completion to avoid memory leak for one-off chats
  next.finally(() => {
    if (queues.get(chatId) === next) {
      queues.delete(chatId)
    }
  })
  return next
}
