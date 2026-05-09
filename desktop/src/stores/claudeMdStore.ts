import { create } from 'zustand'
import { claudeMdApi, type FileInfo, type ProjectFiles, type FileContent } from '../api/claudeMd'

type ClaudeMdState = {
  userFile: FileInfo | null
  projects: ProjectFiles[]
  selectedFile: FileInfo | null
  fileContent: FileContent | null
  editedContent: string
  isDirty: boolean
  isLoading: boolean
  isLoadingContent: boolean
  error: string | null

  fetchList: (workDir?: string) => Promise<void>
  selectFile: (file: FileInfo) => Promise<void>
  updateContent: (content: string) => void
  saveFile: () => Promise<boolean>
  createFile: (file: FileInfo) => Promise<void>
  deleteFile: (filePath: string) => Promise<boolean>
  clearError: () => void
}

export const useClaudeMdStore = create<ClaudeMdState>((set, get) => ({
  userFile: null,
  projects: [],
  selectedFile: null,
  fileContent: null,
  editedContent: '',
  isDirty: false,
  isLoading: false,
  isLoadingContent: false,
  error: null,

  fetchList: async (workDir?: string) => {
    set({ isLoading: true, error: null })
    try {
      const data = await claudeMdApi.list({ workDir, all: false })
      set({ userFile: data.user, projects: data.projects, isLoading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load CLAUDE.md files', isLoading: false })
    }
  },

  selectFile: async (file: FileInfo) => {
    set({ selectedFile: file, isLoadingContent: true, error: null, isDirty: false })
    try {
      if (file.exists) {
        const data = await claudeMdApi.read(file.path)
        set({ fileContent: data, editedContent: data.content, isLoadingContent: false })
      } else {
        const defaultContent = `---\nname: ${file.name.replace('.md', '')}\ndescription: \ntype: project\n---\n\n`
        set({
          fileContent: {
            path: file.path,
            content: defaultContent,
            frontmatter: { name: file.name.replace('.md', ''), type: 'project' },
            body: '',
            name: file.name,
          },
          editedContent: defaultContent,
          isLoadingContent: false,
          isDirty: true,
        })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to read file', isLoadingContent: false })
    }
  },

  updateContent: (content: string) => {
    set({ editedContent: content, isDirty: true })
  },

  saveFile: async () => {
    const { selectedFile, editedContent } = get()
    if (!selectedFile) return false
    set({ error: null })
    try {
      await claudeMdApi.write(selectedFile.path, editedContent)
      // Refresh the file info
      const newFile: FileInfo = { ...selectedFile, exists: true }
      set({ selectedFile: newFile, isDirty: false })
      // Refresh the list
      const { projects } = get()
      const updatedProjects = projects.map((p) => {
        if (p.projectPath === selectedFile.projectPath) {
          return {
            ...p,
            files: p.files.map((f) => (f.path === selectedFile.path ? { ...f, exists: true } : f)),
          }
        }
        return p
      })
      set({ projects: updatedProjects })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save file' })
      return false
    }
  },

  createFile: async (file: FileInfo) => {
    const state = get()
    state.selectFile(file)
  },

  deleteFile: async (filePath: string) => {
    set({ error: null })
    try {
      await claudeMdApi.delete(filePath)
      const { selectedFile, projects } = get()
      const updatedProjects = projects.map((p) => ({
        ...p,
        files: p.files.map((f) =>
          f.path === filePath ? { ...f, exists: false } : f,
        ),
      }))
      const nextSelected = selectedFile?.path === filePath ? null : selectedFile
      set({
        projects: updatedProjects,
        selectedFile: nextSelected,
        fileContent: nextSelected ? get().fileContent : null,
        editedContent: nextSelected ? get().editedContent : '',
        isDirty: false,
      })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete file' })
      return false
    }
  },

  clearError: () => set({ error: null }),
}))
