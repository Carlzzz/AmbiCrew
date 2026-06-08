import { useState, useEffect } from 'react'
import { agentsApi, type AgentTemplate } from '../../api/agents'
import { useTranslation } from '../../i18n'
import { Input } from '../shared/Input'
import { Textarea } from '../shared/Textarea'
import { Button } from '../shared/Button'
import { AgentModelSelect } from './AgentModelSelect'

type WizardStep = 'template' | 'edit' | 'preview'

type Props = {
  onCreated: () => void
  onCancel: () => void
}

const AVAILABLE_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch']

export function AgentCreateWizard({ onCreated, onCancel }: Props) {
  const t = useTranslation()
  const [step, setStep] = useState<WizardStep>('template')
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('inherit')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tools, setTools] = useState<string[]>([])

  useEffect(() => {
    agentsApi.templates().then(({ templates }) => {
      setTemplates(templates)
      setIsLoadingTemplates(false)
    }).catch(() => setIsLoadingTemplates(false))
  }, [])

  const applyTemplate = (template: AgentTemplate | null) => {
    if (template) {
      setName(template.id)
      setDescription(template.description)
      setModel(template.model || 'inherit')
      setSystemPrompt(template.systemPrompt)
      setTools(template.tools)
    } else {
      // Start from blank
      setName('')
      setDescription('')
      setModel('inherit')
      setSystemPrompt('')
      setTools([])
    }
    setStep('edit')
  }

  const toggleTool = (tool: string) => {
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((tl) => tl !== tool) : [...prev, tool],
    )
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setIsCreating(true)
    setCreateError(null)
    try {
      await agentsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        model: model === 'inherit' ? undefined : model,
        systemPrompt: systemPrompt.trim() || undefined,
        tools: tools.length > 0 ? tools : undefined,
      })
      onCreated()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('settings.agents.createError'))
      setIsCreating(false)
    }
  }

  // ─── Step 1: Template selection ─────────────────────────────
  if (step === 'template') {
    return (
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-[20px] text-[var(--color-brand)]">auto_awesome</span>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.agents.wizard.pickTemplate')}</h3>
        </div>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-4">{t('settings.agents.wizard.pickTemplateHint')}</p>

        {isLoadingTemplates ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => applyTemplate(template)}
                className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]"
              >
                <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)] flex-shrink-0">{template.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">{template.name}</div>
                  <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-5">{template.description}</div>
                </div>
              </button>
            ))}
            <button
              onClick={() => applyTemplate(null)}
              className="flex items-start gap-3 rounded-xl border border-dashed border-[var(--color-border)] bg-transparent px-4 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]"
            >
              <span className="material-symbols-outlined text-[22px] text-[var(--color-text-tertiary)] flex-shrink-0">edit_note</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.agents.wizard.blankTemplate')}</div>
                <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-5">{t('settings.agents.wizard.blankTemplateHint')}</div>
              </div>
            </button>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t('settings.agents.createCancel')}</Button>
        </div>
      </section>
    )
  }

  // ─── Step 2: Edit configuration ─────────────────────────────
  if (step === 'edit') {
    return (
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[20px] text-[var(--color-brand)]">tune</span>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.agents.wizard.editTitle')}</h3>
        </div>

        <div className="grid gap-4">
          <Input
            label={t('settings.agents.createName')}
            required
            placeholder={t('settings.agents.createNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label={t('settings.agents.createDescriptionLabel')}
            placeholder={t('settings.agents.createDescriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <AgentModelSelect
            label={t('settings.agents.createModel')}
            value={model}
            onChange={setModel}
          />
          <Textarea
            label={t('settings.agents.createSystemPrompt')}
            placeholder={t('settings.agents.createSystemPromptPlaceholder')}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
          />

          {/* Advanced: tool selection */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px] transition-transform" style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none' }}>
                chevron_right
              </span>
              {t('settings.agents.wizard.advanced')}
            </button>
            {showAdvanced && (
              <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
                <div className="text-xs text-[var(--color-text-tertiary)] mb-2">{t('settings.agents.wizard.toolsHint')}</div>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TOOLS.map((tool) => {
                    const selected = tools.includes(tool)
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                          selected
                            ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                            : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        {tool}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-5">
          <Button variant="ghost" size="sm" onClick={() => setStep('template')}>
            {t('settings.agents.wizard.back')}
          </Button>
          <Button variant="primary" size="sm" disabled={!name.trim()} onClick={() => setStep('preview')}>
            {t('settings.agents.wizard.preview')}
          </Button>
        </div>
      </section>
    )
  }

  // ─── Step 3: Preview ─────────────────────────────────────────
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-[20px] text-[var(--color-brand)]">visibility</span>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.agents.wizard.previewTitle')}</h3>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <div className="text-sm font-bold text-[var(--color-text-primary)]">{name}</div>
          {description && <div className="text-xs text-[var(--color-text-tertiary)] mt-1">{description}</div>}
        </div>

        {/* Meta */}
        <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-[var(--color-border)]">
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            {model === 'inherit' ? t('settings.agents.modelInherit') : model}
          </span>
          {tools.map((tool) => (
            <span key={tool} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
              {tool}
            </span>
          ))}
        </div>

        {/* System prompt */}
        {systemPrompt && (
          <div className="px-5 py-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] mb-2">{t('settings.agents.systemPrompt')}</div>
            <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap leading-5 max-h-48 overflow-y-auto">{systemPrompt}</pre>
          </div>
        )}
      </div>

      {createError && (
        <p className="mt-3 text-sm text-[var(--color-error)]">{createError}</p>
      )}

      <div className="flex items-center justify-between mt-5">
        <Button variant="ghost" size="sm" onClick={() => setStep('edit')}>
          {t('settings.agents.wizard.backToEdit')}
        </Button>
        <Button variant="primary" size="sm" loading={isCreating} disabled={!name.trim()} onClick={() => void handleCreate()}>
          {t('settings.agents.wizard.confirmCreate')}
        </Button>
      </div>
    </section>
  )
}
