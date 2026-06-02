# Token Expiry Auto-Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When CLI reports `invalid_api_key`, server automatically stops the session and notifies frontend; frontend shows a transient banner and auto-retries the last message with a fresh CLI.

**Architecture:** Single trigger point — CLI `invalid_api_key` error. Server adds `authRetryCount` to stream state, emits `auth_restarting` on first occurrence, plain `error` on second. Frontend handles `auth_restarting` by saving last user message, showing banner, and auto-retrying after 1s delay.

**Tech Stack:** Bun (server), Zustand + React + Tailwind (desktop), TypeScript, Vitest (desktop tests), bun test (server tests)

---

### Task 1: Server — Add `auth_restarting` message type

**Files:**
- Modify: `src/server/ws/events.ts:43-72` (ServerMessage union)
- Modify: `desktop/src/types/chat.ts:54-84` (frontend ServerMessage mirror)

- [ ] **Step 1: Add `auth_restarting` variant to server ServerMessage**

In `src/server/ws/events.ts`, add after the `session_title_updated` variant (line 72):

```ts
  | { type: 'auth_restarting'; attempt: number }
```

- [ ] **Step 2: Add `auth_restarting` variant to frontend ServerMessage**

In `desktop/src/types/chat.ts`, find the `ServerMessage` union type and add the same variant:

