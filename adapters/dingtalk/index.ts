/**
 * DingTalk Adapter for Claude Code Desktop.
 *
 * Uses DingTalk Stream to receive bot messages without a public webhook.
 * The desktop Settings page stores clientId/clientSecret via QR registration.
 */

import path from 'node:path'
import { DWClient, TOPIC_CARD, TOPIC_ROBOT } from 'dingtalk-stream'
import { WsBridge, type ServerMessage, type AttachmentRef } from '../common/ws-bridge.js'
import { fetchWithTimeout } from '../common/fetch-with-timeout.js'
import { MessageDedup } from '../common/message-dedup.js'
import { MessageBuffer } from '../common/message-buffer.js'
import { enqueue } from '../common/chat-queue.js'
import { getConfiguredWorkDir, loadConfig } from '../common/config.js'
import { formatImHelp, formatImStatus, formatPermissionRequest, splitMessage } from '../common/format.js'
import {
  formatAskUserQuestion,
  formatPermissionDecisionStatus,
  formatPermissionInstructions,
  parseAskUserQuestionAnswer,
  parsePermissionCommand,
  type PermissionDecision,
} from '../common/permission.js'
import { SessionStore } from '../common/session-store.js'
import { AdapterHttpClient, type RecentProject } from '../common/http-client.js'
import { isAllowedUser, tryPair } from '../common/pairing.js'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import { checkAttachmentLimit } from '../common/attachment/attachment-limits.js'
import {
  extractDingTalkAttachments,
  extractDingTalkText,
  getDingTalkChatId,
  getDingTalkSenderId,
  isDingTalkDirectMessage,
  parseDingTalkPayload,
  type DingTalkRobotMessage,
} from './helpers.js'
import { DingTalkMediaService } from './media.js'
import {
  DingTalkAiCardService,
  type DingTalkAiCardInstance,
  type DingTalkAiCardTarget,
} from './ai-card.js'
import {
  buildDingTalkPermissionCardParams,
  DINGTALK_PERMISSION_CARD_CALLBACK_ROUTE,
  parseDingTalkPermissionCardAction,
} from './permission-card.js'
import { finishAndResetDingTalkStreamingState, resetDingTalkStreamingState } from './stream-state.js'

const DINGTALK_API = 'https://api.dingtalk.com'

const config = loadConfig()
if (!config.dingtalk.clientId || !config.dingtalk.clientSecret) {
  console.error('[DingTalk] Missing DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET. Bind with QR auth in Desktop Settings or set env.')
  process.exit(1)
}
const defaultWorkDir = getConfiguredWorkDir(config, config.dingtalk)
console.log(`[DingTalk] Server URL: ${config.serverUrl}, defaultWorkDir: ${defaultWorkDir}`)

const bridge = new WsBridge(config.serverUrl, 'dingtalk')
const dedup = new MessageDedup()
const sessionStore = new SessionStore()
const httpClient = new AdapterHttpClient(config.serverUrl, { allowedProjectRoots: [defaultWorkDir] })
const attachmentStore = new AttachmentStore()
const media = new DingTalkMediaService(attachmentStore)
const aiCards = new DingTalkAiCardService(getAccessToken, config.dingtalk.clientId)
const sessionWebhooks = new Map<string, string>()
const pendingProjectSelection = new Map<string, boolean>()
const runtimeStates = new Map<string, ChatRuntimeState>()
const aiCardBuffers = new Map<string, MessageBuffer>()
const aiCardTargets = new Map<string, DingTalkAiCardTarget>()
const streamingCards = new Map<string, CardStreamState>()
const streamingCardText = new Map<string, string>()
const disabledCardChats = new Set<string>()
const pendingPermissions = new Map<string, Set<string>>()
const pendingPermissionChats = new Map<string, string>()
const pendingAskUserInputs = new Map<string, unknown>()
const sendFailureCounts = new Map<string, number>()

let accessTokenCache: { token: string; expiresAt: number } | null = null

attachmentStore.gc().catch((err) => {
  console.warn('[DingTalk] AttachmentStore.gc failed:', err instanceof Error ? err.message : err)
})

