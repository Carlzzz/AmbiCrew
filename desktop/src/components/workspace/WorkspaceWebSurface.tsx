import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { getBaseUrl } from '../../api/client'

type PickPayload = {
  type: 'ambicrew:preview-pick'
  source?: string | null
  selector?: string
  text?: string
  tag?: string
  outerHTML?: string
}

type NavPayload = {
  type: 'ambicrew:preview-nav'
  url?: string
}

/** Origin of the preview URL, used to scope postMessage send/receive. */
function previewOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '*'
  }
}

/** True if a picked source path looks absolute or escapes the project root. */
function isUnsafePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.includes('..')
}

type Props = {
  url: string
  /**
   * Called when the user picks an element in the preview. Mirrors the
   * addLineCommentToChat signature so the panel can build a code-comment
   * workspace reference (file:line chip) the same way line comments do.
   */
  onPick: (path: string, lineStart: number, lineEnd: number, note: string, quote: string) => void
  /** Called when the user clicks the rewind button (opens the /rewind flow). */
  onUndo?: () => void
}

export function WorkspaceWebSurface({ url, onPick, onUndo }: Props) {
  const t = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const [pickMode, setPickMode] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // Tracks the real page the proxy is currently showing. In proxy mode the
  // iframe navigates internally (anchor links routed back through the proxy),
  // so the displayed URL follows the proxied page's postMessage reports rather
  // than the static `url` prop. Reset when the prop changes.
  const [currentUrl, setCurrentUrl] = useState(url)
  useEffect(() => { setCurrentUrl(url) }, [url])
  // Proxy mode routes the page through the Bun server reverse proxy, which
  // strips X-Frame-Options and injects the picker - needed for arbitrary
  // pages (static HTML, built SPAs) that can't load the source-locator plugin.
  // Direct mode (off) is for Vite dev with the plugin (keeps HMR).
  const [proxyMode, setProxyMode] = useState(false)
  const iframeSrc = proxyMode
    ? `${getBaseUrl()}/preview-proxy?url=${encodeURIComponent(url)}`
    : url
  // Proxy mode sandboxes the iframe WITHOUT allow-same-origin, so the proxied
  // page's scripts get an opaque origin and can't reach the server's own APIs
  // (self-SSRF). A sandboxed iframe posts with origin "null"; direct mode uses
  // the URL origin.
  const expectedOrigin = proxyMode ? 'null' : previewOrigin(url)
  const postTargetOrigin = proxyMode ? '*' : previewOrigin(url)
  const sandbox = proxyMode ? 'allow-scripts allow-forms allow-popups allow-modals' : undefined

  // Receive element picks from the preview iframe. The latest onPick is read
  // through a ref so frequent re-renders don't re-subscribe; re-subscribe on
  // origin change so the check stays current.
  useEffect(() => {
    function handler(event: MessageEvent) {
      // Accept the pick from the preview iframe's origin. In proxy mode the
      // iframe is sandboxed (opaque origin), which browsers serialize as
      // "null"; some engines may also surface the proxy server origin. Accept
      // all legitimate preview origins so the pick reliably registers, while
      // still ignoring unrelated origins.
      if (
        event.origin !== expectedOrigin &&
        event.origin !== 'null' &&
        event.origin !== previewOrigin(iframeSrc)
      ) return
      const msg = event.data as (PickPayload | NavPayload) | undefined
      if (msg && msg.type === 'ambicrew:preview-nav') {
        // Proxy reports the real page it's showing after an in-iframe navigation.
        if (typeof msg.url === 'string') setCurrentUrl(msg.url)
        return
      }
      const data = event.data as PickPayload | undefined
      if (!data || data.type !== 'ambicrew:preview-pick') return
      const selector = (data.selector || data.tag || '').toString()
      const text = (data.text || '').toString()
      const source = data.source
      if (source) {
        // Precise: data-source = file:line:col (Vite plugin).
        const match = source.match(/^(.*):(\d+):(\d+)$/)
        if (!match) return
        const path = match[1]!
        // Reject absolute / traversal paths so a crafted pick can't point the
        // agent at files outside the project root.
        if (isUnsafePath(path)) return
        const line = Number.parseInt(match[2]!, 10)
        if (!Number.isFinite(line)) return
        onPickRef.current(path, line, line, selector, text)
      } else {
        // Fallback (proxy mode / non-Vite page): no file:line. Send selector +
        // text + outerHTML so the agent can Grep the project to locate it.
        const outer = (data.outerHTML || '').toString()
        onPickRef.current('', 0, 0, `Picked element (no source mapping): ${selector}`, `${text}${outer ? '\n' + outer : ''}`)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [expectedOrigin])

  // Arm/disarm the picker inside the iframe whenever pick mode changes,
  // and re-assert it after the iframe (re)loads.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage({ type: 'ambicrew:preview-mode', pick: pickMode }, postTargetOrigin)
  }, [pickMode, reloadKey, postTargetOrigin])

  // Open the preview URL in the system browser. Tauri's WebView ignores
  // window.open, so use the shell plugin when available; fall back to
  // window.open in browser dev mode.
  const openExternal = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(currentUrl)
    } catch {
      window.open(currentUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-[12px]">
        <span className="material-symbols-outlined shrink-0 text-[15px] text-[var(--color-text-tertiary)]">public</span>
        <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[var(--color-text-secondary)]" title={currentUrl}>{currentUrl}</span>
        <button
          type="button"
          onClick={() => setProxyMode((value) => !value)}
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11px] transition-colors ${
            proxyMode
              ? 'bg-[var(--color-secondary)]/15 text-[var(--color-secondary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          }`}
          title={t('workspace.previewProxyHint')}
        >
          <span className="material-symbols-outlined text-[14px]">shield</span>
          <span>{proxyMode ? t('workspace.previewProxyOn') : t('workspace.previewProxy')}</span>
        </button>
        <button
          type="button"
          onClick={() => setPickMode((value) => !value)}
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11px] transition-colors ${
            pickMode
              ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          }`}
          title={t('workspace.previewWebPickHint')}
        >
          <span className="material-symbols-outlined text-[14px]">my_location</span>
          <span>{pickMode ? t('workspace.previewPickOn') : t('workspace.previewPick')}</span>
        </button>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            title={t('workspace.previewUndo')}
          >
            <span className="material-symbols-outlined text-[14px]">undo</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          title={t('workspace.previewRefresh')}
        >
          <span className="material-symbols-outlined text-[14px]">refresh</span>
        </button>
        <button
          type="button"
          onClick={openExternal}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          title={t('workspace.previewOpenExternal')}
        >
          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
        </button>
        <span className="shrink-0 rounded-[5px] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
          {t('workspace.previewKind.web')}
        </span>
      </div>
      {pickMode && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-brand)]/8 px-3 py-1.5 text-[11px] text-[var(--color-brand)]">
          {t('workspace.previewWebPickHint')}
        </div>
      )}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={iframeSrc}
        sandbox={sandbox}
        title="preview"
        className="min-h-0 flex-1 w-full border-0 bg-white"
        onLoad={() => {
          const win = iframeRef.current?.contentWindow
          if (win) win.postMessage({ type: 'ambicrew:preview-mode', pick: pickMode }, postTargetOrigin)
        }}
      />
    </div>
  )
}
