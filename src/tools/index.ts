import { tool, type ToolSet } from 'ai'

import { workspaceRoot } from '../config'
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
export async function createDefaultToolRegistry(
  options: { includeSpawnAgent?: boolean; includeMCPTools?: boolean; discoverMCPServerTools?: boolean } = {},
): Promise<ToolRegistry> {
  const definitions = await createBuiltInToolDefinitions(options)
  return createToolRegistry(definitions)
}

/** Convenience factory for the default executor backed by the default registry. */
export async function createDefaultToolExecutor(): Promise<ToolExecutor> {
  const registry = await createDefaultToolRegistry()
  return createToolExecutor(registry, { workspaceRoot })
}

/** Re-export for consumers that want to create a fresh registry each turn. */
export async function createRuntimeToolRegistry(
  options: { includeSpawnAgent?: boolean; includeMCPTools?: boolean; discoverMCPServerTools?: boolean } = {},
): Promise<ToolRegistry> {
  return createDefaultToolRegistry(options)
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

/** Subset of tool IDs available to child agents spawned via `spawnAgent`. */
export const agentToolIds = [
  'readFile',
  'searchFiles',
  'writeFile',
  'patchFile',
  'executeShell',
  'slashCommand',
  'readTaskOutput',
  'listTasks',
  'getTaskStatus',
  'waitForTasks',
  'cancelTask',
  'spawnAgent',
  'runAgents',
  'writeMemory',
  'askUserQuestion',
] as const

export type AgentToolId = (typeof agentToolIds)[number]
export interface AgentTool<Output = unknown> {
  execute(input: unknown): Promise<Output>
}
export type AgentTools = { [K in AgentToolId]: AgentTool }

/**
 * Create a scoped tool map for agents/tests. Callers provide runtime
 * capabilities explicitly; this module owns no mutable singleton state.
 */
export async function createAgentToolMap(options: RuntimeToolOptions = {}): Promise<AgentTools> {
  const registry = await createRuntimeToolRegistry({
    includeSpawnAgent: true,
    includeMCPTools: options.includeMCPTools,
    discoverMCPServerTools: options.discoverMCPServerTools,
  })
  const executor = createToolExecutor(registry, { workspaceRoot: options.workspaceRoot ?? workspaceRoot })
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

export { createToolRegistry, ToolRegistry, ToolExecutor, createToolExecutor }
