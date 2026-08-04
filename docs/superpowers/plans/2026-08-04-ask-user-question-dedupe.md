# AskUserQuestion Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the first visible `AskUserQuestion` card answerable when the same unanswered question is replayed with new ids.

**Architecture:** Add a small per-session UI-state dedupe record in `desktop/src/stores/chatStore.ts`. The record stores the signature and ids for the currently unanswered `AskUserQuestion`; live `tool_use_complete` and `permission_request` handlers consult it before appending/replacing state, and normal completion/error/answer paths clear it.

**Tech Stack:** React desktop app, Zustand store, TypeScript, Vitest tests.

## Global Constraints

- Keep the change scoped to `AskUserQuestion`; do not add broad dedupe for other tools.
- Preserve the first visible duplicate question card and first permission request.
- Ignore replay duplicates with the same normalized question content even when `toolUseId` and `requestId` differ.
- Clear dedupe state on answer, turn completion, error, stop, history reload, and message clear.
- Do not change CLI/SDK replay behavior.
- Do not add dependencies.

---

## File Structure

- Modify `desktop/src/stores/chatStore.ts`
  - Add `askUserQuestionDedupe` to `PerSessionState`.
  - Add helper functions to normalize `AskUserQuestion` input and build a stable signature.
  - Update `tool_use_complete`, `permission_request`, `respondToPermission`, `message_complete`, `error`, `stopGeneration`, `reloadHistory`, and `clearMessages` paths.
- Modify `desktop/src/stores/chatStore.test.ts`
  - Add regression tests for same-question replay with different ids.
  - Add regression test proving the same question can appear again after `message_complete` clears dedupe state.

---

### Task 1: Add failing regression tests

**Files:**
- Modify: `desktop/src/stores/chatStore.test.ts`

**Interfaces:**
- Consumes: existing `useChatStore.getState().handleServerMessage(sessionId, msg)`.
- Consumes: existing `useChatStore.getState().respondToPermission(sessionId, requestId, allowed, options)`.
- Produces: failing tests that require `AskUserQuestion` content-signature dedupe.

- [ ] **Step 1: Add a small session fixture helper inside `describe('chatStore history mapping', ...)` after the `beforeEach` block**

Insert this helper after the existing `beforeEach` block, before the first `it(...)`:

```ts
  function seedDesktopSession(sessionId = TEST_SESSION_ID) {
    useChatStore.setState({
      sessions: {
        [sessionId]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
  }
```

- [ ] **Step 2: Add the duplicate replay regression test after the existing same-`toolUseId` duplicate test**

Insert after the test named `drops duplicate tool_use_complete events for the same toolUseId`:

```ts
  it('keeps the first AskUserQuestion answerable when replayed with different ids', () => {
    seedDesktopSession()
    const askInput = {
      questions: [
        {
          question: 'Should we persist data?',
          header: 'Persist',
          multiSelect: false,
          options: [
            { label: 'No', description: 'Keep it memory-only' },
            { label: 'Yes', description: 'Write it to disk' },
          ],
        },
      ],
    }

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: askInput,
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: askInput,
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-2',
      input: askInput,
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-ask-2',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-2',
      input: askInput,
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    const askCards = session?.messages.filter(
      (message) => message.type === 'tool_use' && message.toolName === 'AskUserQuestion',
    ) ?? []

    expect(askCards).toHaveLength(1)
    expect(askCards[0]).toMatchObject({ toolUseId: 'tool-ask-1' })
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-ask-1',
      toolUseId: 'tool-ask-1',
      toolName: 'AskUserQuestion',
    })

    useChatStore.getState().respondToPermission(TEST_SESSION_ID, 'perm-ask-1', true, {
      updatedInput: {
        ...askInput,
        answers: { 'Should we persist data?': 'No' },
      },
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'permission_response',
      requestId: 'perm-ask-1',
      allowed: true,
      updatedInput: {
        ...askInput,
        answers: { 'Should we persist data?': 'No' },
      },
    })
  })
```

- [ ] **Step 3: Add the clear-on-completion regression test immediately after the replay test**

