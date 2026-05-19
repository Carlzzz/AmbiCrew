export type PermissionDecision = {
  requestId: string
  allowed: boolean
  rule?: 'always'
  updatedInput?: Record<string, unknown>
}

function getSinglePendingRequestId(requestIds?: Iterable<string> | null): string | null {
  if (!requestIds) return null
  const ids = Array.from(requestIds)
  return ids.length === 1 ? ids[0]! : null
}

export function parsePermissionCommand(
  text: string,
  pendingRequestIds?: Iterable<string> | null,
): PermissionDecision | null {
  const trimmed = text.trim()
  const match = text.trim().match(/^\/(allow|always|allow-always|deny)\s+(\S+)/i)
  if (match) {
    const action = match[1]!.toLowerCase()
    const requestId = match[2]!
    if (action === 'deny') return { requestId, allowed: false }
    if (action === 'always' || action === 'allow-always') return { requestId, allowed: true, rule: 'always' }
    return { requestId, allowed: true }
  }

  const requestId = getSinglePendingRequestId(pendingRequestIds)
  if (!requestId) return null

  const shortcut = trimmed.toLowerCase()
  if (['1', '/1', 'allow', '/allow', 'y', 'yes', '允许', '允许一次', '同意', '批准'].includes(shortcut)) {
    return { requestId, allowed: true }
  }
  if (['2', '/2', 'always', '/always', 'allow-always', '/allow-always', '永久允许', '一直允许'].includes(shortcut)) {
    return { requestId, allowed: true, rule: 'always' }
  }
  if (['3', '/3', 'deny', '/deny', 'n', 'no', '拒绝', '不允许', '否'].includes(shortcut)) {
    return { requestId, allowed: false }
  }

  return null
}

/**
 * Parse an AskUserQuestion permission input and format it as a user-friendly
 * message showing numbered options.  Returns null if the input is not a
 * recognizable AskUserQuestion payload.
 */
export function formatAskUserQuestion(input: unknown): string | null {
  const questions = extractQuestions(input)
  if (!questions || questions.length === 0) return null

  const parts: string[] = ['💬 需要回答以下问题：']
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]!
    parts.push('')
    if (questions.length > 1) parts.push(`**问题 ${qi + 1}：${q.question}**`)
    else parts.push(`**${q.question}**`)

    const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    for (let oi = 0; oi < q.options.length; oi++) {
      const opt = q.options[oi]!
      const letter = labels[oi] ?? String(oi + 1)
      const desc = opt.description ? ` — ${opt.description}` : ''
      parts.push(`${letter}. ${opt.label}${desc}`)
    }

    if (q.multiSelect) {
      parts.push('(可多选，逗号分隔，如: A,C)')
    }
  }

  parts.push('')
  parts.push('回复选项字母（如 A），或回复 /deny 拒绝回答。')
  return parts.join('\n')
}

/**
 * Try to parse a user's answer to an AskUserQuestion as updatedInput.
 * Returns the updatedInput for sendPermissionResponse, or null if the text
 * is not a valid answer.
 */
export function parseAskUserQuestionAnswer(
  text: string,
  input: unknown,
): Record<string, unknown> | null {
  const questions = extractQuestions(input)
  if (!questions || questions.length === 0) return null

  const trimmed = text.trim().toUpperCase()
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

  const answers: Record<string, string> = {}

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]!
    const optionCount = q.options.length

    // For the first (or only) question, check if the text is a single label
    // like "A", "B", "C"
    if (qi === 0 && trimmed.length === 1) {
      const idx = labels.indexOf(trimmed)
      if (idx >= 0 && idx < optionCount) {
        answers[q.question] = q.options[idx]!.label
        continue
      }
    }

    // Multi-letter match like "A,C" for multiSelect
    if (q.multiSelect && trimmed.includes(',')) {
      const picks = trimmed.split(',').map(s => s.trim()).filter(Boolean)
      const validPicks: string[] = []
      for (const pick of picks) {
        const idx = labels.indexOf(pick)
        if (idx >= 0 && idx < optionCount) {
          validPicks.push(q.options[idx]!.label)
        }
      }
      if (validPicks.length > 0) {
        answers[q.question] = validPicks.join(', ')
        continue
      }
    }

    // Label match (like "A" or "B")
    const idx = labels.indexOf(trimmed)
    if (idx >= 0 && idx < optionCount) {
      answers[q.question] = q.options[idx]!.label
      continue
    }

    // Label match with prefix like "A." or "A)"
    if (trimmed.length >= 2) {
      const letter = trimmed[0]!
      const idx2 = labels.indexOf(letter)
      if (idx2 >= 0 && idx2 < optionCount) {
        answers[q.question] = q.options[idx2]!.label
        continue
      }
    }

    return null
  }

  if (Object.keys(answers).length === 0) return null

  return { questions: (input as any)?.questions, answers }
}

type ParsedQuestion = {
  question: string
  options: Array<{ label: string; description: string }>
  multiSelect: boolean
}

function extractQuestions(input: unknown): ParsedQuestion[] | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const questions = obj.questions
  if (!Array.isArray(questions) || questions.length === 0) return null

  const result: ParsedQuestion[] = []
  for (const q of questions) {
    if (!q || typeof q !== 'object') return null
    const qi = q as Record<string, unknown>
    const question = typeof qi.question === 'string' ? qi.question : ''
    const multiSelect = qi.multiSelect === true
    const opts = Array.isArray(qi.options) ? qi.options : []
    const options: ParsedQuestion['options'] = []
    for (const o of opts) {
      if (!o || typeof o !== 'object') continue
      const oi = o as Record<string, unknown>
      options.push({
        label: typeof oi.label === 'string' ? oi.label : '',
        description: typeof oi.description === 'string' ? oi.description : '',
      })
    }
    if (options.length === 0) return null
    result.push({ question, options, multiSelect })
  }
  return result
}

export function parsePermitCallbackData(data: string): PermissionDecision | null {
  const parts = data.split(':')
  if (parts.length !== 3 || parts[0] !== 'permit' || !parts[1]) return null

  switch (parts[2]) {
    case 'yes':
      return { requestId: parts[1], allowed: true }
    case 'always':
      return { requestId: parts[1], allowed: true, rule: 'always' }
    case 'no':
      return { requestId: parts[1], allowed: false }
    default:
      return null
  }
}

export function formatPermissionInstructions(requestId: string): string {
  return [
    '回复 1 允许一次，2 永久允许，3 拒绝。',
    `也可回复 /allow ${requestId}、/always ${requestId}、/deny ${requestId}。`,
  ].join('\n')
}

export function formatPermissionDecisionStatus(decision: Pick<PermissionDecision, 'allowed' | 'rule'>): string {
  if (!decision.allowed) return '❌ 已拒绝'
  return decision.rule === 'always' ? '♾️ 已永久允许' : '✅ 已允许'
}
