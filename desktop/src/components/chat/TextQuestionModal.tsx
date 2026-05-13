import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

type ExtractedQuestion = {
  question: string
  options: string[]
}

const numberedOption = /^\s*(?:(?:\d+|[A-Za-z])[\.\)）]\s*|[-*•]\s+)(.+)/
const boldOption = /^\s*\*\*(.+?)\*\*(?:\s*[:\-—]\s*(.*))?/
const qaPattern = /^(?:Q|Question|问题|问)[:：]\s*(.+)/i

function hasQuestionMark(text: string): boolean {
  return text.includes('?') || text.includes('？')
}

function lineIsQuestion(trimmed: string): boolean {
  if (!hasQuestionMark(trimmed) || trimmed.length <= 10) return false
  if (trimmed.startsWith('```') || trimmed.startsWith('>') || trimmed.startsWith('//') || trimmed.startsWith('#')) return false
  if (/https?:\/\/\S+\?/.test(trimmed) && !trimmed.replace(/https?:\/\/\S+/g, '').includes('?') && !trimmed.includes('？')) return false
  if (trimmed.startsWith('`') || trimmed.startsWith('|')) return false
  return true
}

function lineIsOption(trimmed: string): string | null {
  const numMatch = trimmed.match(numberedOption)
  if (numMatch) return numMatch[1]!
  const boldMatch = trimmed.match(boldOption)
  if (boldMatch) return boldMatch[1]!
  return null
}

const multiSelectPattern = /多选|可多选|多选题|不定项|multiple.{0,10}(?:choice|select)/i

function detectMultiSelect(question: string): boolean {
  return multiSelectPattern.test(question)
}

/**
 * Extract question sentences from a paragraph (split by '?').
 * Returns individual questions with surrounding context.
 */
function extractQuestionsFromParagraph(text: string): string[] {
  const sentences = text.split(/(?<=[?？])/)
  return sentences
    .map((s) => s.trim())
    .filter((s) => hasQuestionMark(s) && s.length > 10)
}

