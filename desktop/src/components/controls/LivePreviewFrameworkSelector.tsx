import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'

export type PreviewFramework = 'react' | 'vue' | 'svelte'

const FRAMEWORKS: PreviewFramework[] = ['react', 'vue', 'svelte']

type Props = {
  framework: PreviewFramework
  onChange: (framework: PreviewFramework) => void
  compact?: boolean
}

/** Compact dropdown for choosing the preview-edit scaffold framework. Renders
 *  as a single button (current framework + chevron) to avoid the 3-chip row
 *  overflowing the composer controls. */
export function LivePreviewFrameworkSelector({ framework, onChange, compact }: Props) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-container-low)] ${
          compact ? 'px-2 py-1' : 'px-2.5 py-1.5'
        } text-[11px] font-medium capitalize text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
        title={t('chat.livePreviewFrameworkHint')}
      >
        <span>{framework}</span>
        <span className="material-symbols-outlined text-[12px]">expand_more</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[120px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
          {FRAMEWORKS.map((fw) => (
            <button
              key={fw}
              type="button"
              onClick={() => {
                onChange(fw)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs capitalize transition-colors hover:bg-[var(--color-surface-hover)] ${
                fw === framework ? 'font-semibold text-[var(--color-brand)]' : 'text-[var(--color-text-secondary)]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {fw === framework ? 'check' : 'code'}
              </span>
              <span>{fw}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
