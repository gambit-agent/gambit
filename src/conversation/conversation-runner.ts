import { generateId } from '../lib/id'
import { toCoreMessages } from '../lib/messages'
import { buildModelRuntimeSettings, createModelSelector, type ReasoningEffort } from '../lib/model'
import { ModelStreamRunner } from '../lib/streaming/model-stream-runner'
import { formatToolEvent } from '../lib/toolSummaries'
import { maxAgentSteps, maxDelegationDepth } from '../config'
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
  maxDelegationDepth?: number
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
  providerSlug?: string | null
  showReasoning?: boolean
  signal?: AbortSignal
  allowedToolIds?: readonly string[]
  systemPromptOverride?: string
  appendSystemPrompt?: string
}

export function buildDelegatedAgentBaseSystemPrompt(basePrompt: string, goalSystemPrompt: string | null): string {
  return [basePrompt, goalSystemPrompt].filter(Boolean).join('\n\n')
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
    const relevantMemoriesPromise = this.dependencies.memoryStore.getRelevantMemories(options.userInput)
    void relevantMemoriesPromise.catch(() => undefined)
    const preflightToolContext = this.dependencies.createToolContext({ signal: options.signal })
    const toolSuitePromise = this.createToolSuite({
      includeSpawnAgent: true,
      discoverMCPServerTools: true,
      workspaceRoot: preflightToolContext.workspaceRoot,
    })
    void toolSuitePromise.catch(() => undefined)

    await this.compact({ apiKey: options.apiKey, modelId: options.modelId })

    // Recalled memories go into the message history (not the system prompt):
    // they vary with each user input, and a changing system prompt invalidates
    // the provider's prompt cache for the entire conversation prefix.
    await this.appendMemoryContext(formatRelevantMemories(await relevantMemoriesPromise))

    const snapshot = this.dependencies.store.getSnapshot()
    const initialMessageCount = snapshot.messages.length
    const basePrompt = options.systemPromptOverride ?? this.dependencies.baseSystemPrompt
    const goalSystemPrompt = buildGoalSystemPrompt(snapshot.messages)
    const systemPrompt = [
      basePrompt,
      goalSystemPrompt,
      options.appendSystemPrompt,
      getMemoryPrompt(),
    ]
      .filter(Boolean)
      .join('\n\n')

    const toolContext = this.dependencies.createToolContext({
      signal: options.signal,
      agentExecutionOptions: {
        apiKey: options.apiKey,
        modelId: options.modelId,
        reasoningEffort: options.reasoningEffort,
        providerSlug: options.providerSlug,
        baseSystemPrompt: buildDelegatedAgentBaseSystemPrompt(basePrompt, goalSystemPrompt),
        delegationDepth: 0,
        maxDelegationDepth: this.dependencies.maxDelegationDepth ?? maxDelegationDepth,
        maxSteps: maxAgentSteps,
      },
    })
    const { registry, executor } = await toolSuitePromise
    const tools = createAiToolMap(registry, executor, {
      ...toolContext,
      allowedToolIds: options.allowedToolIds,
    })

    const selectModel = createModelSelector(options.apiKey)
    const modelSettings = buildModelRuntimeSettings({
      reasoningEffort: options.reasoningEffort,
      providerSlug: options.providerSlug,
    })

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
        promptCacheKey: this.dependencies.store.conversationId,
        logMetadata: {
          modelId: options.modelId,
          reasoningEffort: options.reasoningEffort ?? null,
          providerSlug: options.providerSlug ?? null,
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
            await assistantBuilder.startNextSegment()
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

      const turnMessages = this.dependencies.store.getSnapshot().messages.slice(initialMessageCount)
      await this.dependencies.store.persistMessages(turnMessages)
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

  /**
   * Persist recalled memory context as a hidden user-role message so it
   * replays identically on later turns (keeping the prompt prefix cacheable).
   * Skipped when empty or when it matches the most recent memory context.
   */
  private async appendMemoryContext(memoryContext: string): Promise<void> {
    if (!memoryContext) {
      return
    }

    const messages = this.dependencies.store.getSnapshot().messages
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message?.metadata?.memoryContext) {
        if (message.content === memoryContext) {
          return
        }
        break
      }
    }

    await this.dependencies.store.pushMessage({
      id: generateId(),
      role: 'user',
      content: memoryContext,
      timestamp: new Date().toISOString(),
      hidden: true,
      metadata: { memoryContext: true },
    })
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