type ChatRuntimeState = {
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'
  verb?: string
  model?: string
  pendingPermissionCount: number
}

type CardStreamState = {
  cardPromise: Promise<DingTalkAiCardInstance | null>
  createdAt: number
  consecutiveErrors: number
}

const CARD_MAX_CONSECUTIVE_ERRORS = 2
const CARD_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

function getRuntimeState(chatId: string): ChatRuntimeState {
  let state = runtimeStates.get(chatId)
  if (!state) {
    state = { state: 'idle', pendingPermissionCount: 0 }
    runtimeStates.set(chatId, state)
  }
  return state
}

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (accessTokenCache && accessTokenCache.expiresAt > now + 60_000) {
    return accessTokenCache.token
  }

  const res = await fetchWithTimeout(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appKey: config.dingtalk.clientId,
      appSecret: config.dingtalk.clientSecret,
    }),
    timeoutMs: 10_000,
  })
  const data = await res.json().catch(() => null) as { accessToken?: string; expireIn?: number; message?: string } | null
  if (!res.ok || !data?.accessToken) {
    throw new Error(data?.message || `accessToken request failed: ${res.status}`)
  }

  accessTokenCache = {
    token: data.accessToken,
    expiresAt: now + Number(data.expireIn ?? 7200) * 1000,
  }
  return data.accessToken
}

async function sendText(chatId: string, text: string): Promise<void> {
  const sessionWebhook = sessionWebhooks.get(chatId)
  const token = await getAccessToken()

  // If previous sends failed silently, prepend a one-shot notice so the user knows
  // they may have missed something — then clear the counter once we successfully
  // deliver this message.
  const pendingFailures = sendFailureCounts.get(chatId) ?? 0
  let firstChunkPrefix = ''
  if (pendingFailures > 0) {
    firstChunkPrefix = `⚠️ 此前有 ${pendingFailures} 条回复未能送达（网络/钉钉接口故障），如需补发请重新提问。\n\n`
  }

  let anyChunkSent = false
  let firstChunk = true
  for (const chunk of splitMessage(text, 3500)) {
    const effectiveChunk = firstChunk ? firstChunkPrefix + chunk : chunk
    firstChunk = false

    const sent = await trySendChunk(chatId, effectiveChunk, sessionWebhook, token)
    if (sent) {
      anyChunkSent = true
    } else {
      // Count every dropped chunk. We do NOT retry payload (could be huge / sensitive);
      // we only surface the loss on the next successful send.
      sendFailureCounts.set(chatId, (sendFailureCounts.get(chatId) ?? 0) + 1)
      console.error(`[DingTalk] All send methods failed for ${chatId}. Message dropped: ${chunk.slice(0, 100)}...`)
    }
  }

  // Once at least one chunk landed and we surfaced the prior-failure notice, clear it.
  if (anyChunkSent && pendingFailures > 0 && firstChunkPrefix) {
    sendFailureCounts.delete(chatId)
  }
}

/** Try sessionWebhook → OpenAPI for a single chunk. Returns true if delivered. */
async function trySendChunk(
  chatId: string,
  chunk: string,
  sessionWebhook: string | undefined,
  token: string,
): Promise<boolean> {
  if (sessionWebhook) {
    const res = await fetchWithTimeout(sessionWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: 'Claude Code',
          text: chunk,
        },
      }),
      timeoutMs: 15_000,
    }).catch((err) => {
      console.warn(`[DingTalk] sessionWebhook request error: ${err instanceof Error ? err.message : err}`)
      return null
    })
    if (res?.ok) return true
    if (res) {
      const body = await res.text().catch(() => '')
      console.warn(`[DingTalk] sessionWebhook failed (${res.status}), trying OpenAPI fallback. Body: ${body}`)
    }
  }

  return await sendViaOpenApi(chatId, chunk, token)
}

