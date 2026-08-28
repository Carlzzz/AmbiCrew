import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalAuthMode: string | undefined
let originalProxyUrl: string | undefined
let originalFetch: typeof globalThis.fetch

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-cc-defaults-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalAuthMode = process.env.AUTH_MODE
  originalProxyUrl = process.env.LLM_PROXY_BASE_URL
  originalFetch = globalThis.fetch
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  process.env.AUTH_MODE = 'central'
  process.env.LLM_PROXY_BASE_URL = 'http://127.0.0.1:0/proxy'
})

afterEach(async () => {
  if (originalConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  else delete process.env.CLAUDE_CONFIG_DIR
  if (originalAuthMode !== undefined) process.env.AUTH_MODE = originalAuthMode
  else delete process.env.AUTH_MODE
  if (originalProxyUrl !== undefined) process.env.LLM_PROXY_BASE_URL = originalProxyUrl
  else delete process.env.LLM_PROXY_BASE_URL
  globalThis.fetch = originalFetch
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function seedCentralToken() {
  const dir = process.env.CLAUDE_CONFIG_DIR!
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'central-auth.json'),
    JSON.stringify({ v: 1, access_token: 't-fake', refresh_token: 'r-fake' }),
    'utf-8',
  )
}

async function readProviderModels(svc: ProviderService, id: string) {
  const { providers } = await svc.listProviders()
  return providers.find((p) => p.id === id)!.models
}

describe('ensureActiveProviderSynced — CrewCentral defaults overwrite', () => {
  test('overwrites provider.models when /models returns defaults', async () => {
    await seedCentralToken()
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          items: [],
          defaults: { main: 'remote-main', haiku: 'remote-haiku', sonnet: 'remote-sonnet', opus: 'remote-opus' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof globalThis.fetch

    const svc = new ProviderService()
    // Trigger crewcentral-default seed
    const { activeId } = await svc.listProviders()
    const seedId = activeId!
    await svc.activateProvider(seedId)

    await svc.ensureActiveProviderSynced()

    const models = await readProviderModels(svc, seedId)
    expect(models).toEqual({ main: 'remote-main', haiku: 'remote-haiku', sonnet: 'remote-sonnet', opus: 'remote-opus' })
  })

  test('keeps local models when /models returns 200 but no defaults', async () => {
    await seedCentralToken()
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch

    const svc = new ProviderService()
    const { activeId } = await svc.listProviders()
    const seedId = activeId!
    await svc.activateProvider(seedId)

    const before = await readProviderModels(svc, seedId)
    await svc.ensureActiveProviderSynced()
    const after = await readProviderModels(svc, seedId)
    expect(after).toEqual(before)
  })

  test('keeps local models when fetch fails', async () => {
    await seedCentralToken()
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof globalThis.fetch

    const svc = new ProviderService()
    const { activeId } = await svc.listProviders()
    const seedId = activeId!
    await svc.activateProvider(seedId)

    const before = await readProviderModels(svc, seedId)
    await svc.ensureActiveProviderSynced()
    const after = await readProviderModels(svc, seedId)
    expect(after).toEqual(before)
  })

  test('silently skips fetch when no auth token available', async () => {
    // No seedCentralToken(). Also clear the token-store module cache that may
    // linger from earlier tests in this file.
    const { clearTokens } = await import('../../services/central/token-store.js')
    await clearTokens()
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    const svc = new ProviderService()
    const { activeId } = await svc.listProviders()
    const seedId = activeId!
    await svc.activateProvider(seedId)

    const before = await readProviderModels(svc, seedId)
    await svc.ensureActiveProviderSynced()
    const after = await readProviderModels(svc, seedId)
    expect(called).toBe(false)
    expect(after).toEqual(before)
  })

  test('keeps local models when /models returns partial defaults', async () => {
    await seedCentralToken()
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ items: [], defaults: { main: 'x', haiku: 'y', sonnet: 'z' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof globalThis.fetch

    const svc = new ProviderService()
    const { activeId } = await svc.listProviders()
    const seedId = activeId!
    await svc.activateProvider(seedId)

    const before = await readProviderModels(svc, seedId)
    await svc.ensureActiveProviderSynced()
    const after = await readProviderModels(svc, seedId)
    expect(after).toEqual(before)
  })
})
