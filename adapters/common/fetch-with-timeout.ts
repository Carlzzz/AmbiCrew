/**
 * fetch with timeout + retry.
 *
 * Node's global fetch() has NO default timeout. A stalled TCP connection
 * (network blip, silent LB drop) will hang forever, freezing whatever
 * caller is awaiting it — most importantly the AI Card streaming path
 * and the chat-queue handler chains.
 *
 * This helper adds:
 *   - per-attempt timeout via AbortController
 *   - retry on network errors and 5xx responses (exponential backoff + jitter)
 *   - 4xx responses are returned to the caller (they are not transient)
 */

export type FetchWithTimeoutInit = RequestInit & {
  /** Per-attempt timeout in ms. Default 15_000. */
  timeoutMs?: number
  /** Number of retries on network error / 5xx. Default 2 (=> up to 3 attempts). */
  retries?: number
  /** Base backoff in ms; actual wait = base * 2^attempt + jitter. Default 500. */
  backoffBaseMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const DEFAULT_BACKOFF_BASE_MS = 500

export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    ...rest
  } = init

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal })
      clearTimeout(timer)
      // 5xx is transient — retry. 4xx is the caller's problem — return.
      if (res.status >= 500 && attempt < retries) {
        await sleep(backoff(attempt, backoffBaseMs))
        continue
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt >= retries) break
      await sleep(backoff(attempt, backoffBaseMs))
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`fetchWithTimeout failed: ${String(lastErr)}`)
}

function backoff(attempt: number, base: number): number {
  return base * 2 ** attempt + Math.floor(Math.random() * 300)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
