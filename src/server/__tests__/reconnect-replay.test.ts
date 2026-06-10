/**
 * Tests for suppressing stale CLI output when an IM/WebSocket client reconnects.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'node:url'

async function rmWithRetry(targetPath: string): Promise<void> {
  const attempts = process.platform === 'win32' ? 5 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        attempt === attempts - 1 ||
        !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')
      ) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

describe('WebSocket reconnect output filtering', () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string
  let wsUrl: string
  let tmpDir: string
  const originalCliPath = process.env.CLAUDE_CLI_PATH
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-reconnect-replay-'))
    await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_CLI_PATH = fileURLToPath(
      new URL('./fixtures/mock-sdk-cli.ts', import.meta.url)
    )

    const port = 16500 + Math.floor(Math.random() * 1000)
    const { startServer } = await import('../index.js')
    server = startServer(port, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    server?.stop()
    if (tmpDir) await rmWithRetry(tmpDir)
    if (originalCliPath) process.env.CLAUDE_CLI_PATH = originalCliPath
    else delete process.env.CLAUDE_CLI_PATH
    if (originalConfigDir) process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    else delete process.env.CLAUDE_CONFIG_DIR
  })

  async function createSession(): Promise<string> {
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir: process.cwd() }),
    })
    expect(createRes.status).toBe(201)
    const { sessionId } = await createRes.json() as { sessionId: string }
    return sessionId
  }

  it('does not forward stale CLI output that arrives immediately after client reconnect', async () => {
    const sessionId = await createSession()
    const firstMessages: any[] = []
    const firstWs = new WebSocket(`${wsUrl}/ws/${sessionId}`)

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for first turn')), 10000)
        firstWs.onmessage = (event) => {
          const msg = JSON.parse(event.data as string)
          firstMessages.push(msg)
          if (msg.type === 'connected') {
            firstWs.send(JSON.stringify({ type: 'user_message', content: 'fresh question' }))
          }
          if (msg.type === 'message_complete') {
            clearTimeout(timeout)
            firstWs.close(1000, 'test reconnect')
            resolve()
          }
        }
        firstWs.onerror = () => {
          clearTimeout(timeout)
          reject(new Error('first websocket error'))
        }
      })

      expect(firstMessages.some((msg) => msg.type === 'content_delta' && msg.text === 'Echo: fresh question')).toBe(true)

      const reconnectMessages: any[] = []
      const reconnectWs = new WebSocket(`${wsUrl}/ws/${sessionId}`)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reconnectWs.close()
          resolve()
        }, 500)
        reconnectWs.onmessage = (event) => {
          const msg = JSON.parse(event.data as string)
          reconnectMessages.push(msg)
          if (msg.type === 'connected') {
            void import('../services/conversationService.js').then(({ conversationService }) =>
              conversationService.requestControl(sessionId, { subtype: 'emit_replay', text: 'stale replay' }, 1000).catch(() => {})
            )
          }
          if (msg.type === 'content_delta' && msg.text === 'stale replay') {
            clearTimeout(timeout)
            reconnectWs.close()
            reject(new Error('stale replay was forwarded after reconnect'))
          }
        }
        reconnectWs.onerror = () => {
          clearTimeout(timeout)
          reject(new Error('reconnect websocket error'))
        }
      })

      expect(reconnectMessages.some((msg) => msg.type === 'content_delta' && msg.text === 'stale replay')).toBe(false)
    } finally {
      firstWs.close()
      const { conversationService } = await import('../services/conversationService.js')
      conversationService.stopSession(sessionId)
    }
  })
})