```ts
  it('allows the same AskUserQuestion content again after message_complete clears dedupe state', () => {
    seedDesktopSession()
    const askInput = {
      questions: [
        {
          question: 'Choose deployment target?',
          options: [{ label: 'Staging' }, { label: 'Production' }],
        },
      ],
    }

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-turn-1',
      input: askInput,
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-turn-2',
      input: askInput,
    })

    const askCards = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages.filter(
      (message) => message.type === 'tool_use' && message.toolName === 'AskUserQuestion',
    ) ?? []

    expect(askCards.map((message) => message.toolUseId)).toEqual([
      'tool-turn-1',
      'tool-turn-2',
    ])
  })
```

- [ ] **Step 4: Run tests and verify they fail for the expected reason**

Run:

```bash
cd desktop && bun test src/stores/chatStore.test.ts --runInBand
```

Expected: the new replay test fails because two `AskUserQuestion` tool cards exist and/or `pendingPermission` points to `perm-ask-2`. The existing tests may also run; do not fix production code in this task.

- [ ] **Step 5: Commit the failing tests only if the team allows committing red tests**

The default for this repository session is not to commit unless explicitly asked. If committing is authorized, run:

```bash
git add desktop/src/stores/chatStore.test.ts
git commit -m "test: cover AskUserQuestion replay dedupe"
```

---

### Task 2: Implement AskUserQuestion signature helpers and state

**Files:**
- Modify: `desktop/src/stores/chatStore.ts`

**Interfaces:**
- Produces: `askUserQuestionDedupe?: AskUserQuestionDedupe | null` on `PerSessionState`.
- Produces: `getAskUserQuestionSignature(input: unknown): string | null` helper used by live event handlers.
- Produces: `clearAskUserQuestionDedupe(session: PerSessionState): Partial<PerSessionState>` helper used by clearing paths.

- [ ] **Step 1: Add the dedupe type near `PerSessionState`**

Insert before `export type PerSessionState = {`:

```ts
type AskUserQuestionDedupe = {
  signature: string
  toolUseId: string
  requestId?: string
}
```

Then add this property near `pendingPermission` in `PerSessionState`:

```ts
  askUserQuestionDedupe?: AskUserQuestionDedupe | null
```

- [ ] **Step 2: Add normalization helpers after `isAskUserQuestion`**

Insert after the existing `isAskUserQuestion` function:

```ts
type AskUserQuestionOption = {
  label?: unknown
  description?: unknown
}

type AskUserQuestionInput = {
  questions?: unknown
  question?: unknown
  header?: unknown
  options?: unknown
  multiSelect?: unknown
}

function normalizeAskUserQuestionInput(input: unknown) {
  if (!input || typeof input !== 'object') return null
  const raw = input as AskUserQuestionInput
  const rawQuestions = Array.isArray(raw.questions)
    ? raw.questions
    : typeof raw.question === 'string'
      ? [raw]
      : []

  const questions = rawQuestions
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const question = entry as AskUserQuestionInput
      if (typeof question.question !== 'string' || !question.question.trim()) return null
      const options = Array.isArray(question.options)
        ? question.options
          .map((option) => {
            if (!option || typeof option !== 'object') return null
            const typed = option as AskUserQuestionOption
            const label = typeof typed.label === 'string' ? typed.label : ''
            const description = typeof typed.description === 'string' ? typed.description : ''
            return { label, description }
          })
          .filter((option): option is { label: string; description: string } => option !== null)
        : []

      return {
        question: question.question.trim(),
        header: typeof question.header === 'string' ? question.header.trim() : '',
        multiSelect: question.multiSelect === true,
        options,
      }
    })
    .filter((question): question is {
      question: string
      header: string
      multiSelect: boolean
      options: Array<{ label: string; description: string }>
    } => question !== null)

  return questions.length > 0 ? questions : null
}

function getAskUserQuestionSignature(input: unknown): string | null {
  const normalized = normalizeAskUserQuestionInput(input)
  return normalized ? JSON.stringify(normalized) : null
}

function clearAskUserQuestionDedupe(session: PerSessionState): Partial<PerSessionState> {
  return session.askUserQuestionDedupe ? { askUserQuestionDedupe: null } : {}
}
```

- [ ] **Step 3: Run TypeScript/test to catch helper placement issues**

Run:

```bash
cd desktop && bun test src/stores/chatStore.test.ts --runInBand
```

