import { useEffect, useState } from 'react'
import { useClaudeMdStore } from '../stores/claudeMdStore'
import { useSessionStore } from '../stores/sessionStore'
import { ClaudeMdEditor } from '../components/settings/ClaudeMdEditor'
import type { FileInfo } from '../api/claudeMd'

function FileTreeItem({
  file,
  isSelected,
  onClick,
}: {
  file: FileInfo
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
        isSelected
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="material-symbols-outlined text-[14px] shrink-0">
        {file.exists ? 'article' : 'note_add'}
      </span>
      <span className="truncate">{file.name}</span>
      {!file.exists && (
        <span className="text-[10px] text-[var(--color-text-tertiary)] ml-auto">new</span>
      )}
    </button>
  )
}

function FileTreeSection({
  title,
  icon,
  files,
  selectedPath,
  onSelect,
}: {
  title: string
  icon: string
  files: FileInfo[]
  selectedPath: string | null
  onSelect: (file: FileInfo) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="mb-0.5">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="material-symbols-outlined text-[16px] shrink-0">{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        <span className="material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">
          {collapsed ? 'chevron_right' : 'expand_more'}
        </span>
      </button>
      {!collapsed && (
        <div>
          {files.map((f) => (
            <FileTreeItem
              key={f.path}
              file={f}
              isSelected={selectedPath === f.path}
              onClick={() => onSelect(f)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ClaudeMdSettings() {
  const userFile = useClaudeMdStore((s) => s.userFile)
  const projects = useClaudeMdStore((s) => s.projects)
  const selectedFile = useClaudeMdStore((s) => s.selectedFile)
  const isLoading = useClaudeMdStore((s) => s.isLoading)
  const error = useClaudeMdStore((s) => s.error)
  const fetchList = useClaudeMdStore((s) => s.fetchList)
  const selectFile = useClaudeMdStore((s) => s.selectFile)
  const sessions = useSessionStore((s) => s.sessions)

  // Get active work dirs from sessions
  const workDir = sessions[0]?.workDir || sessions[0]?.projectPath || ''

  useEffect(() => {
    fetchList(workDir)
  }, [workDir])

  const allProjectFiles = projects.flatMap((p) => p.files)

  const handleSelectFile = (file: FileInfo) => {
    selectFile(file)
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-tertiary)]">Loading CLAUDE.md files...</span>
      </div>
    )
  }

  if (error && !selectedFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <span className="material-symbols-outlined text-3xl text-[var(--color-text-tertiary)]">error</span>
        <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
        <button
          onClick={() => fetchList(workDir)}
          className="rounded-lg bg-[image:var(--gradient-btn-primary)] px-4 py-1.5 text-xs font-semibold text-[var(--color-btn-primary-fg)]"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!userFile && allProjectFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <span className="material-symbols-outlined text-3xl text-[var(--color-text-tertiary)]">description</span>
        <p className="text-sm text-[var(--color-text-secondary)]">No CLAUDE.md files found</p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Open a project session to manage its CLAUDE.md files, or edit your user-level CLAUDE.md above.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 140px)' }}>
      {/* File tree sidebar */}
      <div className="w-[240px] border-r border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] overflow-y-auto flex-shrink-0">
        {userFile && (
          <FileTreeSection
            title="User"
            icon="person"
            files={[userFile]}
            selectedPath={selectedFile?.path ?? null}
            onSelect={handleSelectFile}
          />
        )}

        {projects.map((project) => (
          <FileTreeSection
            key={project.projectPath}
            title={project.projectPath.split(/[/\\]/).pop() || project.projectPath}
            icon="folder"
            files={project.files}
            selectedPath={selectedFile?.path ?? null}
            onSelect={handleSelectFile}
          />
        ))}
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
        {selectedFile ? (
          <ClaudeMdEditor key={selectedFile.path} file={selectedFile} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-tertiary)]">
            <span className="material-symbols-outlined text-3xl">edit_note</span>
            <p className="text-sm">Select a file to edit</p>
          </div>
        )}
      </div>
    </div>
  )
}
