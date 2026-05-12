import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { Modal } from '../shared/Modal'

type QuestionOption = {
  label: string
  description?: string
  preview?: string
}

type Question = {
  question: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

type AskUserInput = {
  questions?: Question[]
  question?: string
  options?: QuestionOption[]
}

function parseQuestions(input: unknown): Question[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as AskUserInput
  if (Array.isArray(obj.questions)) return obj.questions
  if (typeof obj.question === 'string') return [{ question: obj.question, options: obj.options }]
  return []
}

const QUESTION_TIMEOUT_MS = 300_000 // 5 minutes

export function AskUserQuestionModal() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const pendingPermission = useChatStore((s) =>
    activeTabId ? s.sessions[activeTabId]?.pendingPermission : undefined,
  )
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const t = useTranslation()

  const questions = useMemo(
    () => parseQuestions(pendingPermission?.input),
    [pendingPermission?.input],
  )
  const [activeTab, setActiveTab] = useState(0)
  const [selections, setSelections] = useState<Record<number, string[]>>({})
  const [freeTexts, setFreeTexts] = useState<Record<number, string>>({})
  const composingRef = useRef(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const expiresAtRef = useRef(0)
  const lastRequestIdRef = useRef<string | null>(null)

  const isOpen =
    pendingPermission?.toolName?.toLowerCase() === 'askuserquestion' &&
    typeof pendingPermission?.requestId === 'string' &&
    questions.length > 0

  if (pendingPermission && !isOpen) {
    console.log(
      `[AskUserQuestionModal] not open: toolName=${pendingPermission.toolName} requestId=${typeof pendingPermission.requestId} questionsLen=${questions.length} inputType=${typeof pendingPermission.input} inputKeys=${pendingPermission.input && typeof pendingPermission.input === 'object' ? Object.keys(pendingPermission.input as object).join(',') : 'N/A'}`,
    )
  }

  // Reset state when a new permission request arrives
  useEffect(() => {
    if (isOpen && pendingPermission?.requestId !== lastRequestIdRef.current) {
      lastRequestIdRef.current = pendingPermission!.requestId
      setActiveTab(0)
      setSelections({})
      setFreeTexts({})
      expiresAtRef.current = Date.now() + QUESTION_TIMEOUT_MS
      setTimeLeft(Math.ceil(QUESTION_TIMEOUT_MS / 1000))
    }
  }, [isOpen, pendingPermission?.requestId])

  // Countdown timer
  useEffect(() => {
    if (!isOpen) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000))
      setTimeLeft(left)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [isOpen])

  const submitAnswers = (answers: Record<string, string>) => {
    if (!activeTabId || !pendingPermission?.requestId) return
    respondToPermission(activeTabId, pendingPermission.requestId, true, {
      updatedInput: {
        ...(typeof pendingPermission.input === 'object' && pendingPermission.input
          ? (pendingPermission.input as Record<string, unknown>)
          : {}),
        answers,
      },
    })
  }

  const buildAnswers = (): Record<string, string> =>
    questions.reduce<Record<string, string>>((acc, question, index) => {
      const ft = freeTexts[index]?.trim()
      if (selections[index] && selections[index]!.length > 0) {
        acc[question.question] = selections[index]!.join('; ')
      } else if (ft) {
        acc[question.question] = ft
      } else {
        acc[question.question] = ''
      }
      return acc
    }, {})

  // Auto-submit on timeout
  useEffect(() => {
    if (!isOpen || timeLeft > 0) return
    submitAnswers(buildAnswers())
  }, [timeLeft])

  if (!isOpen) return null

  const safeActiveTab = Math.min(activeTab, questions.length - 1)
  const activeQuestion = questions[safeActiveTab]
  if (!activeQuestion) return null

  const currentSelections = selections[safeActiveTab] ?? []

  const toggleOption = (label: string) => {
    setSelections((prev) => {
      const current = prev[safeActiveTab] ?? []
      if (activeQuestion.multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        return { ...prev, [safeActiveTab]: next }
      }
      if (current[0] === label) {
        const next = { ...prev }
        delete next[safeActiveTab]
        return next
      }
      return { ...prev, [safeActiveTab]: [label] }
    })
  }

  const allAnswered = questions.every((_, i) => {
    const sel = selections[i]
    const ft = freeTexts[i]?.trim()
    return (sel && sel.length > 0) || (ft && ft.length > 0)
  })

  const handleSubmit = () => submitAnswers(buildAnswers())

  const handleClose = () => {
    const emptyAnswers = questions.reduce<Record<string, string>>((acc, q) => {
      acc[q.question] = ''
      return acc
    }, {})
    submitAnswers(emptyAnswers)
  }

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  return (
    <Modal
      open
      onClose={handleClose}
      title={questions.length > 1 ? t('question.needsInput') : activeQuestion.question}
      width={560}
      footer={
        <div className="flex items-center gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={handleClose}>
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
      <div className="space-y-4">
        {/* Multi-question tabs */}
        {questions.length > 1 && (
          <div className="flex border-b border-[var(--color-outline-variant)]/20 overflow-x-auto">
            {questions.map((q, i) => {
              const isActive = safeActiveTab === i
              const isAnswered = (selections[i]?.length ?? 0) > 0
              return (
                <button
                  key={i}
                  onClick={() => setActiveTab(i)}
                  className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'text-[var(--color-secondary)]'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  {isAnswered && (
                    <span className="material-symbols-outlined text-[14px] text-[var(--color-success)]">
                      check_circle
                    </span>
                  )}
                  {q.header || `Q${i + 1}`}
                  {isActive && (
                    <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--color-secondary)] rounded-t" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Question text (only if not already in title) */}
        {questions.length > 1 && (
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {activeQuestion.question}
          </p>
        )}

        {/* Options */}
        {activeQuestion.options && activeQuestion.options.length > 0 && (
          <div className="space-y-2">
            {activeQuestion.options.map((opt, idx) => {
              const isSelected = currentSelections.includes(opt.label)
              return (
                <button
                  key={idx}
                  onClick={() => toggleOption(opt.label)}
                  className={`w-full text-left px-4 py-3 rounded-[var(--radius-md)] border transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'border-[var(--color-secondary)] bg-[var(--color-secondary)]/8 ring-1 ring-[var(--color-secondary)]/30'
                      : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface)] hover:border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container-low)]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-${
                        activeQuestion.multiSelect ? '[4px]' : 'full'
                      } border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'border-[var(--color-secondary)] bg-[var(--color-secondary)]'
                          : 'border-[var(--color-outline)]'
                      }`}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-sm font-medium ${
                          isSelected ? 'text-[var(--color-secondary)]' : 'text-[var(--color-text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </span>
                      {opt.description && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                          {opt.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Free text input */}
        <div>
          <label className="text-xs text-[var(--color-text-tertiary)] mb-1.5 block">
            {t('question.customResponse')}
          </label>
          <input
            type="text"
            value={freeTexts[safeActiveTab] || ''}
            onChange={(e) => {
              const idx = safeActiveTab
              setFreeTexts((prev) => ({ ...prev, [idx]: e.target.value }))
            }}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
            onKeyDown={(e) => {
              if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter' && allAnswered) handleSubmit()
            }}
            placeholder={t('question.typePlaceholder')}
            className="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-outline-variant)]/40 rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-secondary)] focus:ring-1 focus:ring-[var(--color-secondary)]/30"
          />
        </div>
      </div>
    </Modal>
  )
}