Expected: tests still fail because event handlers do not use helpers yet. There should be no TypeScript/runtime error like `PerSessionState is used before declaration`. If TypeScript complains that `clearAskUserQuestionDedupe` references `PerSessionState` before declaration, move `clearAskUserQuestionDedupe` below `createDefaultSessionState` and keep its body unchanged.

---

### Task 3: Use dedupe in live AskUserQuestion handlers and clearing paths

**Files:**
- Modify: `desktop/src/stores/chatStore.ts`

**Interfaces:**
- Consumes: `getAskUserQuestionSignature(input: unknown): string | null`.
- Consumes: `askUserQuestionDedupe?: AskUserQuestionDedupe | null`.
- Produces: live `AskUserQuestion` replay suppression by normalized input signature.

- [ ] **Step 1: Update `respondToPermission` to clear matching dedupe state**

Replace the existing `set(...)` call at the end of `respondToPermission` with:

```ts
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, (session) => ({
        pendingPermission: null,
        chatState: allowed ? 'tool_executing' : 'idle',
        ...(session.askUserQuestionDedupe?.requestId === requestId
          ? { askUserQuestionDedupe: null }
          : {}),
      })),
    }))
```

- [ ] **Step 2: Update `stopGeneration` to clear dedupe state**

In the `stopGeneration` final `set((s) => { ... })`, add `askUserQuestionDedupe: null` to the returned session object:

```ts
          [sessionId]: {
            ...session,
            chatState: 'idle',
            pendingPermission: null,
            pendingComputerUsePermission: null,
            askUserQuestionDedupe: null,
            elapsedTimer: null,
          },
```

- [ ] **Step 3: Update `reloadHistory` reset state to clear dedupe**

In the `reloadHistory` updater, add this field to the reset object:

```ts
            askUserQuestionDedupe: null,
```

Place it next to `pendingPermission: null` and `pendingComputerUsePermission: null`.

- [ ] **Step 4: Update `clearMessages` to clear dedupe**

Replace the current `clearMessages` updater with:

```ts
  clearMessages: (sessionId) => {
    set((s) => ({
      sessions: updateSessionIn(s.sessions, sessionId, () => ({
        messages: [],
        streamingText: '',
        chatState: 'idle',
        pendingPermission: null,
        pendingComputerUsePermission: null,
        askUserQuestionDedupe: null,
      })),
    }))
  },
```

- [ ] **Step 5: Update `tool_use_complete` to drop same-signature duplicates**

Inside the `case 'tool_use_complete': {` block, after the existing same-`toolUseId` replay check and before the `OpenPreview` block, insert:

```ts
        const askSignature = isAskUserQuestion(toolName)
          ? getAskUserQuestionSignature(msg.input)
          : null
        if (askSignature && session?.askUserQuestionDedupe?.signature === askSignature) {
          console.warn(
            `[chatStore:AskUserQuestion] dropping duplicate question signature toolUseId=${toolUseId}`,
          )
          update(() => ({
            activeToolUseId: null,
            activeToolName: null,
            activeThinkingId: null,
            streamingToolInput: '',
          }))
          break
        }
```

Then update the existing `update((s) => ({ messages: ... }))` for `tool_use_complete` so it also records the dedupe entry for first `AskUserQuestion` cards:

```ts
        update((s) => ({
          messages: [...s.messages, {
            id: nextId(), type: 'tool_use', toolName,
            toolUseId,
            input: msg.input, timestamp: Date.now(), parentToolUseId: msg.parentToolUseId,
          }],
          ...(askSignature ? {
            askUserQuestionDedupe: {
              signature: askSignature,
              toolUseId,
              requestId: s.askUserQuestionDedupe?.requestId,
            },
          } : {}),
          activeToolUseId: null, activeToolName: null, activeThinkingId: null, streamingToolInput: '',
        }))
```

- [ ] **Step 6: Update `permission_request` to preserve the first pending request**

At the top of `case 'permission_request':`, after the `AskUserQuestion` console log block and before `notifyDesktop(...)`, insert:

```ts
        const askSignature = isAskUserQuestion(msg.toolName)
          ? getAskUserQuestionSignature(msg.input)
          : null
        if (
          askSignature &&
          sessionState?.askUserQuestionDedupe?.signature === askSignature &&
          sessionState.askUserQuestionDedupe.requestId &&
          sessionState.pendingPermission?.requestId === sessionState.askUserQuestionDedupe.requestId
        ) {
          console.warn(
            `[chatStore:AskUserQuestion] dropping duplicate permission_request requestId=${msg.requestId}`,
          )
          break
        }
```

