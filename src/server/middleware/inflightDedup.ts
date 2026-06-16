/**
 * In-flight request deduplication for read-only GET endpoints.
 *
 * When multiple concurrent callers request the same resource, collapse them
 * onto a single in-flight Promise. Subsequent callers receive a clone of the
 * same Response instead of triggering parallel work on the server.
 *
 * Safety net:
 *   Each entry has a maximum lifetime (`maxLifetimeMs`, default 60s). If the
 *   underlying Promise hangs (e.g. an upstream readdir/readFile deadlocks),
 *   the entry is force-evicted so a new request can start fresh. Without this,
 *   a single hung request would permanently block all subsequent identical
 *   requests until process restart.
 */

type DedupEntry = {
  promise: Promise<Response>
  expiresAt: number
}

export function createInflightDedup(opts?: { maxLifetimeMs?: number }) {
  const maxLifetimeMs = opts?.maxLifetimeMs ?? 60_000
  const map = new Map<string, DedupEntry>()

  return async function dedup(key: string, build: () => Promise<Response>): Promise<Response> {
    const now = Date.now()
    const existing = map.get(key)
    if (existing && existing.expiresAt > now) {
      // Reuse the in-flight promise. Each caller gets its own clone so they
      // can independently consume the body.
      return (await existing.promise).clone()
    }

    // Either no in-flight request, or the previous one exceeded its lifetime
    // and is presumed hung — start a fresh one.
    const entry: DedupEntry = {
      promise: build().finally(() => {
        // Only remove if this is still the current entry (a force-eviction
        // may have already replaced us with a newer one).
        if (map.get(key) === entry) {
          map.delete(key)
        }
      }),
      expiresAt: now + maxLifetimeMs,
    }
    map.set(key, entry)
    return entry.promise
  }
}
