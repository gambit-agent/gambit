import type { ToolSet } from 'ai'

import { generateId } from '../lib/id'
import { ConversationRunner } from '../conversation/conversation-runner'
import { createConversationStore, type ConversationStore } from '../conversation/conversation-store'
import type { ConversationMessage } from '../conversation/conversation-types'
import { resolveMaxDelegationDepth, workspaceRoot } from '../config'
import { AgentRunner } from '../agents/agent-runner'
import { agentToolIds } from '../agents/agent-tool-policy'
import { MemoryStore } from '../memory/memory-store'
import { PermissionEngine } from '../permissions/permission-engine'
import { QuestionEngine } from '../questions/question-engine'
import { HookManager } from '../hooks/plugin-hooks'
import { loadSystemPrompt } from '../lib/prompt'
import { AgentTaskRunner } from '../tasks/agent-task-runner'
import { ShellTaskRunner } from '../tasks/shell-task-runner'
import { TaskRuntime } from '../tasks/task-runtime'
import { createAiToolMap, createRuntimeToolSuite } from '../tools/index'
import type { ToolExecutionContext } from '../tools/tool-types'
import {
  getConversationSessionSummary,
  getLatestConversationSession,
  listConversationSessions,
  type ConversationSessionSummary,
} from '../session/conversation-sessions'
import { forkConversation as forkConversationImpl, buildConversationTree, type ForkResult } from '../session/conversation-fork'
import { readUserConfig } from '../session/user-config'
import { applyTheme } from '../ui/theme'
import { primeProviderCredentials } from '../lib/provider-credentials'

export interface ConversationRuntimeServices {
  baseSystemPrompt: string
  systemMessage: ConversationMessage
  conversationStore: ConversationStore
  conversationRunner: ConversationRunner
  memoryStore: MemoryStore
  resetConversation: () => Promise<string>
  resumeConversation: (conversationId: string) => Promise<ConversationSessionSummary>
  resumeLatestConversation: () => Promise<ConversationSessionSummary | null>
  listConversationSessions: () => Promise<ConversationSessionSummary[]>
  forkConversation: (atMessageId?: string) => Promise<ForkResult>
  getConversationTree: () => Promise<string>
  saveMemoryEntry: (content: string) => Promise<string>
}

export interface ToolRuntimeServices {
  permissionEngine: PermissionEngine
  questionEngine: QuestionEngine
  hookManager: HookManager
}

export interface BackgroundTaskRuntimeServices {
  taskRuntime: TaskRuntime
  shellTaskRunner: ShellTaskRunner
  agentTaskRunner: AgentTaskRunner
  runShellCommand: (command: string, options: { background: boolean }) => Promise<{
    taskId: string
    output: string
  }>
}

/**
 * Aggregated runtime context created once at startup and shared across the
 * React tree via `AppRuntimeProvider`. It remains flat for compatibility, but
 * its type is composed from focused runtime service groups.
 */
export interface AppRuntime
  extends ConversationRuntimeServices,
    ToolRuntimeServices,
    BackgroundTaskRuntimeServices {}

export interface BootstrapAppRuntimeOptions {
  deferConversationInitialization?: boolean
}

function buildSystemMessage(content: string): ConversationMessage {
  return {
    id: generateId(),
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
    hidden: true,
  }
}

function extractShellTaskId(output: string): string | null {
  const match = output.match(/(?:^|\n)task_id:\s*(\S+)/)
  return match?.[1] ?? null
}

/**
 * Wire together all subsystems (store, runner, tasks, permissions, hooks)
 * and return an `AppRuntime` ready for the TUI to consume.
 */
