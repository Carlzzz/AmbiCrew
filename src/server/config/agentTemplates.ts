import agentTemplatesJson from './agentTemplates.json'

export type AgentTemplate = {
  id: string
  name: string
  icon: string
  description: string
  model: string
  tools: string[]
  systemPrompt: string
}

export const AGENT_TEMPLATES: AgentTemplate[] = agentTemplatesJson as AgentTemplate[]
