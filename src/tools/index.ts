import { tool } from 'ai'
import { randomUUID } from 'node:crypto'

import { workspaceRoot } from '../config'
import { MemoryStore } from '../memory/memory-store'
import { PermissionEngine } from '../permissions/permission-engine'
import { ShellTaskRunner } from '../tasks/shell-task-runner'
import { TaskRuntime } from '../tasks/task-runtime'
import { createBuiltInToolDefinitions } from './builtins'
import { ToolExecutor, createToolExecutor } from './tool-executor'
import { createToolRegistry, ToolRegistry } from './tool-registry'
import type { AnyToolDefinition, ToolExecutionContext } from './tool-types'

/** Options used when constructing the runtime tool registry and executor. */
export interface RuntimeToolOptions extends Partial<ToolExecutionContext> {
  includeSpawnAgent?: boolean
  includeMCPTools?: boolean
  discoverMCPServerTools?: boolean
  allowedToolIds?: readonly string[]
  onEvent?: (event: any) => void
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
        toolCallId: randomUUID(),
      })
      return result.output
    },
  })
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

/* ------------------------------------------------------------------ */
/*  Default singletons used by headless/bootstrap paths that need     */
/*  tools before the full AppRuntime is available.                    */
/* ------------------------------------------------------------------ */

const defaultPermissionEngine = new PermissionEngine()
defaultPermissionEngine.setMode('Auto-accept')
const defaultTaskRuntime = new TaskRuntime()
const defaultShellTaskRunner = new ShellTaskRunner(defaultTaskRuntime)
const defaultMemoryStore = new MemoryStore()

const defaultRegistry = await createDefaultToolRegistry({ includeSpawnAgent: false })

export const toolRegistry = defaultRegistry
export const toolExecutor = createToolExecutor(defaultRegistry, { workspaceRoot })

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
): Record<string, any> {
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
export type AgentToolId =
  | 'readFile'
  | 'searchFiles'
  | 'writeFile'
  | 'patchFile'
  | 'executeShell'
  | 'slashCommand'
  | 'readTaskOutput'
  | 'listTasks'
  | 'getTaskStatus'
  | 'waitForTasks'
  | 'cancelTask'
  | 'spawnAgent'
  | 'runAgents'
  | 'writeMemory'
  | 'askUserQuestion'
export type AgentTools = Record<AgentToolId, any>

/** Default tool map exposed to the agent runner with auto-accept permissions. */
export const agentTools = createAiToolMap(defaultRegistry, toolExecutor, {
  workspaceRoot,
  permissionEngine: defaultPermissionEngine,
  taskRuntime: defaultTaskRuntime,
  shellTaskRunner: defaultShellTaskRunner,
  memoryStore: defaultMemoryStore,
}) as AgentTools

export { createToolRegistry, ToolRegistry, ToolExecutor, createToolExecutor }
