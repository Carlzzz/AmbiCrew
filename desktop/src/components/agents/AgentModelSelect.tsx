import { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../i18n'

type Props = {
  value: string
  onChange: (value: string) => void
  label?: string
}

/**
 * Simplified model selector for agent creation. Unlike the chat ModelSelector,
 * this only picks a model id — no provider switching or effort control.
 * Options come from CrewProxy-provided availableModels, plus an "inherit" option
 * that makes the subagent use the same model as the main conversation.
 */
export function AgentModelSelect({ value, onChange, label }: Props) {
  const t = useTranslation()
  const { availableModels, fetchAll } = useSettingsStore()

  // Ensure the model list is loaded (it may be empty on first open).
  useEffect(() => {
    if (availableModels.length === 0) {
      void fetchAll()
    }
  }, [availableModels.length, fetchAll])

  const selectId = 'agent-model-select'

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </label>
      )}
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 px-3 rounded-[var(--radius-md)] border text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] border-[var(--color-border)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)] outline-none transition-colors duration-150"
      >
        <option value="inherit">{t('settings.agents.modelInherit')}</option>
        {availableModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name || model.id}
          </option>
        ))}
      </select>
    </div>
  )
}
