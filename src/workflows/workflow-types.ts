import type { AgentRole } from '../agents/agent-types'

export interface WorkflowMetaPhase {
  title: string
  detail?: string
  model?: string
}

export interface WorkflowMeta {
  name: string
  description: string
  whenToUse?: string
  phases?: WorkflowMetaPhase[]
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}

export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema | JsonSchema[]
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  enum?: JsonValue[]
  const?: JsonValue
  description?: string
  [key: string]: unknown
}

export interface WorkflowAgentOptions {
  label?: string
  phase?: string
  schema?: JsonSchema
  model?: string
  isolation?: 'worktree'
  agentType?: string
  role?: AgentRole
}

export interface WorkflowAgentRunOptions {
  label: string
  phase?: string
  role: AgentRole
  schema?: JsonSchema
  modelId?: string
  instructions?: string
  signal?: AbortSignal
}

export interface WorkflowAgentRunner {
  run(prompt: string, options: WorkflowAgentRunOptions): Promise<unknown>
}

export interface WorkflowRunOptions {
  cwd?: string
  args?: unknown
  agent: WorkflowAgentRunner
  concurrency?: number
  tokenBudget?: number | null
  signal?: AbortSignal
  onLog?: (message: string) => void
  onPhase?: (title: string) => void
  onAgentStart?: (event: { label: string; phase?: string; prompt: string }) => void
  onAgentEnd?: (event: { label: string; phase?: string; result: unknown }) => void
}

export interface WorkflowRunResult<T = unknown> {
  meta: WorkflowMeta
  result: T
  logs: string[]
  phases: string[]
  agentCount: number
  durationMs: number
}
