import { useMemo, useCallback, memo } from 'react'
import DOMPurify from 'dompurify'
import { marked, type Tokens } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { CodeViewer } from '../chat/CodeViewer'
import { MermaidRenderer } from '../chat/MermaidRenderer'

type Props = {
  content: string
  variant?: 'default' | 'document'
  className?: string
}

type CodeBlock = {
  id: string
  code: string
  language: string | undefined
}

type ParsedMarkdown = { html: string; codeBlocks: CodeBlock[] }

// FNV-1a hash for fast cache key generation
function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function makeCacheKey(content: string): string {
  return `${content.length}:${fnv1a(content)}`
}

// Module-level LRU cache for finalized (complete) markdown renders
const FINALIZED_CACHE_MAX = 200
const finalizedCache = new Map<string, ParsedMarkdown>()

// Smaller cache for streaming content that changes frequently
const STREAMING_CACHE_MAX = 4
const streamingCache = new Map<string, ParsedMarkdown>()

function getCachedParse(content: string, isStreaming: boolean): ParsedMarkdown {
  const key = makeCacheKey(content)
  const cache = isStreaming ? streamingCache : finalizedCache
  const maxSize = isStreaming ? STREAMING_CACHE_MAX : FINALIZED_CACHE_MAX

  const cached = cache.get(key)
  if (cached) {
    // Move to end (most recently used)
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const result = parseMarkdown(content)
  cache.set(key, result)

  // Evict oldest entries if over capacity
  if (cache.size > maxSize) {
    const firstKey = cache.keys().next().value!
    cache.delete(firstKey)
  }

  return result
}

const MERMAID_LANGUAGE = 'mermaid'
const PLAINTEXT_LANGUAGES = new Set(['', 'text', 'plaintext', 'plain'])
const MERMAID_DIAGRAM_START = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|requirementDiagram|quadrantChart|xychart-beta|sankey-beta|block-beta|packet-beta|architecture|kanban)\b/i

function normalizeCodeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().split(/\s+/)[0]?.toLowerCase()
  return normalized || undefined
}

function looksLikeMermaid(code: string): boolean {
  const firstMeaningfulLine = code
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return firstMeaningfulLine ? MERMAID_DIAGRAM_START.test(firstMeaningfulLine) : false
}

function shouldRenderAsMermaid(block: CodeBlock): boolean {
  const normalizedLanguage = normalizeCodeLanguage(block.language)

  if (normalizedLanguage === MERMAID_LANGUAGE) {
    return true
  }

  if (!PLAINTEXT_LANGUAGES.has(normalizedLanguage ?? '')) {
    return false
  }

  return looksLikeMermaid(block.code)
}

const renderer = new marked.Renderer()

let pendingCodeBlocks: CodeBlock[] = []

renderer.code = function ({ text, lang }: Tokens.Code) {
  const id = `cb-${pendingCodeBlocks.length}`
  pendingCodeBlocks.push({
    id,
    code: text,
    language: normalizeCodeLanguage(lang || undefined),
  })
  return `<div data-codeblock-id="${id}"></div>`
}

marked.setOptions({
  breaks: true,
  gfm: true,
})
marked.use({ renderer })

function enhanceMarkdownHtml(html: string): string {
  const cleanHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: ['use', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'math', 'mpadded', 'menclose', 'mglyph', 'mlabeledtr', 'mmultiscripts', 'mphantom', 'mstyle'],
    ADD_ATTR: ['xlink:href', 'xmlns', 'mathvariant', 'encoding', 'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'columnalign', 'rowalign', 'columnspan', 'rowspan', 'displaystyle', 'scriptlevel', 'lspace', 'rspace', 'minsize', 'maxsize', 'movablelimits', 'linethickness', 'notation', 'width', 'height', 'depth', 'voffset'],
  })

  if (typeof document === 'undefined') {
    return cleanHtml
  }

  const container = document.createElement('div')
  container.innerHTML = cleanHtml

  container.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('md-table-wrap')) return
    const wrapper = document.createElement('div')
    wrapper.className = 'md-table-wrap'
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })

  container.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noreferrer noopener')
  })

  return container.innerHTML
}

