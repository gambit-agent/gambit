import type { AgentToolId } from './agent-tool-policy'

const AGENT_ROLES = ['default', 'explorer', 'worker'] as const

export type AgentRole = (typeof AGENT_ROLES)[number]

export interface AgentDefinition {
  id: string
  role: AgentRole
  description: string
  systemPromptAddendum?: string
  allowedToolIds?: readonly AgentToolId[]
}

export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AgentRunRecord {
  id: string
  agentId: string
  role: AgentRole
  title: string
  status: AgentRunStatus
  createdAt: string
  startedAt: string
  finishedAt?: string
  progressSummary?: string
  transcriptPath: string
  outputPath: string
  error?: string
  metadata?: Record<string, unknown>
}
