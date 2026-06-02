/**
 * Tests for auth_restart behavior when CLI reports invalid_api_key
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

describe('Auth Restart on invalid_api_key', () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string
  let wsUrl: string
  let tmpDir: string
  const originalCliPath = process.env.CLAUDE_CLI_PATH

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-auth-restart-'))
    await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    process.env.CLAUDE_CLI_PATH = fileURLToPath(
      new URL('./fixtures/mock-sdk-cli.ts', import.meta.url)
    )

    const port = 15000 + Math.floor(Math.random() * 1000)
    const { startServer } = await import('../index.js')
    server = startServer(port, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    server?.stop()
    if (tmpDir) {
      await rmWithRetry(tmpDir)
    }
    if (originalCliPath) {
      process.env.CLAUDE_CLI_PATH = originalCliPath
    } else {
      delete process.env.CLAUDE_CLI_PATH
    }
    delete process.env.CLAUDE_CONFIG_DIR
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

  it('should return auth_restarting + status:idle on first invalid_api_key', async () => {
    const sessionId = await createSession()
    const messages: any[] = []
    const ws = new WebSocket(`${wsUrl}/ws/${sessionId}`)

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error('Timed out'))
        }, 10000)

        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string)
          messages.push(msg)
          if (msg.type === 'connected') {
            ws.send(JSON.stringify({ type: 'user_message', content: 'trigger api error invalid_api_key' }))
          }
          // Resolve when we get auth_restarting + status:idle
          if (msg.type === 'status' && msg.state === 'idle' && messages.some(m => m.type === 'auth_restarting')) {
            clearTimeout(timeout)
            ws.close()
            resolve()
          }
          if (msg.type === 'error') {
            clearTimeout(timeout)
            ws.close()
            reject(new Error(msg.message))
          }
        }

        ws.onerror = () => {
          clearTimeout(timeout)
          ws.close()
          reject(new Error('WebSocket error'))
        }
      })

      // Verify auth_restarting was sent
      const authRestarting = messages.find(m => m.type === 'auth_restarting')
      expect(authRestarting).toBeDefined()
      expect(authRestarting?.attempt).toBe(1)

      // Verify status:idle was sent
      const idleStatus = messages.find(m => m.type === 'status' && m.state === 'idle')
      expect(idleStatus).toBeDefined()

      // Should NOT have sent an error on first attempt
      const errorMsg = messages.find(m => m.type === 'error')
      expect(errorMsg).toBeUndefined()
    } finally {
      ws.close()
      const { conversationService } = await import('../services/conversationService.js')
      conversationService.stopSession(sessionId)
    }
  })
})