// --- LaTeX math rendering ---
// Replace $$...$$ (block) and $...$ (inline) with KaTeX-rendered HTML
// before passing to marked, to avoid markdown parser mangling the LaTeX.

function renderMathExpressions(content: string): string {
  // First, replace block math: $$...$$
  let result = content.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })
    } catch {
      return `<pre class="katex-error">${escapeHtml(expr)}</pre>`
    }
  })

  // Then, replace inline math: $...$
  // Avoid matching currency like "$5" or "$5.00" — require non-digit after opening $
  result = result.replace(/\$([^\s$](?:[^$]*[^\s$])?)\$/g, (_match, expr: string) => {
    // Skip if it looks like a currency amount
    if (/^\d/.test(expr)) return _match
    try {
      return katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })
    } catch {
      return `<code class="katex-error">${escapeHtml(expr)}</code>`
    }
  })

  return result
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function contentHasMath(content: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\s$][^$]*[^\s$]\$/.test(content)
}

function parseMarkdown(content: string): { html: string; codeBlocks: CodeBlock[] } {
  pendingCodeBlocks = []
  // Pre-process math expressions before markdown parsing
  const preprocessed = contentHasMath(content) ? renderMathExpressions(content) : content
  const html = marked.parse(preprocessed) as string
  const codeBlocks = [...pendingCodeBlocks]
  pendingCodeBlocks = []
  return { html, codeBlocks }
}

const BASE_PROSE_CLASSES = `markdown-prose prose prose-sm max-w-none text-[var(--color-text-primary)]
  prose-headings:text-[var(--color-text-primary)] prose-headings:font-semibold
  prose-p:my-2 prose-p:leading-relaxed
  prose-p:break-words
  prose-code:text-[13px] prose-code:text-[var(--color-code-fg)] prose-code:font-[var(--font-mono)] prose-code:bg-[var(--color-code-bg)] prose-code:border prose-code:border-[var(--color-border)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:hidden prose-code:after:hidden
  prose-pre:!bg-transparent prose-pre:!p-0 prose-pre:!shadow-none
  prose-a:text-[var(--color-text-accent)] prose-a:no-underline hover:prose-a:underline prose-a:break-all
  prose-strong:text-[var(--color-text-primary)]
  prose-em:text-[var(--color-text-secondary)]
  prose-blockquote:text-[var(--color-text-secondary)] prose-blockquote:italic
  prose-blockquote:border-l-4 prose-blockquote:border-[var(--color-outline-variant)] prose-blockquote:bg-[var(--color-surface-container-low)] prose-blockquote:my-4 prose-blockquote:rounded-r-lg prose-blockquote:px-4 prose-blockquote:py-2
  prose-ul:my-2 prose-ol:my-2
  prose-li:my-0.5
  prose-table:my-0 prose-table:w-full prose-table:table-auto prose-table:text-sm
  prose-th:bg-[var(--color-surface-info)] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:whitespace-normal prose-th:break-words prose-th:align-top prose-th:border-b prose-th:border-[var(--color-border)]
  prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-[var(--color-border)] prose-td:whitespace-normal prose-td:break-words prose-td:align-top prose-td:bg-[var(--color-surface)]
  [&_.md-table-wrap]:my-5 [&_.md-table-wrap]:overflow-x-auto [&_.md-table-wrap]:rounded-xl [&_.md-table-wrap]:border [&_.md-table-wrap]:border-[var(--color-border)] [&_.md-table-wrap]:bg-[var(--color-surface-container-lowest)]`

