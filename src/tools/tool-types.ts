import type { z, ZodTypeAny } from 'zod'
import type { AgentTaskRunner } from '../tasks/agent-task-runner'
import type { MemoryStore } from '../memory/memory-store'
import type { PermissionEngine } from '../permissions/permission-engine'
import type { QuestionEngine } from '../questions/question-engine'
import type { ShellTaskRunner } from '../tasks/shell-task-runner'
import type { HookManager } from '../hooks/plugin-hooks'
import type { TaskRuntime } from '../tasks/task-runtime'

export interface ToolExecutionContext {
  workspaceRoot: string
  toolCallId: string
  signal?: AbortSignal
  cwd?: string
  outputDirectory?: string
  sessionId?: string
  taskRuntime?: TaskRuntime
  permissionEngine?: PermissionEngine
  questionEngine?: QuestionEngine
  shellTaskRunner?: ShellTaskRunner
  memoryStore?: MemoryStore
  agentTaskRunner?: AgentTaskRunner
  hookManager?: HookManager
  agentExecutionOptions?: {
    apiKey: string
    modelId: string
    reasoningEffort?: 'low' | 'medium' | 'high' | null
    baseSystemPrompt: string
  }
}

export interface ToolPermissionRequest {
  subject: string
  metadata?: Record<string, unknown>
}

export interface ToolEventRecord {
  kind: 'tool'
  toolId: string
  toolCallId: string
  status: 'started' | 'completed' | 'failed'
  input: unknown
  output?: unknown
  summary?: string
  artifactPath?: string
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface ToolDefinition<InputSchema extends ZodTypeAny, Output> {
  id: string
  displayName: string
  description: string
  inputSchema: InputSchema
  execute: (input: z.infer<InputSchema>, context: ToolExecutionContext) => Promise<Output>
  summarize?: (
    result: Output,
    context: {
      input: z.infer<InputSchema>
      artifactPath?: string
    },
  ) => string
  shouldPersistLargeResult?: boolean
  maxInlineResultChars?: number
  getPermissionRequest?: (input: z.infer<InputSchema>) => ToolPermissionRequest | null
}

export type AnyToolDefinition = ToolDefinition<ZodTypeAny, unknown>