Then update the `update((s) => ({ pendingPermission: ... }))` object to record the first request id for `AskUserQuestion`:

```ts
          ...(askSignature ? {
            askUserQuestionDedupe: {
              signature: askSignature,
              toolUseId: msg.toolUseId ?? s.askUserQuestionDedupe?.toolUseId ?? '',
              requestId: msg.requestId,
            },
          } : {}),
```

Place that spread next to `pendingPermission` in the returned partial object.

- [ ] **Step 7: Update `message_complete` to clear dedupe**

In the `message_complete` update object, add:

```ts
          askUserQuestionDedupe: null,
```

Place it next to `pendingPermission: null` and `pendingComputerUsePermission: null`.

- [ ] **Step 8: Update `error` to clear dedupe**

In the `error` update object, add:

```ts
            askUserQuestionDedupe: null,
```

Place it next to `pendingPermission: null` and `pendingComputerUsePermission: null`.

- [ ] **Step 9: Update `/clear` UI reset to clear dedupe**

In the `system_notification` branch where `msg.subtype === 'session_cleared'`, add this to the reset object:

```ts
            askUserQuestionDedupe: null,
```

Place it next to `pendingPermission: null` and `pendingComputerUsePermission: null`.

- [ ] **Step 10: Run the targeted test file**

Run:

```bash
cd desktop && bun test src/stores/chatStore.test.ts --runInBand
```

Expected: all tests in `chatStore.test.ts` pass.

- [ ] **Step 11: Fix any TypeScript issues from optional fields**

If TypeScript complains about `sessionState` being unavailable in `permission_request`, use this exact line before the duplicate check:

```ts
        const sessionState = get().sessions[sessionId]
```

If TypeScript complains that `msg.toolUseId` can be undefined, keep the fallback shown in Step 6:

```ts
              toolUseId: msg.toolUseId ?? s.askUserQuestionDedupe?.toolUseId ?? '',
```

- [ ] **Step 12: Commit implementation if commits are authorized**

The default for this repository session is not to commit unless explicitly asked. If committing is authorized, run:

```bash
git add desktop/src/stores/chatStore.ts desktop/src/stores/chatStore.test.ts
git commit -m "fix: dedupe repeated AskUserQuestion prompts"
```

---

### Task 4: Verify no regressions in the UI rendering path

**Files:**
- Test: `desktop/src/components/chat/AskUserQuestion.test.tsx`
- Test: `desktop/src/stores/chatStore.test.ts`

**Interfaces:**
- Consumes: final `chatStore` dedupe behavior from Task 3.
- Produces: verified store + component tests.

- [ ] **Step 1: Run the AskUserQuestion component tests**

Run:

```bash
cd desktop && bun test src/components/chat/AskUserQuestion.test.tsx --runInBand
```

Expected: all tests pass. These confirm submitted answers still travel through `permission_response.updatedInput`.

- [ ] **Step 2: Run the chat store tests again**

Run:

```bash
cd desktop && bun test src/stores/chatStore.test.ts --runInBand
```

Expected: all tests pass, including the new duplicate replay tests.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git diff -- desktop/src/stores/chatStore.ts desktop/src/stores/chatStore.test.ts
```

Expected: diff is limited to `AskUserQuestion` dedupe helpers, state, handlers, clearing paths, and tests. No unrelated formatting or refactors.

- [ ] **Step 4: Summarize verification results**

Report:

```text
Implemented AskUserQuestion content-signature dedupe in chatStore.
Verified:
- desktop/src/stores/chatStore.test.ts passes
- desktop/src/components/chat/AskUserQuestion.test.tsx passes
Not committed unless explicitly authorized.
```

---

## Self-Review

- Spec coverage: Task 1 covers replay with different ids and later-turn reuse. Tasks 2-3 implement signature generation, first-card preservation, and clearing paths. Task 4 covers verification.
- Placeholder scan: no TBD/TODO/fill-in-later items. Every code-edit step includes exact code.
- Type consistency: `AskUserQuestionDedupe`, `askUserQuestionDedupe`, and `getAskUserQuestionSignature(input: unknown): string | null` are used consistently across tasks.
