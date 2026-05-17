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

export interface RuntimeToolOptions extends Partial<ToolExecutionContext> {
  includeSpawnAgent?: boolean
  includeMCPTools?: boolean
  discoverMCPServerTools?: boolean
  allowedToolIds?: readonly string[]
  onEvent?: (event: any) => void
}

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

export async function createDefaultToolRegistry(
  options: { includeSpawnAgent?: boolean; includeMCPTools?: boolean; discoverMCPServerTools?: boolean } = {},
): Promise<ToolRegistry> {
  const definitions = await createBuiltInToolDefinitions(options)
  return createToolRegistry(definitions)
}

export async function createDefaultToolExecutor(): Promise<ToolExecutor> {
  const registry = await createDefaultToolRegistry()
  return createToolExecutor(registry, { workspaceRoot })
}

const defaultPermissionEngine = new PermissionEngine()
defaultPermissionEngine.setMode('Auto-accept')
const defaultTaskRuntime = new TaskRuntime()
const defaultShellTaskRunner = new ShellTaskRunner(defaultTaskRuntime)
const defaultMemoryStore = new MemoryStore()

const defaultRegistry = await createDefaultToolRegistry({ includeSpawnAgent: false })

export const toolRegistry = defaultRegistry
export const toolExecutor = createToolExecutor(defaultRegistry, { workspaceRoot })

export async function createRuntimeToolRegistry(
  options: { includeSpawnAgent?: boolean; includeMCPTools?: boolean; discoverMCPServerTools?: boolean } = {},
): Promise<ToolRegistry> {
  return createDefaultToolRegistry(options)
}

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

export type AgentToolId =
  | 'readFile'
  | 'writeFile'
  | 'patchFile'
  | 'executeShell'
  | 'slashCommand'
  | 'readTaskOutput'
  | 'writeMemory'
  | 'askUserQuestion'
export type AgentTools = Record<AgentToolId, any>

export const agentTools = createAiToolMap(defaultRegistry, toolExecutor, {
  workspaceRoot,
  permissionEngine: defaultPermissionEngine,
  taskRuntime: defaultTaskRuntime,
  shellTaskRunner: defaultShellTaskRunner,
  memoryStore: defaultMemoryStore,
}) as AgentTools

export { createToolRegistry, ToolRegistry, ToolExecutor, createToolExecutor }
