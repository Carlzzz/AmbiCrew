import { CopyButton } from '../shared/CopyButton'

type Props = {
  copyText?: string
  copyLabel: string
  align?: 'start' | 'end'
  onBranch?: () => void
  branchLabel?: string
}

export function MessageActionBar({
  copyText,
  copyLabel,
  align = 'start',
  onBranch,
  branchLabel,
}: Props) {
  const hasCopy = Boolean(copyText?.trim())
  const hasActions = hasCopy || Boolean(onBranch)

  if (!hasActions) return null

  return (
    <div
      data-message-actions
      data-align={align}
      className={`flex w-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {hasCopy && (
          <CopyButton
            text={copyText!}
            label={copyLabel}
            displayLabel="Copy"
            displayCopiedLabel="Copied"
            className="inline-flex min-h-7 items-center rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          />
        )}
        {onBranch && (
          <button
            type="button"
            onClick={onBranch}
            title={branchLabel || 'Branch from here'}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface-container-low)] px-2.5 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-brand)]/35 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
          >
            <span className="material-symbols-outlined text-[13px]">call_split</span>
            {branchLabel || 'Branch'}
          </button>
        )}
      </div>
    </div>
  )
}