const DOCUMENT_PROSE_CLASSES = `
  prose-p:text-[15px] prose-p:leading-7
  prose-headings:scroll-mt-6 prose-headings:tracking-[-0.01em]
  prose-h1:mb-4 prose-h1:text-2xl prose-h1:font-semibold prose-h1:leading-tight
  prose-h2:mt-8 prose-h2:mb-3 prose-h2:border-b prose-h2:border-[var(--color-border)] prose-h2:pb-2 prose-h2:text-xl prose-h2:font-semibold
  prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base prose-h3:font-semibold
  prose-h4:mt-5 prose-h4:mb-2 prose-h4:text-sm prose-h4:font-semibold
  prose-blockquote:my-4 prose-blockquote:rounded-r-lg prose-blockquote:border-l-4 prose-blockquote:border-[var(--color-outline-variant)] prose-blockquote:bg-[var(--color-surface-container-low)] prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:italic
  prose-hr:my-6 prose-hr:border-[var(--color-border)]
  prose-img:rounded-lg prose-img:border prose-img:border-[var(--color-border)]
  prose-kbd:rounded prose-kbd:border prose-kbd:border-[var(--color-border)] prose-kbd:bg-[var(--color-surface-container-lowest)] prose-kbd:px-1.5 prose-kbd:py-0.5 prose-kbd:font-[var(--font-mono)] prose-kbd:text-[12px] prose-kbd:font-normal prose-kbd:text-[var(--color-text-secondary)] prose-kbd:shadow-none
  prose-ul:pl-5 prose-ul:[&>li]:marker:text-[var(--color-text-tertiary)]
  prose-ol:pl-5 prose-ol:[&>li]:marker:text-[var(--color-text-tertiary)]
  prose-li:my-1.5
  prose-table:my-0`

function getProseClasses(variant: 'default' | 'document', className?: string) {
  return [BASE_PROSE_CLASSES, variant === 'document' ? DOCUMENT_PROSE_CLASSES : '', className ?? '']
    .filter(Boolean)
    .join(' ')
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, variant = 'default', className }: Props) {
  const isStreaming = false // Caller passes isStreaming via AssistantMessage; here we always get finalized content
  const { html, codeBlocks } = useMemo(() => getCachedParse(content, isStreaming), [content, isStreaming])
  const proseClasses = useMemo(
    () => getProseClasses(variant, className),
    [variant, className],
  )

  const parts = useMemo(() => {
    if (codeBlocks.length === 0) {
      return [{ type: 'html' as const, content: html }]
    }

    const result: Array<{ type: 'html'; content: string } | { type: 'code'; block: CodeBlock }> = []
    let remaining = html

    for (const block of codeBlocks) {
      const marker = `<div data-codeblock-id="${block.id}"></div>`
      const idx = remaining.indexOf(marker)
      if (idx === -1) continue

      const before = remaining.slice(0, idx)
      if (before) {
        result.push({ type: 'html', content: before })
      }
      result.push({ type: 'code', block })
      remaining = remaining.slice(idx + marker.length)
    }

    if (remaining) {
      result.push({ type: 'html', content: remaining })
    }

    return result
  }, [html, codeBlocks])

  const handleClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const button = target?.closest<HTMLButtonElement>('[data-copy-code]')
    if (!button) return

    const text = button.getAttribute('data-copy-code')
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      const original = button.textContent
      button.textContent = 'Copied'
      window.setTimeout(() => {
        button.textContent = original
      }, 1500)
    } catch {
      // Ignore clipboard errors
    }
  }, [])

  if (codeBlocks.length === 0) {
    const cleanHtml = enhanceMarkdownHtml(html)
    return (
      <div
        className={proseClasses}
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
        onClick={handleClick}
      />
    )
  }

  return (
    <div className={proseClasses} onClick={handleClick}>
      {parts.map((part, i) =>
        part.type === 'html' ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: enhanceMarkdownHtml(part.content) }} />
        ) : shouldRenderAsMermaid(part.block) ? (
          <MermaidRenderer key={part.block.id} code={part.block.code} />
        ) : (
          <div key={part.block.id} className="my-4">
            <CodeViewer
              code={part.block.code}
              language={part.block.language}
            />
          </div>
        )
      )}
    </div>
  )
})
