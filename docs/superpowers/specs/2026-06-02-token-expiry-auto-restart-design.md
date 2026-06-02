# CrewCentral Token Expiry Auto-Restart Design

Date: 2026-06-02

## Overview

When a CLI subprocess's CrewCentral access token expires, the CLI reports `invalid_api_key` but the frontend UI still shows "logged in". Currently the user must manually kill CLI processes and retry. This design makes the server automatically restart the CLI and the frontend automatically retry the last message, making token expiry transparent to the user.

## Root Cause

CrewCentral access token is injected into CLI subprocess via `ANTHROPIC_AUTH_TOKEN` env var at spawn time (`conversationService.ts:905-918`). Env vars are frozen after process start. `ensureCliSessionStarted()` (handler.ts:852) reuses existing CLI processes via `hasSession()` check, so the CLI never gets a fresh token after the original one expires.

## Design Decisions

1. **Single trigger: CLI `invalid_api_key` error only.** No upstream event listeners (logout/re-login/refresh). Rationale: if upstream events work correctly, CLI doesn't need restarting; if they don't, CLI will report the error itself. One event source = one code path = fewer race conditions.

2. **Visible transient banner + automatic retry.** Frontend shows a grey banner "凭据已失效，正在重新连接…" while auto-retrying. Banner disappears on success, turns red on failure. Does not enter transcript.

3. **Server-side retry counter.** Per-session `authRetryCount` in stream state. `attempt <= 1` → `auth_restarting` event (frontend auto-retries). `attempt >= 2` → normal `error` event (frontend shows "请运行 /login"). Counter resets when user manually sends a new message.

4. **Non-recoverable auth errors unchanged.** `token_revoked`, `oauth_org_not_allowed` etc. are not retried — they're permanent failures.

## Server Changes

### `src/server/ws/events.ts` — ServerMessage type

Add new variant:

```ts
| { type: 'auth_restarting'; attempt: number }
```

### `src/server/ws/handler.ts` — StreamState type

Add field:

```ts
authRetryCount: number
```

### `src/server/ws/handler.ts` — handleUserMessage

Reset `authRetryCount = 0` at the top of `handleUserMessage` (user-initiated message resets the counter).

### `src/server/ws/handler.ts` — translateCliMessage

Current behavior for `cliMsg.error || cliMsg.isApiErrorMessage`:

```ts
return [{ type: 'error', message, code }]
```

New behavior:

```ts
if (code === 'invalid_api_key') {
  conversationService.stopSession(sessionId)
  const attempt = (streamState.authRetryCount ?? 0) + 1
  streamState.authRetryCount = attempt
  if (attempt <= 1) {
    return [{ type: 'auth_restarting', attempt }]
  }
  // attempt >= 2: not retryable, show normal error
  return [{ type: 'error', message, code, retryable: false }]
}
return [{ type: 'error', message, code }]
```

After `auth_restarting`, the frontend will auto-retry by sending a new `user_message`. Since `stopSession` removed the session from `conversationService.sessions`, `ensureCliSessionStarted` will spawn a fresh CLI with a fresh token via `buildCrewCentralOAuthEnv()`.

### Why `stopSession` instead of `stopSessionAndWait`

`stopSession` kills the process and removes from sessions map synchronously. The next `ensureCliSessionStarted` call will see `hasSession === false` and spawn fresh. We don't need to wait for the process to fully drain — the old process is dead, its output is irrelevant.

## Frontend Changes

### `desktop/src/stores/chatStore.ts` — WS message handling

On `auth_restarting` event:

1. Set `session.authRestartState = 'restarting'` (drives banner display)
2. Store `session.lastUserMessage = { content, attachments }` from the most recent user_text message in the session
3. After 1 second delay (give server time to respawn CLI), auto-call `sendMessage(sessionId, lastUserMessage.content, lastUserMessage.attachments)`

On first `content_start` / `thinking` / `status: 'thinking'` after auto-retry:

1. Clear `session.authRestartState` → banner disappears

On `error` event after auto-retry (attempt >= 2):

1. Set `session.authRestartState = 'failed'` → banner turns red with "重新连接失败，请运行 /login"

On user manually sending a new message:

1. Clear `session.authRestartState` → banner disappears

### `desktop/src/stores/chatStore.ts` — SessionState type

Add fields:

```ts
authRestartState?: 'restarting' | 'failed'
lastUserMessage?: { content: string; attachments?: any[] }
```

### Chat UI component — Auth restart banner

Render a transient banner at the top of the chat area when `session.authRestartState` is set:

- `'restarting'`: grey banner "凭据已失效，正在重新连接…"
- `'failed'`: red banner "重新连接失败，请运行 /login"

Banner does not enter transcript. Clicking the red banner could trigger `/login` (optional enhancement).

## Race Conditions & Edge Cases

1. **Two messages in flight when token expires:** Only the first to hit `invalid_api_key` triggers `auth_restarting`. The second will find `hasSession === false` (already stopped) and `ensureCliSessionStarted` will spawn a new CLI. Both messages' results will be handled normally.

2. **Token expires during long tool call:** `stopSession` kills the CLI mid-turn. The tool call result is lost. On retry, CLI `--resume` reads transcript and restores context. The AI will see the interrupted state and continue. This is acceptable — token expiry during active use is rare, and Level 2 (proxy-based) would be needed to avoid it.

3. **Auto-retry message arrives before CLI is ready:** The 1-second delay covers typical CLI spawn time. If CLI spawn takes longer, `ensureCliSessionStarted` queues the startup and the message will be processed once the CLI is ready. No data loss.

4. **User sends new message during auto-retry:** The manual send resets `authRetryCount = 0` and clears `authRestartState`. The manual message and auto-retry message may both arrive, but they're handled sequentially by the WS handler. The second one just adds another user turn, which is harmless.

5. **Claude Code sessions:** CC does not use `conversationService` or the WS handler in this codebase. `auth_restarting` is a new message type that CC's extension ignores. No cross-contamination.

6. **Non-CrewCentral providers:** `code === 'invalid_api_key'` can also come from other providers with bad API keys. The `stopSession + respawn` behavior is still correct — the new spawn will get fresh provider env. If the provider key is permanently invalid, `attempt >= 2` will stop retrying.

## Files Changed

| File | Change |
|------|--------|
| `src/server/ws/events.ts` | Add `auth_restarting` to `ServerMessage` union |
| `src/server/ws/handler.ts` | Add `authRetryCount` to stream state; detect `invalid_api_key` → stopSession + `auth_restarting`; reset counter on user message |
| `desktop/src/stores/chatStore.ts` | Handle `auth_restarting` event; auto-retry after delay; track `authRestartState` and `lastUserMessage` |
| `desktop/src/components/chat/` (banner component) | Render transient auth restart banner |

## Out of Scope

- Level 2 proxy-based token injection (eliminates need for CLI restart entirely)
- Proactive CLI restart on logout/re-login events
- Retry for non-`invalid_api_key` auth errors (`token_revoked`, `oauth_org_not_allowed`)
- Preserving in-flight tool call state across restart
