import { useCallback, useEffect, useMemo, useState } from 'react'
import { memoryApi, type MemoryFileContent, type ProjectMemory } from '../api/memory'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { useTranslation } from '../i18n'

export function MemoryPanel() {
  const t = useTranslation()
  const [projects, setProjects] = useState<ProjectMemory[]>([])
  const [totalFiles, setTotalFiles] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<MemoryFileContent | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())

  const fetchMemories = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await memoryApi.list()
      setProjects(data.projects)
      setTotalFiles(data.totalFiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories')
    }
    setIsLoading(false)
  }, [])

  useEffect(() => { fetchMemories() }, [fetchMemories])

  const handleSelectFile = useCallback(async (filePath: string) => {
    setIsLoadingFile(true)
    try {
      const data = await memoryApi.readFile(filePath)
      setSelectedFile(data)
    } catch {
      setSelectedFile(null)
    }
    setIsLoadingFile(false)
  }, [])

  const toggleProject = useCallback((projectPath: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectPath)) next.delete(projectPath)
      else next.add(projectPath)
      return next
    })
  }, [])

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects
    const q = searchQuery.toLowerCase()
    return projects
      .map((project) => ({
        ...project,
        files: project.files.filter(
          (f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q),
        ),
      }))
      .filter((p) => p.files.length > 0)
  }, [projects, searchQuery])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-tertiary)]">{t('memory.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <span className="material-symbols-outlined text-3xl text-[var(--color-text-tertiary)]">error</span>
        <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
        <button onClick={fetchMemories} className="rounded-lg bg-[image:var(--gradient-btn-primary)] px-4 py-1.5 text-xs font-semibold text-[var(--color-btn-primary-fg)]">
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (totalFiles === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <span className="material-symbols-outlined text-3xl text-[var(--color-text-tertiary)]">psychology</span>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('memory.empty')}</p>
        <p className="text-xs text-[var(--color-text-tertiary)] max-w-[300px] text-center">
          {t('memory.emptyHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 140px)' }}>
      {/* Project tree sidebar */}
      <div className="w-[280px] border-r border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] overflow-y-auto flex-shrink-0 flex flex-col">
        {/* Search */}
        <div className="p-3 border-b border-[var(--color-border)]/60">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-surface)] px-2.5 py-1.5">
            <span className="material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('memory.searchPlaceholder')}
              className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
            />
          </div>
          <div className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
            {totalFiles} {t('memory.filesAcross')} {projects.length} {t('memory.projects')}
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto">
          {filteredProjects.map((project) => {
            const isCollapsed = collapsedProjects.has(project.projectPath)
            return (
              <div key={project.projectPath} className="border-b border-[var(--color-border)]/30">
                <button
                  onClick={() => toggleProject(project.projectPath)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">
                    {isCollapsed ? 'chevron_right' : 'expand_more'}
                  </span>
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-outline)]">folder</span>
                  <span className="flex-1 text-xs font-medium text-[var(--color-text-primary)] truncate">
                    {project.projectName}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {project.files.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="pb-1">
                    {project.files.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleSelectFile(file.path)}
                        className={`w-full flex items-start gap-2 pl-9 pr-3 py-1.5 text-left transition-colors ${
                          selectedFile?.path === file.path
                            ? 'bg-[var(--color-surface-selected)]'
                            : 'hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[12px] mt-0.5 text-[var(--color-outline)]">
                          {file.type === 'user' ? 'person' : file.type === 'feedback' ? 'feedback' : file.type === 'project' ? 'work' : 'bookmark'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">
                            {file.name}
                          </div>
                          {file.description && (
                            <div className="text-[10px] text-[var(--color-text-tertiary)] truncate mt-0.5">
                              {file.description}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
        {isLoadingFile ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-[var(--color-text-tertiary)]">{t('common.loading')}</span>
          </div>
        ) : selectedFile ? (
          <>
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <button
                onClick={() => { setSelectedFile(null) }}
                className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                arrow_back
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {selectedFile.name}
                </div>
                {typeof selectedFile.frontmatter?.description === 'string' && selectedFile.frontmatter.description && (
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                    {selectedFile.frontmatter.description}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {new Date(selectedFile.modifiedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <MarkdownRenderer content={selectedFile.body || selectedFile.content} variant="document" />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-tertiary)]">
            <span className="material-symbols-outlined text-3xl">psychology</span>
            <p className="text-sm">{t('memory.selectFile')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