/**
 * Detect if a text string contains question patterns.
 * More aggressive detection than before — catches questions in
 * paragraphs, Q&A format, and loosely structured text.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '')
}

function extractQuestions(text: string): ExtractedQuestion[] | null {
  if (!text || text.length < 10) return null

  const stripped = stripCodeBlocks(text)
  if (!hasQuestionMark(stripped)) return null

  const lines = stripped.split('\n')
  const results: ExtractedQuestion[] = []

  // Pass 1: Q/A format (Q: ... A: ...)
  let currentQuestion: string | null = null
  let currentOptions: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (!trimmed) continue

    // Check for Q: / Question: format
    const qaMatch = trimmed.match(qaPattern)
    if (qaMatch) {
      if (currentQuestion && currentOptions.length > 0) {
        results.push({ question: currentQuestion, options: currentOptions })
      }
      currentQuestion = qaMatch[1]!
      currentOptions = []
      continue
    }

    const optionText = lineIsOption(trimmed)
    if (optionText) {
      if (currentQuestion) {
        currentOptions.push(optionText)
      } else if (results.length > 0) {
        results[results.length - 1]!.options.push(optionText)
      }
      continue
    }

    if (lineIsQuestion(trimmed)) {
      if (currentQuestion && currentOptions.length >= 1) {
        results.push({ question: currentQuestion, options: currentOptions })
      } else if (currentQuestion && currentOptions.length === 0) {
        results.push({ question: currentQuestion, options: [] })
      }
      currentQuestion = trimmed
      currentOptions = []
    }
  }

  if (currentQuestion) {
    results.push({ question: currentQuestion, options: currentOptions })
  }

  if (results.length > 0) return results

  // Pass 2: scan for any question line followed by numbered/bullet options
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line || !hasQuestionMark(line)) continue
    if (line.length < 10) continue
    if (line.startsWith('```') || line.startsWith('>') || line.startsWith('#')) continue

    const options: string[] = []
    for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
      const opt = lineIsOption(lines[j]!.trim())
      if (opt) {
        options.push(opt)
      } else if (lines[j]!.trim() && !lines[j]!.trim().startsWith('|')) {
        break
      }
    }

    if (options.length >= 1) {
      results.push({ question: line, options })
    }
  }

  if (results.length > 0) return results

  // Pass 3: any text with multiple question marks
  const questionLines = lines
    .map((l) => l.trim())
    .filter(lineIsQuestion)

  if (questionLines.length >= 2) {
    return questionLines.map((q) => ({ question: q, options: [] }))
  }

  // Pass 4: single question with choice words (English or Chinese)
  const choicePattern = /\b(or|versus|vs\.|either|choose|select|pick|prefer|decide|option|choice|which|what)\b|[还是|或者|或|选择|哪个|哪种|哪些|是否|如何|怎么|怎样]/i
  if (
    questionLines.length === 1 &&
    choicePattern.test(questionLines[0]!) &&
    questionLines[0]!.length > 15
  ) {
    return [{ question: questionLines[0]!, options: [] }]
  }

  // Pass 5: extract question sentences from paragraphs (e.g. "xxx? xxx?")
  const paragraphQuestions = extractQuestionsFromParagraph(stripped)
  if (paragraphQuestions.length >= 2) {
    return paragraphQuestions.map((q) => ({ question: q, options: [] }))
  }
  if (paragraphQuestions.length === 1 && paragraphQuestions[0]!.length > 25) {
    return [{ question: paragraphQuestions[0]!, options: [] }]
  }

  // Pass 6: last resort — any line with a question mark that's long enough
  for (const line of lines) {
    const trimmed = line.trim()
    if (hasQuestionMark(trimmed) && trimmed.length > 25 && !trimmed.startsWith('```') && !trimmed.startsWith('>')) {
      return [{ question: trimmed, options: [] }]
    }
  }

  return null
}

const QUESTION_TIMEOUT_MS = 300_000 // 5 minutes

export function TextQuestionModal() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) =>
    activeTabId ? s.sessions[activeTabId] : undefined,
  )
  const sendUserMessage = useChatStore((s) => s.sendMessage)
  const t = useTranslation()

  const [visible, setVisible] = useState(false)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const lastProcessedMessageId = useRef<string | null>(null)
  const expiresAtRef = useRef(0)
  const composingRef = useRef(false)

  const chatState = sessionState?.chatState ?? 'idle'
  const messages = sessionState?.messages ?? []
  const pendingPermission = sessionState?.pendingPermission ?? null

  // Don't show when AskUserQuestionModal is handling a tool-based question
  const askUserQuestionActive =
    pendingPermission?.toolName?.toLowerCase() === 'askuserquestion'

  // Find the last assistant text message
  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg && msg.type === 'assistant_text' && typeof msg.content === 'string') {
        return { id: msg.id, text: msg.content }
      }
    }
    return null
  }, [messages])

  // Extract questions from the last assistant text — only keep those with options (选择题)
  const extractedQuestions = useMemo(() => {
    if (!lastAssistantText) return null
    const all = extractQuestions(lastAssistantText.text)
    if (!all) return null
    const withOptions = all.filter((q) => q.options.length > 0)
    return withOptions.length > 0 ? withOptions : null
  }, [lastAssistantText])

  // Show modal when questions are detected and chat is idle
  useEffect(() => {
    if (
      extractedQuestions &&
      extractedQuestions.length > 0 &&
      chatState === 'idle' &&
      lastAssistantText &&
      lastAssistantText.id !== lastProcessedMessageId.current
    ) {
      lastProcessedMessageId.current = lastAssistantText.id
      setAnswers({})
      setVisible(true)
      expiresAtRef.current = Date.now() + QUESTION_TIMEOUT_MS
      setTimeLeft(Math.ceil(QUESTION_TIMEOUT_MS / 1000))
    }
  }, [extractedQuestions, chatState, lastAssistantText])

  // Countdown timer
  useEffect(() => {
    if (!visible) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000))
      setTimeLeft(left)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [visible])

  // Reset when chat goes back to non-idle (new turn started)
  useEffect(() => {
    if (chatState !== 'idle') {
      lastProcessedMessageId.current = null
      setVisible(false)
    }
  }, [chatState])

  if (!visible || askUserQuestionActive || !extractedQuestions || extractedQuestions.length === 0) return null

  const handleDismiss = () => {
    setVisible(false)
  }

  const handleSubmit = () => {
    if (!activeTabId) return

    const parts: string[] = []
    for (let i = 0; i < extractedQuestions.length; i++) {
      const answer = answers[i]?.trim()
      const question = extractedQuestions[i]!
      if (answer) {
        parts.push(`Q: ${question.question}\nA: ${answer}`)
      }
    }
    const response = parts.join('\n\n')
    if (!response) return

    sendUserMessage(activeTabId, response)
    setVisible(false)
  }

  const allAnswered =
    extractedQuestions.every((_, i) => {
      const a = answers[i]
      return a && a.trim().length > 0
    })

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  return (
    <Modal
      open
      onClose={handleDismiss}
      title={t('question.needsInput')}
      width={560}
      footer={
        <div className="flex items-center gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            {t('common.cancel')}
          </Button>
          <div className="flex-1" />
          {timeLeft > 0 && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {minutes > 0
                ? `${minutes}m ${seconds}s`
                : `${seconds}s`}
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={!allAnswered}
            onClick={handleSubmit}
          >
            {t('question.submit')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {extractedQuestions.map((eq, i) => {
          const hasOptions = eq.options.length > 0
          const isMulti = detectMultiSelect(eq.question)
          const selectedOptions = hasOptions
            ? (answers[i] || '').split('; ').filter(Boolean)
            : []
          const hasAnyOptionSelected = selectedOptions.length > 0
          const isUsingFreeText = hasOptions && !hasAnyOptionSelected && (answers[i]?.trim().length ?? 0) > 0
          return (
            <div key={i}>
              <div className="text-sm text-[var(--color-text-primary)] mb-3">
                <MarkdownRenderer content={eq.question} />
              </div>

              {/* Selectable option cards */}
              {hasOptions && (
                <div className="space-y-2 mb-3">
                  {eq.options.map((opt, j) => {
                    const isSelected = selectedOptions.includes(opt)
                    return (
                      <button
                        key={j}
                        onClick={() => {
                          setAnswers((prev) => {
                            const prevAnswer = prev[i] || ''
                            const prevSelected = prevAnswer.split('; ').filter(Boolean)
                            let next: string
                            if (isMulti) {
                              const nextSelected = isSelected
                                ? prevSelected.filter((o) => o !== opt)
                                : [...prevSelected, opt]
                              next = nextSelected.join('; ')
                            } else {
                              next = isSelected ? '' : opt
                            }
                            return { ...prev, [i]: next }
                          })
                        }}
                        className={`w-full text-left px-4 py-3 rounded-[var(--radius-md)] border transition-all duration-150 cursor-pointer ${
                          isSelected
                            ? 'border-[var(--color-secondary)] bg-[var(--color-secondary)]/8 ring-1 ring-[var(--color-secondary)]/30'
                            : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface)] hover:border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container-low)]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-${isMulti ? '[4px]' : 'full'} border-2 flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'border-[var(--color-secondary)] bg-[var(--color-secondary)]'
                                : 'border-[var(--color-outline)]'
                            }`}
                          >
                            {isSelected && (
                              isMulti ? (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <div className="h-2 w-2 rounded-full bg-white" />
                              )
                            )}
                          </div>
                          <span
                            className={`text-sm font-medium ${
                              isSelected ? 'text-[var(--color-secondary)]' : 'text-[var(--color-text-primary)]'
                            }`}
                          >
                            {opt}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Free text input */}
              <div>
                <label className="text-xs text-[var(--color-text-tertiary)] mb-1.5 block">
                  {hasOptions ? t('question.customResponse') : t('question.typePlaceholder')}
                </label>
                <input
                  type="text"
                  value={hasAnyOptionSelected ? selectedOptions.join('; ') : (isUsingFreeText ? (answers[i] || '') : '')}
                  onChange={(e) => {
                    setAnswers((prev) => ({ ...prev, [i]: e.target.value }))
                  }}
                  onCompositionStart={() => { composingRef.current = true }}
                  onCompositionEnd={() => { composingRef.current = false }}
                  onKeyDown={(e) => {
                    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
                    if (e.key === 'Enter' && allAnswered) handleSubmit()
                  }}
                  placeholder={t('question.typePlaceholder')}
                  className={`w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-outline-variant)]/40 rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-secondary)] focus:ring-1 focus:ring-[var(--color-secondary)]/30 ${
                    hasAnyOptionSelected || isUsingFreeText ? '' : 'opacity-50'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
