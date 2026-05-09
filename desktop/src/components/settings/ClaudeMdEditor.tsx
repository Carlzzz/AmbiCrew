import { useEffect, useRef } from 'react'
import { useClaudeMdStore } from '../../stores/claudeMdStore'
import type { FileInfo, FileLevel } from '../../api/claudeMd'

const LEVEL_LABELS: Record<FileLevel, { label: string; color: string }> = {
  user: { label: 'User', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  project: { label: 'Project', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
  'project-local': { label: 'Local', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  rules: { label: 'Rule', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
}

export function ClaudeMdEditor({ file }: { file: FileInfo }) {
  const fileContent = useClaudeMdStore((s) => s.fileContent)
  const editedContent = useClaudeMdStore((s) => s.editedContent)
  const isLoadingContent = useClaudeMdStore((s) => s.isLoadingContent)
  const isDirty = useClaudeMdStore((s) => s.isDirty)
  const error = useClaudeMdStore((s) => s.error)
  const selectFile = useClaudeMdStore((s) => s.selectFile)
  const updateContent = useClaudeMdStore((s) => s.updateContent)
  const saveFile = useClaudeMdStore((s) => s.saveFile)
  const deleteFile = useClaudeMdStore((s) => s.deleteFile)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    selectFile(file)
  }, [file.path])

  const levelInfo = LEVEL_LABELS[file.level]

  const handleSave = async () => {
    await saveFile()
  }

  const handleDelete = async () => {
    if (!file.exists) return
    const confirmed = window.confirm(`Delete ${file.name}?`)
    if (confirmed) {
      await deleteFile(file.path)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  if (isLoadingContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-tertiary)]">Loading...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
            {file.name}
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${levelInfo.color}`}
          >
            {levelInfo.label}
          </span>
          {file.projectPath && (
            <span className="text-[11px] text-[var(--color-text-tertiary)] truncate max-w-[200px]">
              {file.projectPath}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {file.exists && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="flex items-center gap-1 rounded-lg bg-[image:var(--gradient-btn-primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-all hover:brightness-105 disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-[14px]">save</span>
            Save
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={editedContent}
          onChange={(e) => updateContent(e.target.value)}
          className="w-full h-full resize-none border-none bg-[var(--color-surface-container-lowest)] p-4 text-sm text-[var(--color-text-primary)] font-mono leading-relaxed outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder={`---\nname: my-rule\ndescription: \ntype: project\n---\n\n# Your markdown content here...`}
          spellCheck={false}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-tertiary)]">
        <span>
          {file.exists ? file.path : 'New file — will be created on save'}
        </span>
        <span>
          {isDirty ? '● Unsaved changes' : '✓ Saved'}
        </span>
      </div>
    </div>
  )
}
