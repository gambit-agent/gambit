import { generateId } from '../lib/id'
import { toCoreMessages } from '../lib/messages'
import { createModelSelector, type ReasoningEffort } from '../lib/model'
import { ModelStreamRunner } from '../lib/streaming/model-stream-runner'
import { formatToolEvent } from '../lib/toolSummaries'
import { maxAgentSteps } from '../config'
import { getMemoryPrompt } from '../memory/memory-prompt'
import { formatRelevantMemories } from '../memory/memory-retrieval'
import { MemoryStore } from '../memory/memory-store'
import { createAiToolMap, createRuntimeToolSuite, type RuntimeToolSuite } from '../tools/index'
import type { ToolExecutionContext } from '../tools/tool-types'
import type { ToolExecutionResult } from '../tools/tool-executor'
import { compactMessages } from './compaction'
import { buildGoalSystemPrompt, isGoalMessage } from './goal'
import { getModelContextLength, getCompactionThreshold } from '../lib/model-info'
import { AssistantMessageBuilder } from './assistant-message-builder'
import { ConversationStore } from './conversation-store'
import type { ConversationMessage, ConversationToolCall, ConversationTurnRecord } from './conversation-types'

/**
 * Dependencies required by ConversationRunner to execute a full turn.
 * Most references come from AppRuntime via `bootstrap.ts`.
 */
export interface ConversationRunnerDependencies {
  store: ConversationStore
  baseSystemPrompt: string
  memoryStore: MemoryStore
  createToolContext: (options?: {
    allowedToolIds?: readonly string[]
    signal?: AbortSignal
    agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions']
  }) => Partial<ToolExecutionContext>
  createToolSuite?: (options?: {
    includeSpawnAgent?: boolean
    discoverMCPServerTools?: boolean
    workspaceRoot?: string
  }) => Promise<RuntimeToolSuite>
}

export interface RunConversationTurnOptions {
  userInput: string
  apiKey: string
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  showReasoning?: boolean
  signal?: AbortSignal
  allowedToolIds?: readonly string[]
  systemPromptOverride?: string
  appendSystemPrompt?: string
}

/**
 * Drives a single user → assistant → tool turn for the main interactive loop.
 * Handles streaming, reasoning display, tool execution, compaction, and error recovery.
 */
export class ConversationRunner {
  constructor(private readonly dependencies: ConversationRunnerDependencies) {}

  async appendMessage(message: ConversationMessage): Promise<void> {
    await this.dependencies.store.appendMessage(message)
  }

  async appendTurn(record: ConversationTurnRecord): Promise<void> {
    await this.dependencies.store.appendTurn(record)
  }

  /** Execute a single tool call and persist the result back into the conversation store. */
  async executeToolCall(
    toolCall: ConversationToolCall,
    context: Partial<ToolExecutionContext> = {},
  ): Promise<ToolExecutionResult> {
    const baseContext = this.dependencies.createToolContext()
    const executionContext = {
      ...baseContext,
      ...context,
      toolCallId: toolCall.toolCallId,
    }
    const { executor } = await this.createToolSuite({
      includeSpawnAgent: true,
      discoverMCPServerTools: true,
      workspaceRoot: executionContext.workspaceRoot,
    })
    const result = await executor.execute(toolCall.toolId, toolCall.input, executionContext)

    await this.dependencies.store.appendMessage({
      id: result.event.toolCallId,
      role: 'tool',
      content: result.summary,
      timestamp: result.event.finishedAt ?? result.event.startedAt,
      metadata: {
        toolCallId: result.event.toolCallId,
        toolName: result.event.toolId,
        toolArgs: result.event.input,
        toolResult: result.event.output,
        toolStatus: result.event.status,
        toolArtifactPath: result.event.artifactPath,
      },
    })

    return result
  }

  /**
   * Compact older messages into a summary if the conversation exceeds the
   * model's context window. Returns whether compaction actually occurred.
   */
  async compact(options?: { apiKey?: string; modelId?: string }): Promise<{ compacted: boolean; summarizedCount: number }> {
    const snapshot = this.dependencies.store.getSnapshot()
    let maxTokens: number | undefined
    if (options?.apiKey && options?.modelId) {
      const contextLength = await getModelContextLength(options.modelId, options.apiKey)
      maxTokens = getCompactionThreshold(contextLength)
    }
    const result = compactMessages(snapshot.messages, { maxTokens })
    if (result.compacted) {
      await this.dependencies.store.replaceMessages(result.messages)
    }
    return { compacted: result.compacted, summarizedCount: result.summarizedCount }
  }

