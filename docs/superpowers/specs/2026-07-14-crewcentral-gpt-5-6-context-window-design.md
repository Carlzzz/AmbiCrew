# CrewCentral GPT-5.6 Context Window Design

## Goal

CrewProxy now exposes three GPT-5.6 models:

- `openai/gpt-5.6-luna`
- `openai/gpt-5.6-sol`
- `openai/gpt-5.6-terra`

Their real context window is 1,000,000 tokens, but AmbiCrew currently falls back to the built-in OpenAI GPT-5 pattern and treats them as 400K, or to the default 200K in paths that do not match the built-in pattern. The goal is to make CrewCentral/CrewProxy sessions report and use the correct 1M context window for these three models.

## Current Behavior

CrewCentral is defined as a provider preset in `src/server/config/providerPresets.json`. Its `modelContextWindows` currently includes only MiniMax models. When the active provider is CrewCentral, `ProviderService.buildManagedEnv()` writes provider model context mappings into `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`, and `getContextWindowForModel()` reads those mappings through `getConfiguredOrBuiltInModelContextWindow()` before falling back to built-in defaults.

CrewProxy `/models` returns model IDs through `model_id` and aliases through `model_alias`; AmbiCrew maps those to `id` and `alias`. A direct unauthenticated check of the production CrewProxy `/models` endpoint returned 401, so this design uses the expected prefixed IDs provided by the CrewProxy model naming convention.

## Recommended Approach

Add exact CrewCentral preset context-window mappings for the three GPT-5.6 models:

```json
"openai/gpt-5.6-luna": 1000000,
"openai/gpt-5.6-sol": 1000000,
"openai/gpt-5.6-terra": 1000000
```

This is intentionally scoped to the CrewCentral provider preset instead of changing the global OpenAI GPT-5 fallback. That keeps the behavior surgical: only CrewCentral/CrewProxy sessions get the 1M override, and other providers that expose OpenAI-style GPT-5 IDs keep the existing built-in behavior.

## Files to Change

1. `src/server/config/providerPresets.json`
   - Add the three GPT-5.6 model IDs to `crewcentral.modelContextWindows` with value `1000000`.

2. `src/server/__tests__/provider-presets.test.ts`
   - Extend the CrewCentral preset assertions to verify that all three GPT-5.6 models have a 1M context window.

## Data Flow

1. User selects or uses CrewCentral.
2. CrewProxy provides a model ID such as `openai/gpt-5.6-sol`.
3. AmbiCrew builds managed provider environment variables.
4. CrewCentral preset mappings are serialized into `CLAUDE_CODE_MODEL_CONTEXT_WINDOWS`.
5. Context estimation calls `getContextWindowForModel(model, betas)`.
6. The configured mapping wins over the built-in fallback and returns `1_000_000`.

## Error Handling and Scope

No new error handling is needed. If a future CrewProxy model is not listed, AmbiCrew will continue to use existing fallback behavior. This design does not add dynamic parsing of context metadata from CrewProxy because the current request is limited to three known models.

## Testing

Run the provider preset test suite covering `providerPresets.json`. The key assertion is that the CrewCentral preset contains:

- `openai/gpt-5.6-luna` → `1000000`
- `openai/gpt-5.6-sol` → `1000000`
- `openai/gpt-5.6-terra` → `1000000`

If the repository has a broader server test command, run the targeted provider preset test first, then optionally the broader related test group if the targeted command passes.
