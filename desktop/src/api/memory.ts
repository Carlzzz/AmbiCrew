import { api } from './client'

export type MemoryFileInfo = {
  name: string
  path: string
  description: string
  type: string
  modifiedAt: string
}

export type ProjectMemory = {
  projectPath: string
  projectName: string
  files: MemoryFileInfo[]
  indexExists: boolean
}

export type MemoryListResponse = {
  projects: ProjectMemory[]
  totalFiles: number
}

export type MemoryFileContent = {
  path: string
  name: string
  content: string
  frontmatter: Record<string, unknown>
  body: string
  modifiedAt: string
}

export const memoryApi = {
  list() {
    return api.get<MemoryListResponse>('/api/memory')
  },

  readFile(filePath: string) {
    return api.get<MemoryFileContent>(`/api/memory/file?path=${encodeURIComponent(filePath)}`)
  },
}