```ts
  | { type: 'auth_restarting'; attempt: number }
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd desktop && bun run lint`
Expected: No type errors (the new variant is not yet consumed by any switch/case, which is fine — unhandled cases don't error in TS discriminated unions)

- [ ] **Step 4: Commit**

```bash
git add src/server/ws/events.ts desktop/src/types/chat.ts
git commit -m "feat: add auth_restarting ServerMessage type

Adds a new WS message variant for signaling CLI auth expiry
auto-restart to the frontend. Both server and desktop type
definitions updated in sync."
```

---

### Task 2: Server — Add `authRetryCount` to stream state + reset on user message

**Files:**
- Modify: `src/server/ws/handler.ts:691-718` (SessionStreamState type + getStreamState)
- Modify: `src/server/ws/handler.ts:221-248` (handleUserMessage — add counter reset)

- [ ] **Step 1: Add `authRetryCount` to SessionStreamState**

In `src/server/ws/handler.ts`, add field to `SessionStreamState` type (after `lastApiError`, line ~701):

```ts
  authRetryCount: number
```

- [ ] **Step 2: Initialize `authRetryCount` in getStreamState**

In the `getStreamState` function (line ~709), add to the initial state object after `lastApiError: undefined`:

```ts
  authRetryCount: 0,
```

- [ ] **Step 3: Reset `authRetryCount` in handleUserMessage**

In `handleUserMessage` function, after the `sessionStopRequested.delete(sessionId)` and `clearPrewarmState(sessionId)` lines (around line 228-229), add:

```ts
  const streamState = getStreamState(sessionId)
  streamState.authRetryCount = 0
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd c:/Users/zhaocao/Documents/GitHub/AmbiCrew && bun run src/server/ws/handler.ts --help 2>&1 | head -5` (just checking no import/type error; may exit with "not a command" but no TS error)
Expected: No type errors in output

- [ ] **Step 5: Commit**

```bash
git add src/server/ws/handler.ts
git commit -m "feat: add authRetryCount to stream state, reset on user message

Per-session counter tracks how many times auth restart has been
attempted. Reset to 0 whenever the user manually sends a message,
allowing a fresh retry cycle."
```

---

### Task 3: Server — Detect `invalid_api_key` and emit `auth_restarting`

**Files:**
- Modify: `src/server/ws/handler.ts:878-887` (translateCliMessage — error handling branch)

- [ ] **Step 1: Replace the generic error return for `invalid_api_key`**

In `translateCliMessage`, find the current error handling block (lines ~878-887):

```ts
      if (cliMsg.error || cliMsg.isApiErrorMessage) {
        const message = extractAssistantText(cliMsg) || cliMsg.error || 'Unknown API error'
        const code = typeof cliMsg.error === 'string' ? cliMsg.error : 'API_ERROR'
        streamState.lastApiError = { message, code }
        return [{
          type: 'error',
          message,
          code,
        }]
      }
```

Replace with:

```ts
      if (cliMsg.error || cliMsg.isApiErrorMessage) {
        const message = extractAssistantText(cliMsg) || cliMsg.error || 'Unknown API error'
        const code = typeof cliMsg.error === 'string' ? cliMsg.error : 'API_ERROR'
        streamState.lastApiError = { message, code }

        if (code === 'invalid_api_key') {
          conversationService.stopSession(sessionId)
          const attempt = streamState.authRetryCount + 1
          streamState.authRetryCount = attempt
          if (attempt <= 1) {
            return [{ type: 'auth_restarting', attempt }]
          }
          // attempt >= 2: not retryable, show normal error
          return [{ type: 'error', message, code, retryable: false }]
        }

        return [{
          type: 'error',
          message,
          code,
        }]
      }
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd c:/Users/zhaocao/Documents/GitHub/AmbiCrew && npx tsc --noEmit src/server/ws/handler.ts 2>&1 | head -20`
Expected: No errors (or only pre-existing errors unrelated to this change)

- [ ] **Step 3: Commit**

```bash
git add src/server/ws/handler.ts
git commit -m "feat: detect invalid_api_key and emit auth_restarting

When CLI reports invalid_api_key, stop the session and emit
auth_restarting on first occurrence. On second occurrence within
the same user turn, emit a normal non-retryable error."
```

---

### Task 4: Frontend — Add `authRestartState` and `lastUserMessage` to session state

**Files:**
- Modify: `desktop/src/stores/chatStore.ts:33-64` (PerSessionState type)
- Modify: `desktop/src/stores/chatStore.ts:66-88` (DEFAULT_SESSION_STATE + createDefaultSessionState)

- [ ] **Step 1: Add new fields to PerSessionState**

In `desktop/src/stores/chatStore.ts`, add after `composerPrefill` (line ~63):

```ts
  authRestartState?: 'restarting' | 'failed'
  lastUserMessage?: { content: string; attachments?: any[] }
```

- [ ] **Step 2: No changes needed to DEFAULT_SESSION_STATE**

Both new fields are optional (`?`), so `DEFAULT_SESSION_STATE` doesn't need updating — `undefined` is the default.

- [ ] **Step 3: Verify desktop TypeScript**

Run: `cd desktop && bun run lint`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add desktop/src/stores/chatStore.ts
git commit -m "feat: add authRestartState and lastUserMessage to session state

Tracks the auth restart lifecycle (restarting/failed) and stores
the last user message for automatic retry after CLI restart."
```

---

### Task 5: Frontend — Handle `auth_restarting` event in chatStore

**Files:**
- Modify: `desktop/src/stores/chatStore.ts:565-936` (handleServerMessage switch)

- [ ] **Step 1: Add `auth_restarting` case to handleServerMessage**

In `desktop/src/stores/chatStore.ts`, in the `handleServerMessage` switch statement, add a new case before the `default` case (after `system_notification`, around line ~848):

```ts
      case 'auth_restarting': {
        update((s) => ({
          authRestartState: 'restarting',
          chatState: 'idle',
          streamingText: '',
          activeThinkingId: null,
        }))
        // Clear elapsed timer
        {
          const session = get().sessions[sessionId]
          if (session?.elapsedTimer) {
            clearInterval(session.elapsedTimer)
            update(() => ({ elapsedTimer: null }))
          }
        }
        // Save last user message for retry, then auto-retry after delay
        {
          const session = get().sessions[sessionId]
          const lastUserMsg = [...session.messages].reverse().find((m) => m.type === 'user_text')
          if (lastUserMsg && lastUserMsg.type === 'user_text') {
            const retryContent = lastUserMsg.modelContent || lastUserMsg.content
            const retryAttachments = lastUserMsg.attachments
            update({ lastUserMessage: { content: retryContent, attachments: retryAttachments } })
            setTimeout(() => {
              const currentState = get().sessions[sessionId]
              if (currentState?.authRestartState === 'restarting') {
                get().sendMessage(sessionId, retryContent, retryAttachments)
              }
            }, 1000)
          }
        }
        break
      }
```

- [ ] **Step 2: Clear `authRestartState` on successful activity after retry**

In the `content_start` case (around line ~607), add at the beginning of the update callback, before the existing return:

```ts
authRestartState: undefined,
```

Also in the `status` case when `msg.state === 'thinking'`, add to the update:

```ts
authRestartState: undefined,
```

- [ ] **Step 3: Handle retry failure — show red banner on error after restarting**

In the `error` case (around line ~806), add to the update return object, after `pendingComputerUsePermission: null`:

```ts
authRestartState: get().sessions[sessionId]?.authRestartState === 'restarting' ? 'failed' : undefined,
```

This means: if we were in 'restarting' state and got an error, switch to 'failed' (red banner). Otherwise clear the state.

- [ ] **Step 4: Clear `authRestartState` on manual user message**

In the `sendMessage` method (around line ~332, inside the `set` callback), add to the return object:

```ts
authRestartState: undefined,
```

- [ ] **Step 5: Verify desktop TypeScript**

Run: `cd desktop && bun run lint`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add desktop/src/stores/chatStore.ts
git commit -m "feat: handle auth_restarting event in chatStore

On auth_restarting: save last user message, show restarting
state, auto-retry after 1s delay. Clear state on successful
activity. Show failed state on error after restart attempt."
```

---

### Task 6: Frontend — Render auth restart banner component

**Files:**
- Create: `desktop/src/components/chat/AuthRestartBanner.tsx`
- Modify: `desktop/src/pages/ActiveSession.tsx:281-334` (main chat layout)

- [ ] **Step 1: Create AuthRestartBanner component**

Create `desktop/src/components/chat/AuthRestartBanner.tsx`:

```tsx
import { useChatStore } from '../../stores/chatStore'

export function AuthRestartBanner({ sessionId }: { sessionId: string }) {
  const authRestartState = useChatStore(
    (s) => s.sessions[sessionId]?.authRestartState,
  )

  if (!authRestartState) return null

  if (authRestartState === 'restarting') {
    return (
      <div className="mx-auto max-w-[860px] px-8 py-2">
        <div className="flex items-center gap-2 rounded-md bg-[var(--color-surface-container)] px-4 py-2 text-sm text-[var(--color-on-surface-variant)]">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          凭据已失效，正在重新连接…
        </div>
      </div>
    )
  }

  // authRestartState === 'failed'
  return (
    <div className="mx-auto max-w-[860px] px-8 py-2">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-4 py-2 text-sm text-red-400">
        重新连接失败，请运行 /login
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add AuthRestartBanner to ActiveSession page**

In `desktop/src/pages/ActiveSession.tsx`:

1. Add import at the top:
```ts
import { AuthRestartBanner } from '../components/chat/AuthRestartBanner'
```

2. Find the main chat content area. Look for the `<MessageList` component usage. Insert the banner just above it:
```tsx
<AuthRestartBanner sessionId={sessionId} />
```

The exact location is the div containing the message list, before the `<MessageList` JSX element.

- [ ] **Step 3: Verify desktop TypeScript**

Run: `cd desktop && bun run lint`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/chat/AuthRestartBanner.tsx desktop/src/pages/ActiveSession.tsx
git commit -m "feat: add AuthRestartBanner component

Shows a grey spinner banner during auth restart, and a red
failure banner if retry fails. Rendered above the message list
in ActiveSession. Does not enter transcript."
```

---

### Task 7: Manual smoke test

**Files:** None (manual verification)

- [ ] **Step 1: Start AmbiCrew desktop in dev mode**

Run: `cd desktop && bun run dev` (or the appropriate dev command)

- [ ] **Step 2: Log in via CrewCentral, open a chat session, send a message**

Verify: message goes through normally, no banner appears.

- [ ] **Step 3: Simulate token expiry**

Manually edit `~/.claude/central-auth.json` — replace the `access_token` value with an invalid string (e.g. `"expired-token"`). Keep the `refresh_token` valid so the server can recover.

- [ ] **Step 4: Send another message in the same session**

Expected behavior:
1. Grey banner appears: "凭据已失效，正在重新连接…"
2. After ~1s, the message is automatically retried
3. New CLI spawns with fresh token (server calls `ensureFreshAccessToken` which refreshes)
4. Banner disappears, message goes through successfully

- [ ] **Step 5: Test failure path**

Edit `~/.claude/central-auth.json` again — set both `access_token` and `refresh_token` to invalid strings.

Send another message.

Expected behavior:
1. Grey banner appears
2. Auto-retry fails (refresh also fails)
3. Banner turns red: "重新连接失败，请运行 /login"
4. No infinite loop — the error appears once and stops

- [ ] **Step 6: Test counter reset**

While in the 'failed' banner state, manually send a new message (type and press Enter).

Expected behavior:
1. `authRetryCount` resets to 0
2. Banner clears
3. The new message attempts fresh (will likely fail again with invalid tokens, but goes through the restart cycle once more rather than showing a cached error)

- [ ] **Step 7: Revert test changes and commit any fixes**

If any bugs found during smoke test, fix them and commit. Restore `~/.claude/central-auth.json` to valid tokens.

---

## Self-Review

**1. Spec coverage:**
- ✅ Single trigger (CLI `invalid_api_key`) — Task 3
- ✅ `auth_restarting` message type — Task 1
- ✅ `authRetryCount` in stream state — Task 2
- ✅ Reset counter on user message — Task 2
- ✅ Frontend auto-retry — Task 5
- ✅ Transient banner — Task 6
- ✅ Banner disappears on success — Task 5
- ✅ Banner turns red on failure — Task 5
- ✅ Counter caps at attempt 1 — Task 3
- ✅ Non-recoverable errors unchanged — Task 3 (only `invalid_api_key` triggers special path)

**2. Placeholder scan:** No TBD/TODO/vague steps found.

**3. Type consistency:**
- `auth_restarting: { type: string, attempt: number }` — defined in Task 1, consumed in Task 3 (server) and Task 5 (frontend) ✅
- `authRetryCount: number` — defined in Task 2, incremented in Task 3, reset in Task 2 ✅
- `authRestartState: 'restarting' | 'failed'` — defined in Task 4, set in Task 5, read in Task 6 ✅
- `lastUserMessage: { content: string; attachments?: any[] }` — defined in Task 4, set/read in Task 5 ✅