async function sendViaOpenApi(chatId: string, text: string, token?: string): Promise<boolean> {
  // OpenAPI oToMessages only works for DM chats
  if (!chatId.startsWith('dingtalk:dm:')) {
    console.warn(`[DingTalk] OpenAPI fallback not available for group chat: ${chatId}`)
    return false
  }
  const userId = chatId.slice('dingtalk:dm:'.length)
  if (!userId) return false

  try {
    const accessToken = token || await getAccessToken()
    const res = await fetchWithTimeout(`${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        robotCode: config.dingtalk.clientId,
        userIds: [userId],
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ title: 'Claude Code', text }),
      }),
      timeoutMs: 15_000,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[DingTalk] OpenAPI send failed: ${res.status} ${body}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[DingTalk] OpenAPI send error:`, err instanceof Error ? err.message : err)
    return false
  }
}

function getAiCardBuffer(chatId: string): MessageBuffer {
  let buffer = aiCardBuffers.get(chatId)
  if (!buffer) {
    buffer = new MessageBuffer(
      async (text, isComplete) => flushToAiCard(chatId, text, isComplete),
      1200,
      200,
    )
    aiCardBuffers.set(chatId, buffer)
  }
  return buffer
}

function getOrCreateAiCard(chatId: string): Promise<DingTalkAiCardInstance | null> | null {
  const target = aiCardTargets.get(chatId)
  if (!target) return null

  // If the card path has been disabled this turn (too many errors), short-circuit
  if (disabledCardChats.has(chatId)) return null

  let state = streamingCards.get(chatId)

  // Expire stale cards proactively (token might be near expiry, kept hours-long)
  if (state && Date.now() - state.createdAt > CARD_MAX_AGE_MS) {
    console.warn(`[DingTalk][AICard] card for ${chatId} expired by age, recreating`)
    streamingCards.delete(chatId)
    state = undefined
  }

  if (!state) {
    state = {
      cardPromise: aiCards.createForTarget(target),
      createdAt: Date.now(),
      consecutiveErrors: 0,
    }
    streamingCards.set(chatId, state)
  }
  return state.cardPromise
}

/** Mark a card error. Disables the card path for this chat if threshold reached. */
function noteCardError(chatId: string): void {
  const state = streamingCards.get(chatId)
  if (!state) return
  state.consecutiveErrors += 1
  if (state.consecutiveErrors >= CARD_MAX_CONSECUTIVE_ERRORS) {
    console.warn(`[DingTalk][AICard] disabling card path for ${chatId} after ${state.consecutiveErrors} errors`)
    disabledCardChats.add(chatId)
    streamingCards.delete(chatId)
  } else {
    // Drop the failed card so the next flush attempts a fresh one
    streamingCards.delete(chatId)
  }
}

/** Reset success: clear error counter on a card that just streamed/finished OK. */
function noteCardSuccess(chatId: string): void {
  const state = streamingCards.get(chatId)
  if (state) state.consecutiveErrors = 0
}

async function flushToAiCard(chatId: string, newText: string, isComplete: boolean): Promise<void> {
  const fullText = (streamingCardText.get(chatId) ?? '') + newText
  streamingCardText.set(chatId, fullText)
  if (!fullText.trim()) return

  const cardPromise = getOrCreateAiCard(chatId)
  const card = cardPromise ? await cardPromise : null
  if (!card) {
    // Either card path was disabled, or create failed. Track create failures too.
    if (cardPromise && !disabledCardChats.has(chatId)) {
      // createForTarget returned null — count as an error against the chat
      noteCardError(chatId)
    }
    if (isComplete) {
      await sendText(chatId, fullText)
      streamingCardText.delete(chatId)
      aiCardBuffers.get(chatId)?.reset()
      aiCardBuffers.delete(chatId)
    }
    return
  }

  try {
    if (isComplete) {
      await aiCards.finish(card, fullText)
      noteCardSuccess(chatId)
      streamingCards.delete(chatId)
      streamingCardText.delete(chatId)
      aiCardBuffers.get(chatId)?.reset()
      aiCardBuffers.delete(chatId)
    } else {
      await aiCards.stream(card, `${fullText} ▍`, false)
      noteCardSuccess(chatId)
    }
  } catch (err) {
    console.warn('[DingTalk][AICard] stream failed, falling back to markdown:', err instanceof Error ? err.message : err)
    noteCardError(chatId)
    if (isComplete) {
      await sendText(chatId, fullText)
      streamingCardText.delete(chatId)
      aiCardBuffers.get(chatId)?.reset()
      aiCardBuffers.delete(chatId)
    }
  }
}

