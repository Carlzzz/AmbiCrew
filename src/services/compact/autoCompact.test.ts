import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { getEffectiveContextWindowSize } from './autoCompact.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../../utils/model/modelContextWindows.js'

let originalAutoCompactWindow: string | undefined
let originalContextWindows: string | undefined

beforeEach(() => {
  originalAutoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  originalContextWindows = process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  delete process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
})

afterEach(() => {
  if (originalAutoCompactWindow === undefined) {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  } else {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = originalAutoCompactWindow
  }
  if (originalContextWindows === undefined) {
    delete process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY]
  } else {
    process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY] = originalContextWindows
  }
})

describe('model context window resolution', () => {
  test('uses per-model env overrides', () => {
    process.env[MODEL_CONTEXT_WINDOWS_ENV_KEY] = JSON.stringify({
      'deepseek-v4-pro': 500_000,
      'custom-model': 300_000,
    })

    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(500_000)
    expect(getContextWindowForModel('provider/custom-model')).toBe(300_000)
  })

  test('global auto compact window can raise unknown models above the default', () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '1000000'

    expect(getEffectiveContextWindowSize('unknown-future-model')).toBe(980_000)
  })
})
