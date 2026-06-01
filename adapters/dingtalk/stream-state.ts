import type { MessageBuffer } from '../common/message-buffer.js'
import type { DingTalkAiCardInstance } from './ai-card.js'

export type CardStreamState = {
  cardPromise: Promise<DingTalkAiCardInstance | null>
  createdAt: number
  consecutiveErrors: number
}

export type DingTalkStreamingState = {
  aiCardBuffers: Map<string, MessageBuffer>
  streamingCards: Map<string, CardStreamState>
  streamingCardText: Map<string, string>
  disabledCardChats?: Set<string>
}

export function resetDingTalkStreamingState(
  state: DingTalkStreamingState,
  chatId: string,
): void {
  state.aiCardBuffers.get(chatId)?.reset()
  state.aiCardBuffers.delete(chatId)
  state.streamingCards.delete(chatId)
  state.streamingCardText.delete(chatId)
  state.disabledCardChats?.delete(chatId)
}

export async function finishAndResetDingTalkStreamingState(
  state: DingTalkStreamingState,
  chatId: string,
): Promise<void> {
  await state.aiCardBuffers.get(chatId)?.complete()
  resetDingTalkStreamingState(state, chatId)
}