function clearTransientChatState(chatId: string): void {
  resetDingTalkStreamingState({ aiCardBuffers, streamingCards, streamingCardText, disabledCardChats }, chatId)
  clearPendingPermissions(chatId)
  const runtime = getRuntimeState(chatId)
  runtime.state = 'idle'
  runtime.verb = undefined
  runtime.pendingPermissionCount = 0
}

function clearPendingPermissions(chatId: string): void {
  const pending = pendingPermissions.get(chatId)
  if (pending) {
    for (const requestId of pending) {
      pendingPermissionChats.delete(requestId)
      pendingAskUserInputs.delete(requestId)
    }
  }
  pendingPermissions.delete(chatId)
}

async function ensureExistingSession(chatId: string): Promise<{ sessionId: string; workDir: string } | null> {
  const stored = sessionStore.get(chatId)
  if (!stored) return null

  if (!bridge.hasSession(chatId)) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    bridge.onSessionLost(chatId, () => {
      void sendText(chatId, '⚠️ 与服务器的连接已断开，下次发消息时将自动重新连接。')
    })
    const opened = await bridge.waitForOpen(chatId)
    if (!opened) return null
  }

  return stored
}

async function buildStatusText(chatId: string): Promise<string> {
  const stored = await ensureExistingSession(chatId)
  if (!stored) return formatImStatus(null)

  const runtime = getRuntimeState(chatId)
  let projectName = path.basename(stored.workDir) || stored.workDir
  let branch: string | null = null

  try {
    const gitInfo = await httpClient.getGitInfo(stored.sessionId)
    projectName = gitInfo.repoName || path.basename(gitInfo.workDir) || projectName
    branch = gitInfo.branch
  } catch {
    // Status should still be useful when git lookup fails.
  }

  let taskCounts:
    | {
        total: number
        pending: number
        inProgress: number
        completed: number
      }
    | undefined

  try {
    const tasks = await httpClient.getTasksForSession(stored.sessionId)
    if (tasks.length > 0) {
      taskCounts = {
        total: tasks.length,
        pending: tasks.filter((task) => task.status === 'pending').length,
        inProgress: tasks.filter((task) => task.status === 'in_progress').length,
        completed: tasks.filter((task) => task.status === 'completed').length,
      }
    }
  } catch {
    // Ignore task lookup failures.
  }

  return formatImStatus({
    sessionId: stored.sessionId,
    projectName,
    branch,
    model: runtime.model,
    state: runtime.state,
    verb: runtime.verb,
    pendingPermissionCount: runtime.pendingPermissionCount,
    taskCounts,
  })
}

async function ensureSession(chatId: string): Promise<boolean> {
  if (bridge.hasSession(chatId)) return true

  const stored = sessionStore.get(chatId)
  if (stored) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    bridge.onSessionLost(chatId, () => {
      void sendText(chatId, '⚠️ 与服务器的连接已断开，下次发消息时将自动重新连接。')
    })
    return await bridge.waitForOpen(chatId)
  }

  return await createSessionForChat(chatId, defaultWorkDir)
}

