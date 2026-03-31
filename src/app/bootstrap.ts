import { randomUUID } from 'node:crypto'

import { ConversationRunner } from '../conversation/conversation-runner'
import { createConversationStore, type ConversationStore } from '../conversation/conversation-store'
import type { ConversationMessage } from '../conversation/conversation-types'
import { workspaceRoot } from '../config'
import { AgentRunner } from '../agents/agent-runner'
import { MemoryStore } from '../memory/memory-store'
import { PermissionEngine } from '../permissions/permission-engine'
import { loadSystemPrompt } from '../lib/prompt'
import { AgentTaskRunner } from '../tasks/agent-task-runner'
import { ShellTaskRunner } from '../tasks/shell-task-runner'
import { TaskRuntime } from '../tasks/task-runtime'
import { createAiToolMap, createRuntimeToolRegistry } from '../tools/index'
import { createToolExecutor } from '../tools/tool-executor'
import type { ToolExecutionContext } from '../tools/tool-types'

export interface AppRuntime {
  baseSystemPrompt: string
  systemMessage: ConversationMessage
  conversationStore: ConversationStore
  conversationRunner: ConversationRunner
  memoryStore: MemoryStore
  permissionEngine: PermissionEngine
  taskRuntime: TaskRuntime
  shellTaskRunner: ShellTaskRunner
  agentTaskRunner: AgentTaskRunner
  resetConversation: () => void
  runShellCommand: (command: string, options: { background: boolean }) => Promise<{
    taskId: string
    output: string
  }>
  saveMemoryEntry: (content: string) => Promise<string>
}

function buildSystemMessage(content: string): ConversationMessage {
  return {
    id: randomUUID(),
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
    hidden: true,
  }
}

export async function bootstrapAppRuntime(): Promise<AppRuntime> {
  const baseSystemPrompt = await loadSystemPrompt()
  const systemMessage = buildSystemMessage(baseSystemPrompt)

  const memoryStore = new MemoryStore()
  const permissionEngine = new PermissionEngine()
  const taskRuntime = new TaskRuntime()
  const shellTaskRunner = new ShellTaskRunner(taskRuntime)
  const agentRunner = new AgentRunner()

  await permissionEngine.initialize()
  await taskRuntime.initialize()

  const createToolContext = (
    options: {
      allowedToolIds?: readonly string[]
      signal?: AbortSignal
      agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions']
    } = {},
  ): Partial<ToolExecutionContext> => ({
    workspaceRoot,
    taskRuntime,
    permissionEngine,
    shellTaskRunner,
    memoryStore,
    signal: options.signal,
    agentExecutionOptions: options.agentExecutionOptions,
  })

  const createChildTools = async (allowedToolIds?: readonly string[]): Promise<Record<string, any>> => {
    const registry = await createRuntimeToolRegistry({ includeSpawnAgent: false })
    const executor = createToolExecutor(registry, { workspaceRoot })
    return createAiToolMap(registry, executor, {
      ...createToolContext(),
      allowedToolIds,
    })
  }

  const agentTaskRunner = new AgentTaskRunner(taskRuntime, agentRunner, createChildTools)
  const conversationStore = createConversationStore()
  await conversationStore.initialize([systemMessage])

  const conversationRunner = new ConversationRunner({
    store: conversationStore,
    baseSystemPrompt,
    memoryStore,
    createToolContext: (options) => ({
      ...createToolContext(options),
      agentTaskRunner,
    }),
  })

  return {
    baseSystemPrompt,
    systemMessage,
    conversationStore,
    conversationRunner,
    memoryStore,
    permissionEngine,
    taskRuntime,
    shellTaskRunner,
    agentTaskRunner,
    resetConversation: () => {
      conversationStore.reset([systemMessage])
    },
    runShellCommand: async (command: string, options: { background: boolean }) => {
      const permission = await permissionEngine.request({
        toolId: 'executeShell',
        subject: `Execute shell command: ${command}`,
        metadata: {
          command,
          background: options.background,
        },
      })

      if (permission === 'deny') {
        throw new Error('Shell execution was denied.')
      }

      const result = await shellTaskRunner.run(command, options)
      return {
        taskId: result.task.id,
        output: result.formattedOutput,
      }
    },
    saveMemoryEntry: async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) {
        throw new Error('Memory content must not be empty.')
      }

      const words = trimmed.split(/\s+/).slice(0, 6)
      const name = words.join(' ').slice(0, 60)
      const description = trimmed.slice(0, 120)
      const record = await memoryStore.upsert({
        type: 'feedback',
        name,
        description,
        content: trimmed,
      })
      return `Saved memory: ${record.name}`
    },
  }
}