export async function bootstrapAppRuntime(options: BootstrapAppRuntimeOptions = {}): Promise<AppRuntime> {
  const baseSystemPrompt = await loadSystemPrompt()
  const systemMessage = buildSystemMessage(baseSystemPrompt)
  const userConfig = await readUserConfig().catch(() => null)
  if (userConfig?.theme) {
    try { applyTheme(userConfig.theme) } catch { /* non-fatal */ }
  }
  primeProviderCredentials(userConfig?.providers ?? {})
  const runtimeMaxDelegationDepth = resolveMaxDelegationDepth(userConfig?.maxDepth)

  const memoryStore = new MemoryStore()
  const permissionEngine = new PermissionEngine()
  const questionEngine = new QuestionEngine()
  const taskRuntime = new TaskRuntime()
  const hookManager = await HookManager.load()
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
    questionEngine,
    shellTaskRunner,
    memoryStore,
    hookManager,
    signal: options.signal,
    agentExecutionOptions: options.agentExecutionOptions,
  })

  let agentTaskRunner: AgentTaskRunner
  const createToolSuite = async (
    options: {
      includeSpawnAgent?: boolean
      discoverMCPServerTools?: boolean
    } = {},
  ) => {
    return createRuntimeToolSuite({
      includeSpawnAgent: options.includeSpawnAgent,
      discoverMCPServerTools: options.discoverMCPServerTools,
      workspaceRoot,
    })
  }

  const createChildTools = async (
    allowedToolIds?: readonly string[],
    agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions'],
  ): Promise<ToolSet> => {
    const { registry, executor } = await createToolSuite({ includeSpawnAgent: true })
    return createAiToolMap(registry, executor, {
      ...createToolContext({ agentExecutionOptions }),
      agentTaskRunner,
      allowedToolIds: allowedToolIds ?? agentToolIds,
    })
  }

  agentTaskRunner = new AgentTaskRunner(taskRuntime, agentRunner, createChildTools)
  const conversationStore = createConversationStore()
  if (!options.deferConversationInitialization) {
    await conversationStore.initialize()
  }

  const conversationRunner = new ConversationRunner({
    store: conversationStore,
    baseSystemPrompt,
    maxDelegationDepth: runtimeMaxDelegationDepth,
    memoryStore,
    createToolContext: (options) => ({
      ...createToolContext(options),
      agentTaskRunner,
      sessionId: conversationStore.getSnapshot().conversationId,
    }),
    createToolSuite,
  })

  return {
    baseSystemPrompt,
    systemMessage,
    conversationStore,
    conversationRunner,
    memoryStore,
    permissionEngine,
    questionEngine,
    taskRuntime,
    hookManager,
    shellTaskRunner,
    agentTaskRunner,
    resetConversation: async () => {
      return conversationStore.startNewConversation()
    },
    resumeConversation: async (conversationId: string) => {
      const summary = await getConversationSessionSummary(conversationId, workspaceRoot)
      if (!summary) {
        throw new Error(`Saved conversation not found: ${conversationId}`)
      }
      await conversationStore.openConversation(summary.conversationId)
      return summary
    },
    resumeLatestConversation: async () => {
      const summary = await getLatestConversationSession(workspaceRoot)
      if (!summary) {
        return null
      }
      await conversationStore.openConversation(summary.conversationId)
      return summary
    },
    listConversationSessions: async () => {
      return listConversationSessions(workspaceRoot)
    },
    forkConversation: async (atMessageId?: string) => {
      const sourceId = conversationStore.getSnapshot().conversationId
      const result = await forkConversationImpl(sourceId, { atMessageId, root: workspaceRoot })
      await conversationStore.openConversation(result.conversationId)
      return result
    },
    getConversationTree: async () => {
      return buildConversationTree(workspaceRoot)
    },
    runShellCommand: async (command: string, options: { background: boolean }) => {
      const { executor } = await createToolSuite({ includeSpawnAgent: false })
      const result = await executor.execute(
        'bash',
        { command, background: options.background },
        {
          ...createToolContext(),
          agentTaskRunner,
          sessionId: conversationStore.getSnapshot().conversationId,
        },
      )
      const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)
      return {
        taskId: extractShellTaskId(output) ?? result.toolCallId,
        output,
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
