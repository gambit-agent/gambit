import { tool, type ToolSet } from 'ai'

import { workspaceRoot } from '../config'
import { agentToolIds, type AgentToolId } from '../agents/agent-tool-policy'
import { generateId } from '../lib/id'
import { createBuiltInToolDefinitions } from './builtins'
import { ToolExecutor, createToolExecutor } from './tool-executor'
import { createToolRegistry, ToolRegistry } from './tool-registry'
import type { AnyToolDefinition, ToolEventRecord, ToolExecutionContext } from './tool-types'

/** Options used when constructing the runtime tool registry and executor. */
export interface RuntimeToolOptions extends Partial<ToolExecutionContext> {
  includeSpawnAgent?: boolean
  includeMCPTools?: boolean
  discoverMCPServerTools?: boolean
  allowedToolIds?: readonly string[]
  onEvent?: (event: ToolEventRecord) => void
}

export interface RuntimeToolSuite {
  registry: ToolRegistry
  executor: ToolExecutor
}

export interface RuntimeToolSuiteOptions {
  includeSpawnAgent?: boolean
  includeMCPTools?: boolean
  discoverMCPServerTools?: boolean
  workspaceRoot?: string
  outputDirectory?: string
  onEvent?: (event: ToolEventRecord) => void
}

/**
 * Wrap a single ToolDefinition into the shape expected by the Vercel AI SDK.
 * The wrapper invokes our ToolExecutor so that hooks, permissions, and artifacts
 * are handled uniformly.
 */
function toAiTool(
  definition: AnyToolDefinition,
  executor: ToolExecutor,
  context: Partial<ToolExecutionContext>,
) {
  return tool<any, any>({
    description: definition.description,
    inputSchema: definition.inputSchema as any,
    execute: async (input: any) => {
      const result = await executor.execute(definition.id, input, {
        ...context,
        workspaceRoot: context.workspaceRoot ?? workspaceRoot,
        toolCallId: generateId(),
      })
      return result.output
    },
  }) as ToolSet[string]
}

/** Build a ToolRegistry containing all built-in tools (plus optionally MCP tools). */
async function createDefaultToolRegistry(
  options: { includeSpawnAgent?: boolean; includeMCPTools?: boolean; discoverMCPServerTools?: boolean } = {},
): Promise<ToolRegistry> {
  const definitions = await createBuiltInToolDefinitions(options)
  return createToolRegistry(definitions)
}

/** Convenience factory for the default executor backed by the default registry. */
/** Re-export for consumers that want to create a fresh registry each turn. */
export async function createRuntimeToolRegistry(
  options: { includeSpawnAgent?: boolean; includeMCPTools?: boolean; discoverMCPServerTools?: boolean } = {},
): Promise<ToolRegistry> {
  return createDefaultToolRegistry(options)
}

/** Build a scoped registry/executor pair using the same construction path everywhere. */
export async function createRuntimeToolSuite(
  options: RuntimeToolSuiteOptions = {},
): Promise<RuntimeToolSuite> {
  const registry = await createRuntimeToolRegistry({
    includeSpawnAgent: options.includeSpawnAgent,
    includeMCPTools: options.includeMCPTools,
    discoverMCPServerTools: options.discoverMCPServerTools,
  })
  const executor = createToolExecutor(registry, {
    workspaceRoot: options.workspaceRoot ?? workspaceRoot,
    outputDirectory: options.outputDirectory,
    onEvent: options.onEvent,
  })
  return { registry, executor }
}

/**
 * Create an AI SDK-compatible tool map from a registry + executor pair.
 * Filters by `allowedToolIds` if provided.
 */
export function createAiToolMap(
  registry: ToolRegistry,
  executor: ToolExecutor,
  options: RuntimeToolOptions = {},
): ToolSet {
  const definitions = registry
    .list()
    .filter((definition) => {
      if (options.allowedToolIds && !options.allowedToolIds.includes(definition.id)) {
        return false
      }
      return true
    })

  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      toAiTool(definition, executor, {
        workspaceRoot: options.workspaceRoot ?? workspaceRoot,
        cwd: options.cwd,
        outputDirectory: options.outputDirectory,
        sessionId: options.sessionId,
        signal: options.signal,
        taskRuntime: options.taskRuntime,
        permissionEngine: options.permissionEngine,
        questionEngine: options.questionEngine,
        shellTaskRunner: options.shellTaskRunner,
        memoryStore: options.memoryStore,
        agentTaskRunner: options.agentTaskRunner,
        hookManager: options.hookManager,
        agentExecutionOptions: options.agentExecutionOptions,
      }),
    ]),
  )
}

export interface AgentTool<Output = unknown> {
  execute(input: unknown): Promise<Output>
}
export type AgentTools = { [K in AgentToolId]: AgentTool }

/**
 * Create a scoped tool map for agents/tests. Callers provide runtime
 * capabilities explicitly; this module owns no mutable singleton state.
 */
export async function createAgentToolMap(options: RuntimeToolOptions = {}): Promise<AgentTools> {
  const { registry, executor } = await createRuntimeToolSuite({
    includeSpawnAgent: true,
    includeMCPTools: options.includeMCPTools,
    discoverMCPServerTools: options.discoverMCPServerTools,
    workspaceRoot: options.workspaceRoot,
    outputDirectory: options.outputDirectory,
    onEvent: options.onEvent,
  })
  const entries = agentToolIds.map((id) => {
    if (!registry.get(id)) {
      throw new Error(`Agent tool not registered: ${id}`)
    }
    return [
      id,
      {
        execute: async (input: unknown) => {
          const result = await executor.execute(id, input, {
            ...options,
            workspaceRoot: options.workspaceRoot ?? workspaceRoot,
            toolCallId: generateId(),
          })
          return result.output
        },
      },
    ] as const
  })
  return Object.fromEntries(entries) as AgentTools
}

export type { AgentToolId }
