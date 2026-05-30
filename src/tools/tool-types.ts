import type { z, ZodTypeAny } from 'zod'
import type { AgentTaskRunner } from '../tasks/agent-task-runner'
import type { MemoryStore } from '../memory/memory-store'
import type { PermissionEngine } from '../permissions/permission-engine'
import type { QuestionEngine } from '../questions/question-engine'
import type { ShellTaskRunner } from '../tasks/shell-task-runner'
import type { HookManager } from '../hooks/plugin-hooks'
import type { TaskRuntime } from '../tasks/task-runtime'

/**
 * Context object passed to every tool execution. It carries references to the
 * broader application runtime so tools can interact with permissions,
 * background tasks, memory, and child agents without tight coupling.
 */
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
    delegationDepth?: number
    maxDelegationDepth?: number
    maxSteps?: number
  }
}

/**
 * Describes a permission gate for a tool invocation. When a tool provides
 * `getPermissionRequest`, the permission engine will show a prompt to the user
 * (unless the current mode auto-approves).
 */
export interface ToolPermissionRequest {
  subject: string
  metadata?: Record<string, unknown>
}

/**
 * Immutable record of a single tool execution lifecycle. Emitted by the
 * executor and consumed by the UI for real-time status indicators and logging.
 */
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

/**
 * Core contract for a built-in tool. Each tool declares:
 * - a Zod schema for input validation
 * - an execute function
 * - optional summarization, permission gating, and large-result persistence rules
 */
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
