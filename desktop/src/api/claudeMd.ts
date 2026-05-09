import { api } from './client'

export type FileLevel = 'user' | 'project' | 'project-local' | 'rules'

export type FileInfo = {
  name: string
  path: string
  exists: boolean
  level: FileLevel
  projectPath?: string
}

export type ProjectFiles = {
  projectPath: string
  files: FileInfo[]
}

export type ListResponse = {
  user: FileInfo
  projects: ProjectFiles[]
}

export type FileContent = {
  path: string
  content: string
  frontmatter: Record<string, unknown>
  body: string
  name: string
}

export const claudeMdApi = {
  list: (params?: { workDir?: string; all?: boolean }) => {
    const searchParams = new URLSearchParams()
    if (params?.workDir) searchParams.set('workDir', params.workDir)
    if (params?.all) searchParams.set('all', 'true')
    const qs = searchParams.toString()
    return api.get<ListResponse>(`/api/claudemd${qs ? `?${qs}` : ''}`)
  },

  read: (filePath: string) =>
    api.get<FileContent>(`/api/claudemd/file?path=${encodeURIComponent(filePath)}`),

  write: (filePath: string, content: string) =>
    api.post<{ ok: boolean; path: string }>('/api/claudemd/file', { path: filePath, content }),

  delete: (filePath: string) =>
    api.delete<{ ok: boolean; path: string }>('/api/claudemd/file', { path: filePath }),
}
