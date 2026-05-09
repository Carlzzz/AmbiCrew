import { create } from 'zustand'
import { agentsApi, type AgentDefinition, type CreateAgentInput } from '../api/agents'

export type AgentDetailReturnTab = 'agents' | 'plugins'

type AgentStore = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
  isLoading: boolean
  error: string | null
  selectedAgent: AgentDefinition | null
  selectedAgentReturnTab: AgentDetailReturnTab
  isCreating: boolean
  createError: string | null
  isDeleting: boolean

  fetchAgents: (cwd?: string) => Promise<void>
  selectAgent: (
    agent: AgentDefinition | null,
    returnTab?: AgentDetailReturnTab,
  ) => void
  createAgent: (input: CreateAgentInput, cwd?: string) => Promise<boolean>
  deleteAgent: (name: string, cwd?: string) => Promise<boolean>
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  activeAgents: [],
  allAgents: [],
  isLoading: false,
  error: null,
  selectedAgent: null,
  selectedAgentReturnTab: 'agents',
  isCreating: false,
  createError: null,
  isDeleting: false,

  fetchAgents: async (cwd) => {
    set({ isLoading: true, error: null })
    try {
      const { activeAgents, allAgents } = await agentsApi.list(cwd)
      set({ activeAgents, allAgents, isLoading: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agents'
      set({ isLoading: false, error: message })
    }
  },

  selectAgent: (agent, returnTab = 'agents') =>
    set({
      selectedAgent: agent,
      selectedAgentReturnTab: agent ? returnTab : 'agents',
    }),

  createAgent: async (input, cwd) => {
    set({ isCreating: true, createError: null })
    try {
      await agentsApi.create(input)
      await get().fetchAgents(cwd)
      set({ isCreating: false })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create agent'
      set({ isCreating: false, createError: message })
      return false
    }
  },

  deleteAgent: async (name, cwd) => {
    set({ isDeleting: true })
    try {
      await agentsApi.remove(name)
      if (get().selectedAgent?.agentType === name) {
        set({ selectedAgent: null })
      }
      await get().fetchAgents(cwd)
      set({ isDeleting: false })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete agent'
      set({ isDeleting: false, error: message })
      return false
    }
  },
}))
