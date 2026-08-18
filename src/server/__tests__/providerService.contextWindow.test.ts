import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import type { CreateProviderInput } from '../types/provider.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-cw-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  else delete process.env.CLAUDE_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function sampleInput(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'Test Provider',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key-123',
    apiFormat: 'anthropic',
    models: { main: 'm-main', haiku: 'm-haiku', sonnet: 'm-sonnet', opus: 'm-opus' },
    ...overrides,
  }
}

describe('persistProxyModelContextWindows', () => {
  test('stores proxy windows', async () => {
    const svc = new ProviderService()
    const p = await svc.addProvider(sampleInput())

    await svc.persistProxyModelContextWindows(p.id, { m1: 999, m2: 272000 })

    const { providers } = await svc.listProviders()
    const saved = providers.find((x) => x.id === p.id)!
    expect(saved.proxyModelContextWindows).toEqual({ m1: 999, m2: 272000 })
  })

  test('merges into existing proxy cache and is a no-op for empty input', async () => {
    const svc = new ProviderService()
    const p = await svc.addProvider(sampleInput())

    await svc.persistProxyModelContextWindows(p.id, { a: 1 })
    await svc.persistProxyModelContextWindows(p.id, { b: 2 })
    await svc.persistProxyModelContextWindows(p.id, {})

    const { providers } = await svc.listProviders()
    const saved = providers.find((x) => x.id === p.id)!
    expect(saved.proxyModelContextWindows).toEqual({ a: 1, b: 2 })
  })
})

import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../../utils/model/modelContextWindows.js'

describe('env carries proxy windows', () => {
  test('proxy windows are serialized into env; no user override', async () => {
    const svc = new ProviderService()
    const p = await svc.addProvider(sampleInput())
    await svc.persistProxyModelContextWindows(p.id, { shared: 222, proxyOnly: 333 })

    const env = await svc.getProviderRuntimeEnv(p.id)
    const parsed = JSON.parse(env[MODEL_CONTEXT_WINDOWS_ENV_KEY]!) as Record<string, number>
    expect(parsed).toEqual({ shared: 222, proxyOnly: 333 })
  })
})
