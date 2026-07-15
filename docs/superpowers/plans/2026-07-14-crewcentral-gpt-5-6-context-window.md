# CrewCentral GPT-5.6 Context Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CrewCentral/CrewProxy sessions use a 1,000,000-token context window for `openai/gpt-5.6-luna`, `openai/gpt-5.6-sol`, and `openai/gpt-5.6-terra`.

**Architecture:** Add exact model context-window mappings to the existing CrewCentral provider preset. The existing provider environment flow serializes these mappings into `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`, where they override built-in fallback context-window detection.

**Tech Stack:** TypeScript, Bun test runner, JSON provider preset configuration.

## Global Constraints

- Keep the change scoped to CrewCentral/CrewProxy; do not change the global `openai/gpt-5` fallback in `src/utils/model/modelContextWindows.ts`.
- Use exact model IDs: `openai/gpt-5.6-luna`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`.
- Use exact context window value `1000000` for all three GPT-5.6 models.
- Do not add dynamic CrewProxy context metadata parsing in this change.
- Touch only the provider preset and the provider preset tests unless a test command reveals a directly related issue.

---

## File Structure

- `src/server/config/providerPresets.json`
  - Existing provider preset registry.
  - Modify the `crewcentral.modelContextWindows` object to include the three GPT-5.6 IDs with `1000000`.

- `src/server/__tests__/provider-presets.test.ts`
  - Existing Bun tests for provider presets.
  - Add assertions that the CrewCentral preset contains the three GPT-5.6 context-window mappings.

No new files are required.

---

### Task 1: Add CrewCentral GPT-5.6 Context Window Mappings

**Files:**
- Modify: `src/server/config/providerPresets.json`
- Modify: `src/server/__tests__/provider-presets.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_PRESETS` exported by `src/server/config/providerPresets.ts`.
- Produces: CrewCentral preset `modelContextWindows` entries that downstream provider env construction serializes into `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`.

- [ ] **Step 1: Write the failing test assertions**

In `src/server/__tests__/provider-presets.test.ts`, update the test named `configured presets can expose optional API key and promo metadata`.

Add this line near the other provider lookups, after the existing `shengsuanyun` lookup:

```ts
    const crewcentral = PROVIDER_PRESETS.find((preset) => preset.id === 'crewcentral')
```

The lookup block should become:

```ts
    const lmstudio = PROVIDER_PRESETS.find((preset) => preset.id === 'lmstudio')
    const ollama = PROVIDER_PRESETS.find((preset) => preset.id === 'ollama')
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const minimax = PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')
    const jiekouai = PROVIDER_PRESETS.find((preset) => preset.id === 'jiekouai')
    const shengsuanyun = PROVIDER_PRESETS.find((preset) => preset.id === 'shengsuanyun')
    const crewcentral = PROVIDER_PRESETS.find((preset) => preset.id === 'crewcentral')
```

Then add these assertions near the end of the same test, immediately after the existing Shengsuanyun model-context assertion:

```ts
    expect(crewcentral?.modelContextWindows?.['openai/gpt-5.6-luna']).toBe(1000000)
    expect(crewcentral?.modelContextWindows?.['openai/gpt-5.6-sol']).toBe(1000000)
    expect(crewcentral?.modelContextWindows?.['openai/gpt-5.6-terra']).toBe(1000000)
```

The final assertions around the end of the test should read:

```ts
    expect(shengsuanyun?.modelContextWindows?.['anthropic/claude-opus-4.7']).toBe(1000000)
    expect(crewcentral?.modelContextWindows?.['openai/gpt-5.6-luna']).toBe(1000000)
    expect(crewcentral?.modelContextWindows?.['openai/gpt-5.6-sol']).toBe(1000000)
    expect(crewcentral?.modelContextWindows?.['openai/gpt-5.6-terra']).toBe(1000000)
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```powershell
bun test src/server/__tests__/provider-presets.test.ts
```

Expected result: FAIL. The new CrewCentral assertions should fail because the three `openai/gpt-5.6-*` keys are not yet present in `crewcentral.modelContextWindows`.

- [ ] **Step 3: Add the minimal preset mappings**

In `src/server/config/providerPresets.json`, update the final `crewcentral` preset's `modelContextWindows` object.

Replace the current object:

```json
    "modelContextWindows": {
      "MiniMax-M3": 1048576,
      "MiniMax-M2.7-highspeed": 204800,
      "MiniMax-M2.7": 204800
    }
```

with:

```json
    "modelContextWindows": {
      "MiniMax-M3": 1048576,
      "MiniMax-M2.7-highspeed": 204800,
      "MiniMax-M2.7": 204800,
      "openai/gpt-5.6-luna": 1000000,
      "openai/gpt-5.6-sol": 1000000,
      "openai/gpt-5.6-terra": 1000000
    }
```

Do not modify any other provider presets.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```powershell
bun test src/server/__tests__/provider-presets.test.ts
```

Expected result: PASS. The provider preset test suite should pass, including the three new CrewCentral GPT-5.6 assertions.

- [ ] **Step 5: Inspect the diff**

Run:

```powershell
git diff -- src/server/config/providerPresets.json src/server/__tests__/provider-presets.test.ts
```

Expected diff:

- `src/server/config/providerPresets.json` adds exactly three CrewCentral `modelContextWindows` entries.
- `src/server/__tests__/provider-presets.test.ts` adds one `crewcentral` lookup and exactly three assertions.
- No unrelated formatting or provider changes appear.

- [ ] **Step 6: Commit the implementation**

Run:

```powershell
git add src/server/config/providerPresets.json src/server/__tests__/provider-presets.test.ts
git commit -m @'
fix: set CrewCentral GPT-5.6 context windows

Co-Authored-By: Claude <noreply@anthropic.com>
'@
```

Expected result: a commit containing only the preset and test changes.

---

## Verification Checklist

After Task 1 is complete:

- [ ] `bun test src/server/__tests__/provider-presets.test.ts` passes.
- [ ] `git diff HEAD~1..HEAD -- src/server/config/providerPresets.json src/server/__tests__/provider-presets.test.ts` shows only the intended mappings and test assertions.
- [ ] No changes were made to `src/utils/model/modelContextWindows.ts`.

---

## Self-Review Notes

- Spec coverage: The plan adds the three exact CrewCentral GPT-5.6 mappings and verifies them in provider preset tests.
- Placeholder scan: No TBD, TODO, vague future implementation, or missing code snippets remain.
- Type consistency: The test uses existing `PROVIDER_PRESETS` and existing optional `modelContextWindows` access patterns already present in the same test file.
