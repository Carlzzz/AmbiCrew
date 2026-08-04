# AskUserQuestion Duplicate Dedupe Design

## Problem

In desktop chat, an `AskUserQuestion` prompt can sometimes appear twice in one turn. Only the second card can be answered because the UI stores a single `pendingPermission`, and the later duplicated permission request replaces the earlier one.

The known replay guards dedupe by `toolUseId` or `requestId`, but SDK/CLI replay can produce the same question content with new ids. That bypasses the current guards.

## Goal

When the same unanswered `AskUserQuestion` appears again in the same session, keep the first visible question card and ignore later duplicates so the first card remains answerable.

## Non-goals

- Do not change CLI/SDK replay behavior.
- Do not hide or rewrite answered historical questions.
- Do not add broad dedupe for all tools.
- Do not dedupe genuinely new questions that happen after the previous question is answered or the turn ends.

## Chosen approach

Implement a desktop UI state-layer dedupe in `desktop/src/stores/chatStore.ts`.

Each session tracks the currently unanswered `AskUserQuestion` by a stable signature:

- `signature`
- `toolUseId`
- optional `requestId`

The signature is built from normalized question input:

- `questions[].question`
- `questions[].header`
- `questions[].multiSelect`
- `questions[].options[].label`
- `questions[].options[].description`

The signature excludes response-only fields such as `answers` and `annotations`.

## Event handling

### `tool_use_complete`

If the tool is not `AskUserQuestion`, keep existing behavior.

For `AskUserQuestion`:

1. Build the question signature from `msg.input`.
2. If the current session already has an unanswered `AskUserQuestion` with the same signature, drop this duplicate tool card.
3. Otherwise append the tool card normally and record `{ signature, toolUseId }`.

Existing `toolUseId` replay dedupe remains in place.

### `permission_request`

If the tool is not `AskUserQuestion`, keep existing behavior.

For `AskUserQuestion`:

1. Build the same signature from `msg.input`.
2. If an unanswered `AskUserQuestion` with the same signature already exists:
   - If pending permission already points to the first request, drop the new request.
   - Do not overwrite `pendingPermission` with the duplicate request.
3. If this is the first request for that question, set `pendingPermission` normally and record `requestId`.

This preserves the first card as the answerable one.

### Clearing state

Clear the per-session AskUserQuestion dedupe state when:

- `respondToPermission` is called for the tracked request.
- `message_complete` arrives.
- `error` arrives.
- `stopGeneration` is called.
- `reloadHistory` resets live state.
- `clearMessages` or `/clear` clears the session UI.

## Tests

Add or extend `desktop/src/stores/chatStore.test.ts` with a regression test:

1. Send a first `tool_use_complete` for `AskUserQuestion` with `toolUseId=tool-1` and question input `Q`.
2. Send a first `permission_request` with `requestId=perm-1`, `toolUseId=tool-1`, and input `Q`.
3. Send a duplicate `tool_use_complete` with `toolUseId=tool-2` and the same input `Q`.
4. Send a duplicate `permission_request` with `requestId=perm-2`, `toolUseId=tool-2`, and the same input `Q`.
5. Verify only one `AskUserQuestion` tool card exists.
6. Verify `pendingPermission.requestId` is still `perm-1` and `pendingPermission.toolUseId` is still `tool-1`.
7. Submit an answer and verify the websocket response uses `perm-1`.

Also verify that after `message_complete`, the same question content in a later turn is not deduped.

## Risk and mitigation

Risk: two genuinely separate questions with identical text in the same unfinished turn could be deduped.

Mitigation: scope the dedupe only to one unanswered `AskUserQuestion` per session and clear it on answer/completion/error/stop. This matches the current UI model, which can only hold one pending permission at a time.