  /**
   * Run one full turn: build system prompt, stream the model response,
   * execute any requested tools, and commit everything to the store.
   */
  async runTurn(options: RunConversationTurnOptions): Promise<ConversationTurnRecord> {
    await this.compact({ apiKey: options.apiKey, modelId: options.modelId })

    const snapshot = this.dependencies.store.getSnapshot()
    const relevantMemoryContext = formatRelevantMemories(
      await this.dependencies.memoryStore.getRelevantMemories(options.userInput),
    )
    const basePrompt = options.systemPromptOverride ?? this.dependencies.baseSystemPrompt
    const systemPrompt = [
      basePrompt,
      buildGoalSystemPrompt(snapshot.messages),
      options.appendSystemPrompt,
      getMemoryPrompt(),
      relevantMemoryContext,
    ]
      .filter(Boolean)
      .join('\n\n')

    const toolContext = this.dependencies.createToolContext({
      signal: options.signal,
      agentExecutionOptions: {
        apiKey: options.apiKey,
        modelId: options.modelId,
        reasoningEffort: options.reasoningEffort,
        baseSystemPrompt: basePrompt,
        delegationDepth: 0,
        maxDelegationDepth: 3,
        maxSteps: maxAgentSteps,
      },
    })
    const { registry, executor } = await this.createToolSuite({
      includeSpawnAgent: true,
      discoverMCPServerTools: true,
      workspaceRoot: toolContext.workspaceRoot,
    })
    const tools = createAiToolMap(registry, executor, {
      ...toolContext,
      allowedToolIds: options.allowedToolIds,
    })

    const selectModel = createModelSelector(options.apiKey)
    const modelSettings = options.reasoningEffort
      ? { reasoning: { enabled: true, effort: options.reasoningEffort } }
      : undefined

    const turn: ConversationTurnRecord = {
      id: generateId(),
      startedAt: new Date().toISOString(),
      userInput: options.userInput,
    }

    this.dependencies.store.setStatus('running')
    this.dependencies.store.setError(null)

    const assistantBuilder = new AssistantMessageBuilder(this.dependencies.store, Boolean(options.showReasoning))
    const streamRunner = new ModelStreamRunner()

    try {
      const result = await streamRunner.run({
        streamId: turn.id,
        model: selectModel(options.modelId, modelSettings),
        messages: toCoreMessages(
          [
            {
              id: `${turn.id}-system`,
              role: 'system',
              content: systemPrompt,
              timestamp: new Date(),
              hidden: true,
            },
            ...snapshot.messages
              .filter((message) => !isGoalMessage(message))
              .map((message) => ({
                ...message,
                timestamp: new Date(message.timestamp),
              })),
          ],
        ),
        tools,
        maxSteps: maxAgentSteps,
        signal: options.signal,
        logMetadata: {
          modelId: options.modelId,
          reasoningEffort: options.reasoningEffort ?? null,
          messageCount: snapshot.messages.length,
          toolCount: Object.keys(tools).length,
        },
        handlers: {
          onReasoningDelta: async (text) => {
            await assistantBuilder.appendReasoning(text)
          },
          onTextDelta: async (chunk) => {
            await assistantBuilder.appendText(chunk)
          },
          onToolCall: async (part) => {
            assistantBuilder.startNextSegment()
            const toolCallId = part.toolCallId ?? generateId()
            const content = formatToolEvent({
              toolName: part.toolName ?? 'unknown',
              status: 'started',
              args: part.input ?? {},
              toolCallId,
            })
            await this.upsertToolMessage(toolCallId, {
              toolName: part.toolName ?? 'unknown',
              content,
              args: part.input ?? {},
              status: 'started',
            })
          },
          onToolResult: async (part) => {
            if (part.preliminary) {
              return
            }
            const toolCallId = part.toolCallId ?? generateId()
            const content = formatToolEvent({
              toolName: part.toolName ?? 'unknown',
              status: 'completed',
              args: part.input ?? {},
              toolCallId,
              result: part.output,
            })
            await this.upsertToolMessage(toolCallId, {
              toolName: part.toolName ?? 'unknown',
              content,
              args: part.input ?? {},
              result: part.output,
              status: 'completed',
            })
          },
          onToolError: async (part, errorMessage) => {
            const toolCallId = part.toolCallId ?? generateId()
            const content = formatToolEvent({
              toolName: part.toolName ?? 'unknown',
              status: 'failed',
              args: part.input ?? {},
              toolCallId,
              result: `Error: ${errorMessage}`,
            })
            await this.upsertToolMessage(toolCallId, {
              toolName: part.toolName ?? 'unknown',
              content,
              args: part.input ?? {},
              result: `Error: ${errorMessage}`,
              status: 'failed',
            })
          },
        },
      })

      const finalContent = await assistantBuilder.finish(result.text)
      turn.finishedAt = new Date().toISOString()
      turn.assistantOutput = finalContent

      await this.dependencies.store.replaceMessages(this.dependencies.store.getSnapshot().messages)
      await this.dependencies.store.appendTurn(turn)
      this.dependencies.store.setStatus('idle')
      return turn
    } catch (error) {
      assistantBuilder.removeTurnMessages()
      this.dependencies.store.setStatus('idle')
      this.dependencies.store.setError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /** Insert a new tool message or update an existing one by toolCallId. */
  private async upsertToolMessage(
    toolCallId: string,
    options: {
      toolName: string
      content: string
      args: unknown
      result?: unknown
      status: 'started' | 'completed' | 'failed'
      artifactPath?: string
    },
  ): Promise<void> {
    const existing = this.dependencies.store
      .getSnapshot()
      .messages.find((message) => message.metadata?.toolCallId === toolCallId || message.id === toolCallId)

    if (existing) {
      this.dependencies.store.updateMessage(existing.id, {
        content: options.content,
        metadata: {
          toolCallId,
          toolName: options.toolName,
          toolArgs: options.args,
          toolResult: options.result,
          toolStatus: options.status,
          toolArtifactPath: options.artifactPath,
        },
      })
      return
    }

    await this.dependencies.store.pushMessage(
      {
        id: toolCallId,
        role: 'tool',
        content: options.content,
        timestamp: new Date().toISOString(),
        metadata: {
          toolCallId,
          toolName: options.toolName,
          toolArgs: options.args,
          toolResult: options.result,
          toolStatus: options.status,
          toolArtifactPath: options.artifactPath,
        },
      },
      { persist: false },
    )
  }

  private async createToolSuite(options: {
    includeSpawnAgent?: boolean
    discoverMCPServerTools?: boolean
    workspaceRoot?: string
  }): Promise<RuntimeToolSuite> {
    if (this.dependencies.createToolSuite) {
      return this.dependencies.createToolSuite(options)
    }

    return createRuntimeToolSuite({
      includeSpawnAgent: options.includeSpawnAgent,
      discoverMCPServerTools: options.discoverMCPServerTools,
      workspaceRoot: options.workspaceRoot,
    })
  }
}