async function createSessionForChat(chatId: string, workDir: string): Promise<boolean> {
  try {
    bridge.resetSession(chatId)
    clearTransientChatState(chatId)

    const sessionId = await httpClient.createSession(workDir)
    sessionStore.set(chatId, sessionId, workDir)
    bridge.connectSession(chatId, sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    bridge.onSessionLost(chatId, () => {
      void sendText(chatId, '⚠️ 与服务器的连接已断开，下次发消息时将自动重新连接。')
    })
    const opened = await bridge.waitForOpen(chatId)
    if (!opened) {
      await sendText(chatId, '⚠️ 连接服务器超时，请重试。')
      return false
    }
    return true
  } catch (err) {
    console.error(`[DingTalk] createSessionForChat failed: workDir=${JSON.stringify(workDir)}, error=`, err instanceof Error ? err.message : err)
    await sendText(chatId, `❌ 无法创建会话: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

function formatProjectList(projects: RecentProject[]): string {
  const lines = projects.slice(0, 10).map((project, index) => {
    const branch = project.branch ? ` (${project.branch})` : ''
    return `${index + 1}. **${project.projectName}**${branch}\n   ${project.realPath}`
  })
  return `选择项目（回复编号）：\n\n${lines.join('\n\n')}\n\n也可以发送 /new <编号或名称>`
}

async function showProjectPicker(chatId: string): Promise<void> {
  try {
    const projects = await httpClient.listRecentProjects()
    if (projects.length === 0) {
      await sendText(chatId, `没有找到最近的项目。发送 /new 会使用默认工作目录：${defaultWorkDir}\n也可以发送 /new /path/to/project 指定项目。`)
      return
    }
    pendingProjectSelection.set(chatId, true)
    await sendText(chatId, formatProjectList(projects))
  } catch (err) {
    await sendText(chatId, `❌ 无法获取项目列表: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function startNewSession(chatId: string, query?: string): Promise<void> {
  bridge.resetSession(chatId)
  sessionStore.delete(chatId)
  clearTransientChatState(chatId)
  pendingProjectSelection.delete(chatId)
  runtimeStates.delete(chatId)

  if (query) {
    try {
      const { project, ambiguous } = await httpClient.matchProject(query)
      if (project) {
        const ok = await createSessionForChat(chatId, project.realPath)
        if (ok) await sendText(chatId, `✅ 已新建会话：**${project.projectName}**${project.branch ? ` (${project.branch})` : ''}`)
        return
      }
      if (ambiguous) {
        const list = ambiguous.map((project, index) => `${index + 1}. **${project.projectName}** — ${project.realPath}`).join('\n')
        await sendText(chatId, `匹配到多个项目，请更精确：\n\n${list}`)
        return
      }
      await sendText(chatId, `未找到匹配 "${query}" 的项目。发送 /projects 查看完整列表。`)
    } catch (err) {
      await sendText(chatId, `❌ ${err instanceof Error ? err.message : String(err)}`)
    }
    return
  }

  const ok = await createSessionForChat(chatId, defaultWorkDir)
  if (ok) await sendText(chatId, '✅ 已新建会话，可以开始对话了。')
}

async function handleServerMessage(chatId: string, msg: ServerMessage): Promise<void> {
  const runtime = getRuntimeState(chatId)

  switch (msg.type) {
    case 'connected':
      break
    case 'status':
      runtime.state = msg.state
      runtime.verb = typeof msg.verb === 'string' ? msg.verb : undefined
      break
    case 'content_start':
      if (msg.blockType === 'text') {
        runtime.state = 'streaming'
      }
      if (msg.blockType === 'tool_use') runtime.state = 'tool_executing'
      break
    case 'content_delta':
      if (typeof msg.text === 'string' && msg.text) getAiCardBuffer(chatId).append(msg.text)
      break
    case 'tool_use_complete':
      runtime.state = 'streaming'
      break
    case 'tool_result':
      if (msg.isError) {
        runtime.state = 'idle'
        runtime.verb = undefined
        await aiCardBuffers.get(chatId)?.complete()
      }
      break
    case 'permission_request': {
      await sendPermissionRequest(chatId, msg)
      break
    }
    case 'message_complete':
      runtime.state = 'idle'
      runtime.verb = undefined
      await aiCardBuffers.get(chatId)?.complete()
      // Re-enable card path for the next user message — disablement is per-turn
      disabledCardChats.delete(chatId)
      break
    case 'error':
      runtime.state = 'idle'
      runtime.verb = undefined
      aiCardBuffers.get(chatId)?.reset()
      streamingCards.delete(chatId)
      streamingCardText.delete(chatId)
      disabledCardChats.delete(chatId)
      await sendText(chatId, `❌ ${msg.message}`)
      break
    case 'system_notification':
      if (msg.subtype === 'init' && msg.data && typeof msg.data === 'object') {
        const model = (msg.data as Record<string, unknown>).model
        if (typeof model === 'string' && model.trim()) runtime.model = model
      }
      break
  }
}

async function sendPermissionRequest(chatId: string, msg: ServerMessage): Promise<void> {
  const runtime = getRuntimeState(chatId)
  runtime.pendingPermissionCount += 1
  runtime.state = 'permission_pending'
  await finishAndResetDingTalkStreamingState({ aiCardBuffers, streamingCards, streamingCardText, disabledCardChats }, chatId)

  const set = pendingPermissions.get(chatId) ?? new Set<string>()
  set.add(msg.requestId)
  pendingPermissions.set(chatId, set)
  pendingPermissionChats.set(msg.requestId, chatId)

  // Track AskUserQuestion input for answer parsing
  if (msg.toolName === 'AskUserQuestion') {
    pendingAskUserInputs.set(msg.requestId, msg.input)
  }

  // Format AskUserQuestion requests so users can pick an option
  if (msg.toolName === 'AskUserQuestion') {
    const formatted = formatAskUserQuestion(msg.input)
    if (formatted) {
      await sendText(chatId, formatted)
      return
    }
  }

  const requestText = formatPermissionRequest(msg.toolName, msg.input, msg.requestId)
  const instructions = formatPermissionInstructions(msg.requestId)
  const templateId = config.dingtalk.permissionCardTemplateId.trim()
  const target = aiCardTargets.get(chatId)

  if (templateId && target) {
    const card = await aiCards.createForTarget(target, {
      cardTemplateId: templateId,
      outTrackId: `permission_${msg.requestId}`,
      callbackRouteKey: DINGTALK_PERMISSION_CARD_CALLBACK_ROUTE,
      cardParamMap: buildDingTalkPermissionCardParams(msg.toolName, msg.input, msg.requestId),
    })
    if (card) {
      await sendText(chatId, `${requestText}\n\n已发送钉钉权限卡片；如果卡片不可见，也可以${instructions}`)
      return
    }
  }

  await sendText(chatId, `${requestText}\n\n${instructions}`)
}

function handlePermissionCommand(chatId: string, text: string): boolean {
  // First, check if there's a pending AskUserQuestion and the text looks like
  // an answer selection (single letter like "A" or "B")
  const pending = pendingPermissions.get(chatId)
  if (pending) {
    for (const requestId of pending) {
      const input = pendingAskUserInputs.get(requestId)
      if (input) {
        const updatedInput = parseAskUserQuestionAnswer(text, input)
        if (updatedInput) {
          applyAskUserAnswer(chatId, requestId, updatedInput)
          return true
        }
      }
    }
  }

  const decision = parsePermissionCommand(text, pending)
  if (!decision) return false

  const sent = applyPermissionDecision(chatId, decision)
  if (!sent) return true

  void sendText(chatId, formatPermissionDecisionStatus(decision))
  return true
}

function applyAskUserAnswer(
  chatId: string,
  requestId: string,
  updatedInput: Record<string, unknown>,
): void {
  const pending = pendingPermissions.get(chatId)
  if (!pending?.has(requestId)) return

  const sent = bridge.sendPermissionResponse(chatId, requestId, true, undefined, updatedInput)
  if (!sent) {
    void sendText(chatId, '回答发送失败，请检查会话状态。')
    return
  }

  pending.delete(requestId)
  pendingPermissionChats.delete(requestId)
  pendingAskUserInputs.delete(requestId)
  const runtime = getRuntimeState(chatId)
  runtime.pendingPermissionCount = Math.max(0, runtime.pendingPermissionCount - 1)

  const answerSummary = Object.entries(updatedInput.answers as Record<string, string> ?? {})
    .map(([q, a]) => `${a}`)
    .join(', ')
  void sendText(chatId, `✅ 已选择：${answerSummary}`)
}

function applyPermissionDecision(chatId: string, decision: PermissionDecision): boolean {
  const { requestId, allowed, rule, updatedInput } = decision
  const pending = pendingPermissions.get(chatId)
  if (!pending?.has(requestId)) {
    void sendText(chatId, `未找到待确认的权限请求：${requestId}`)
    return false
  }

  const sent = bridge.sendPermissionResponse(chatId, requestId, allowed, rule, updatedInput)
  if (!sent) {
    void sendText(chatId, '权限响应发送失败，请检查会话状态。')
    return false
  }

  pending.delete(requestId)
  pendingPermissionChats.delete(requestId)
  pendingAskUserInputs.delete(requestId)
  const runtime = getRuntimeState(chatId)
  runtime.pendingPermissionCount = Math.max(0, runtime.pendingPermissionCount - 1)
  return sent
}

async function routeUserMessage(chatId: string, text: string, attachments: AttachmentRef[] = []): Promise<void> {
  enqueue(chatId, async () => {
    const trimmed = text.trim()
    const hasAttachments = attachments.length > 0

    if (!hasAttachments && handlePermissionCommand(chatId, trimmed)) return

    if (!hasAttachments && pendingProjectSelection.has(chatId)) {
      if (trimmed) await startNewSession(chatId, trimmed)
      return
    }

    if (!hasAttachments && (trimmed === '/new' || trimmed === '新会话' || trimmed.startsWith('/new '))) {
      const arg = trimmed.startsWith('/new ') ? trimmed.slice(5).trim() : ''
      await startNewSession(chatId, arg || undefined)
      return
    }
    if (!hasAttachments && (trimmed === '/help' || trimmed === '帮助')) {
      await sendText(chatId, formatImHelp())
      return
    }
    if (!hasAttachments && (trimmed === '/status' || trimmed === '状态')) {
      await sendText(chatId, await buildStatusText(chatId))
      return
    }
    if (!hasAttachments && (trimmed === '/clear' || trimmed === '清空')) {
      const stored = await ensureExistingSession(chatId)
      if (!stored) {
        await sendText(chatId, formatImStatus(null))
        return
      }
      clearTransientChatState(chatId)
      if (!bridge.sendUserMessage(chatId, '/clear')) {
        await sendText(chatId, '⚠️ 无法发送 /clear，请先发送 /new 重新连接会话。')
        return
      }
      await sendText(chatId, '🧹 已清空当前会话上下文。')
      return
    }
    if (!hasAttachments && (trimmed === '/stop' || trimmed === '停止')) {
      const stored = await ensureExistingSession(chatId)
      if (!stored) {
        await sendText(chatId, formatImStatus(null))
        return
      }
      bridge.sendStopGeneration(chatId)
      await sendText(chatId, '⏹ 已发送停止信号。')
      return
    }
    if (!hasAttachments && (trimmed === '/projects' || trimmed === '项目列表')) {
      await showProjectPicker(chatId)
      return
    }

    const ready = await ensureSession(chatId)
    if (!ready) {
      // Session is dead — clean up and auto-recreate
      sessionStore.delete(chatId)
      bridge.resetSession(chatId)
      clearTransientChatState(chatId)
      const retried = await createSessionForChat(chatId, defaultWorkDir)
      if (!retried) return
      // Retry sending the original message on the new session
    }
    const effectiveText = trimmed || (attachments.length > 0 ? '(用户发送了附件)' : '')
    if (!effectiveText && attachments.length === 0) return
    if (!bridge.sendUserMessage(chatId, effectiveText, attachments.length ? attachments : undefined)) {
      await sendText(chatId, '⚠️ 消息发送失败，连接可能已断开。请发送 /new 重新开始。')
    }
  })
}

async function handleRobotMessage(data: DingTalkRobotMessage): Promise<void> {
  if (!isDingTalkDirectMessage(data)) return

  const chatId = getDingTalkChatId(data)
  const userId = getDingTalkSenderId(data)
  const text = extractDingTalkText(data)
  const mediaCandidates = extractDingTalkAttachments(data)
  if (!chatId || !userId || (!text && mediaCandidates.length === 0)) return

  if (data.sessionWebhook) sessionWebhooks.set(chatId, data.sessionWebhook)

  if (!isAllowedUser('dingtalk', userId)) {
    const success = tryPair(text, { userId, displayName: data.senderNick || 'DingTalk User' }, 'dingtalk')
    await sendText(
      chatId,
      success
        ? '✅ 配对成功！现在可以开始聊天了。\n\n发送消息即可与 Claude 对话。发送 /help 查看可用命令。'
        : '🔒 未授权。请先在 Claude Code 桌面端完成钉钉扫码绑定，再生成 IM 配对码后发送给我。',
    )
    return
  }

  aiCardTargets.set(chatId, { type: 'user', userId })
  const attachments = await collectAttachments(chatId, mediaCandidates)
  await routeUserMessage(chatId, text, attachments)
}

async function handleCardCallback(raw: unknown): Promise<void> {
  const action = parseDingTalkPermissionCardAction(raw)
  if (!action) return

  const chatId = action.chatId && pendingPermissions.has(action.chatId)
    ? action.chatId
    : pendingPermissionChats.get(action.requestId)
  if (!chatId) {
    console.warn(`[DingTalk][Card] permission request not found: ${action.requestId}`)
    return
  }

  if (applyPermissionDecision(chatId, action)) {
    await sendText(chatId, formatPermissionDecisionStatus(action))
  }
}

async function collectAttachments(
  chatId: string,
  candidates: ReturnType<typeof extractDingTalkAttachments>,
): Promise<AttachmentRef[]> {
  if (candidates.length === 0) return []
  const stored = sessionStore.get(chatId)
  const sessionId = stored?.sessionId ?? chatId
  let token: string
  try {
    token = await getAccessToken()
  } catch (err) {
    console.error('[DingTalk] access token for attachment download failed:', err)
    await sendText(chatId, '📎 附件下载授权失败，请稍后重试。')
    return []
  }

  const settled = await Promise.allSettled(
    candidates.map((candidate) =>
      media.downloadCandidate(candidate, sessionId, {
        clientId: config.dingtalk.clientId,
        accessToken: token,
      }),
    ),
  )
  const attachments: AttachmentRef[] = []
  let failures = 0
  for (const result of settled) {
    if (result.status === 'rejected') {
      failures += 1
      console.error('[DingTalk] media download failed:', result.reason)
      continue
    }
    const local = result.value
    const check = checkAttachmentLimit(local.kind, local.size, local.mimeType)
    if (!check.ok) {
      await sendText(chatId, check.hint)
      continue
    }
    if (local.kind === 'image') {
      attachments.push({
        type: 'image',
        name: local.name,
        data: local.buffer.toString('base64'),
        mimeType: local.mimeType,
      })
    } else {
      attachments.push({
        type: 'file',
        name: local.name,
        path: local.path,
        mimeType: local.mimeType,
      })
    }
  }
  if (failures > 0) {
    await sendText(
      chatId,
      failures === candidates.length ? '📎 附件下载失败，请稍后重试。' : `📎 ${failures} 个附件下载失败，已跳过。`,
    )
  }
  return attachments
}

async function start(): Promise<void> {
  const client = new DWClient({
    clientId: config.dingtalk.clientId,
    clientSecret: config.dingtalk.clientSecret,
    endpoint: config.dingtalk.endpoint,
    autoReconnect: true,
    keepAlive: true,
  } as any)

  client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
    const messageId = res.headers?.messageId
    if (messageId) {
      client.socketCallBackResponse(messageId, { success: true })
      if (!dedup.tryRecord(`header:${messageId}`)) return
    }

    const data = parseDingTalkPayload(res.data)
    if (!data) return
    if (data.msgId && !dedup.tryRecord(`body:${data.msgId}`)) return

    await handleRobotMessage(data)
  })

  client.registerCallbackListener(TOPIC_CARD, async (res: any) => {
    const messageId = res.headers?.messageId
    if (messageId) {
      client.socketCallBackResponse(messageId, { success: true })
      if (!dedup.tryRecord(`card:${messageId}`)) return
    }

    await handleCardCallback(res.data ?? res)
  })

  await client.connect()
  console.log(`[DingTalk] Stream connected. Server: ${config.serverUrl}`)

  const shutdown = async () => {
    console.log('[DingTalk] Shutting down...')
    bridge.destroy()
    dedup.destroy()
    try {
      await client.disconnect()
    } catch {
      // ignore
    }
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

start().catch((err) => {
  console.error('[DingTalk] Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
