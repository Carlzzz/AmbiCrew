import { useMemo } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

const TOOL_ICONS: Record<string, string> = {
  Bash: 'terminal',
  Read: 'description',
  Write: 'edit_document',
  Edit: 'edit_note',
  Glob: 'search',
  Grep: 'find_in_page',
  Agent: 'smart_toy',
  WebSearch: 'travel_explore',
  WebFetch: 'cloud_download',
}

const MAX_PREVIEW_LINES = 6
const MAX_PREVIEW_CHARS = 400

function extractStreamingPreview(toolName: string, rawInput: string): string | null {
  if (!rawInput) return null
  try {
    const obj = JSON.parse(rawInput) as Record<string, unknown>
    switch (toolName) {
      case 'Write':
        if (typeof obj.content === 'string') {
          return truncatePreview(obj.content)
        }
        return typeof obj.file_path === 'string' ? obj.file_path : null
      case 'Edit':
        if (typeof obj.new_string === 'string') {
          return truncatePreview(obj.new_string)
        }
        return typeof obj.file_path === 'string' ? obj.file_path : null
      case 'Bash':
        return typeof obj.command === 'string' ? obj.command : null
      case 'Read':
        return typeof obj.file_path === 'string' ? obj.file_path : null
      case 'Glob':
        return typeof obj.pattern === 'string' ? obj.pattern : null
      case 'Grep':
        return typeof obj.pattern === 'string' ? obj.pattern : null
      case 'Agent':
        return typeof obj.description === 'string' ? obj.description : null
      default:
        return null
    }
  } catch {
    // Input is still being streamed and isn't valid JSON yet — try partial extraction
    const filePathMatch = rawInput.match(/"file_path"\s*:\s*"([^"]+)"/)
    if (filePathMatch) return filePathMatch[1]!
    const commandMatch = rawInput.match(/"command"\s*:\s*"([^"]+)"/)
    if (commandMatch) return commandMatch[1]!
    const descMatch = rawInput.match(/"description"\s*:\s*"([^"]+)"/)
    if (descMatch) return descMatch[1]!
    return null
  }
}

function truncatePreview(text: string): string {
  const lines = text.split('\n')
  if (lines.length > MAX_PREVIEW_LINES) {
    return lines.slice(0, MAX_PREVIEW_LINES).join('\n') + '\n...'
  }
  if (text.length > MAX_PREVIEW_CHARS) {
    return text.slice(0, MAX_PREVIEW_CHARS) + '...'
  }
  return text
}

export function StreamingIndicator() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }
  const activeToolName = sessionState?.activeToolName ?? null
  const streamingToolInput = sessionState?.streamingToolInput ?? ''

  const preview = useMemo(
    () => activeToolName ? extractStreamingPreview(activeToolName, streamingToolInput) : null,
    [activeToolName, streamingToolInput],
  )

  let verb: string
  if (statusVerb) {
    verb = statusVerb
  } else {
    verb = chatState === 'thinking' ? 'Thinking' : chatState === 'tool_executing' ? 'Running' : 'Working'
  }

  // Show a pending tool card when we know which tool is being called
  if (activeToolName && chatState === 'tool_executing') {
    const icon = TOOL_ICONS[activeToolName] || 'build'
    return (
      <div className="mb-2 overflow-hidden rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-surface-container-lowest)]">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-[var(--color-brand)] animate-pulse-dot">{icon}</span>
          <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
            {activeToolName}
          </span>
          {preview && !preview.includes('\n') && (
            <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
              {preview}
            </span>
          )}
          {!preview && <span className="flex-1" />}
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] animate-pulse-dot" />
          {elapsedSeconds > 0 && (
            <span className="text-[10px] text-[var(--color-text-tertiary)]">
              {formatElapsed(elapsedSeconds)}
            </span>
          )}
        </div>
        {preview && preview.includes('\n') && (
          <div className="border-t border-[var(--color-border)]/40 px-3 py-2 font-[var(--font-mono)] text-[10px] leading-[1.4] text-[var(--color-text-tertiary)] whitespace-pre-wrap max-h-[120px] overflow-hidden">
            {preview}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mb-2 flex w-fit items-center gap-2 rounded-full border border-[var(--color-border)]/40 bg-[var(--color-surface-container-low)] px-3 py-1">
      <span className="text-[var(--color-brand)] animate-shimmer text-xs">✦</span>
      <span className="text-xs font-medium text-[var(--color-text-secondary)]">{verb}...</span>
      {elapsedSeconds > 0 && (
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {formatElapsed(elapsedSeconds)}
        </span>
      )}
      {tokenUsage.output_tokens > 0 && (
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          · ↓ {tokenUsage.output_tokens}
        </span>
      )}
    </div>
  )
}
