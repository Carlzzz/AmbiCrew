import { api } from './client'

export type AgentSource =
  | 'built-in'
  | 'plugin'
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'

export type AgentDefinition = {
  agentType: string
  description?: string
  model?: string
  modelDisplay?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
  source: AgentSource
  baseDir?: string
  overriddenBy?: AgentSource
  isActive: boolean
}

export type AgentListResponse = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
}

export type AgentTemplate = {
  id: string
  name: string
  icon: string
  description: string
  model: string
  tools: string[]
  systemPrompt: string
}

export type CreateAgentInput = {
  name: string
  description?: string
  model?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
}

export const agentsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<AgentListResponse>(`/api/agents${query}`)
  },

  templates: () => api.get<{ templates: AgentTemplate[] }>('/api/agents/templates'),

  create: (input: CreateAgentInput) =>
    api.post<{ ok: boolean }>('/api/agents', input),

  update: (name: string, input: Partial<CreateAgentInput>) =>
    api.put<{ agent: AgentDefinition }>(`/api/agents/${encodeURIComponent(name)}`, input),

  remove: (name: string) =>
    api.delete<{ ok: boolean }>(`/api/agents/${encodeURIComponent(name)}`),
}
