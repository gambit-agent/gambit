import { stepCountIs, streamText } from 'ai'
import { randomUUID } from 'node:crypto'

import { toCoreMessages } from '../lib/messages'
import { createModelSelector, type ReasoningEffort } from '../lib/model'
import { formatToolEvent } from '../lib/toolSummaries'
import { maxAgentSteps } from '../config'
import { getMemoryPrompt } from '../memory/memory-prompt'
import { MemoryStore } from '../memory/memory-store'
import { createAiToolMap, createRuntimeToolRegistry } from '../tools/index'
import type { ToolExecutionContext } from '../tools/tool-types'
import { createToolExecutor, type ToolExecutionResult } from '../tools/tool-executor'
import { compactMessages, shouldAutoCompact } from './compaction'
import { buildGoalSystemPrompt, isGoalMessage } from './goal'
import { getModelContextLength, getCompactionThreshold } from '../lib/model-info'
import { createStreamLogger } from '../lib/stream-logger'
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
    const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, discoverMCPServerTools: true })
    const toolExecutor = createToolExecutor(registry, {
      workspaceRoot: context.workspaceRoot ?? this.dependencies.createToolContext().workspaceRoot,
    })
    const result = await toolExecutor.execute(toolCall.toolId, toolCall.input, {
      ...context,
      toolCallId: toolCall.toolCallId,
    })

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
    // Auto-compact based on model's actual context window before starting.
    const preSnapshot = this.dependencies.store.getSnapshot()
    const contextLength = await getModelContextLength(options.modelId, options.apiKey)
    const maxTokens = getCompactionThreshold(contextLength)
    if (shouldAutoCompact(preSnapshot.messages, { maxTokens })) {
      const result = compactMessages(preSnapshot.messages, { maxTokens })
      if (result.compacted) {
        await this.dependencies.store.replaceMessages(result.messages)
      }
    }

    const snapshot = this.dependencies.store.getSnapshot()
    const relevantMemoryContext = await this.dependencies.memoryStore.getRelevantContext(options.userInput)
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
    const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, discoverMCPServerTools: true })
    const toolExecutor = createToolExecutor(registry, {
      workspaceRoot: toolContext.workspaceRoot,
    })
    const tools = createAiToolMap(registry, toolExecutor, {
      ...toolContext,
      allowedToolIds: options.allowedToolIds,
    })

    const selectModel = createModelSelector(options.apiKey)
    const modelSettings = options.reasoningEffort
      ? { reasoning: { enabled: true, effort: options.reasoningEffort } }
      : undefined

    const turn: ConversationTurnRecord = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      userInput: options.userInput,
    }

    this.dependencies.store.setStatus('running')
    this.dependencies.store.setError(null)

    const assistantId = randomUUID()
    let assistantContent = ''
    let reasoningContent = ''
    let assistantAdded = false

    const composeAssistantContent = (text: string): string => {
      if (!options.showReasoning || !reasoningContent.trim()) {
        return text
      }
      return `Reasoning:\n${reasoningContent.trim()}\n\n${text}`
    }

    const streamLog = createStreamLogger(turn.id, {
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort ?? null,
      messageCount: snapshot.messages.length,
      toolCount: Object.keys(tools).length,
    })

    try {
      const result = await streamText({
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
        stopWhen: stepCountIs(maxAgentSteps),
        abortSignal: options.signal,
      })

      const stream = result.fullStream as AsyncIterable<any>
      let streamError: unknown = null
      for await (const part of stream) {
        streamLog.event(part.type, {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          textLen: typeof part.text === 'string' ? part.text.length : typeof part.textDelta === 'string' ? part.textDelta.length : undefined,
        })

        if (part.type === 'error') {
          streamError = part.error
          continue
        }

        // Accumulate reasoning text and, if enabled, stream it into the assistant message live.
        if (part.type === 'reasoning-delta') {
          if (typeof part.text === 'string' && part.text) {
            reasoningContent += part.text
            if (options.showReasoning && reasoningContent.trim()) {
              const content = composeAssistantContent(assistantContent)
              if (!assistantAdded) {
                assistantAdded = true
                await this.dependencies.store.pushMessage(
                  { id: assistantId, role: 'assistant', content, timestamp: new Date().toISOString() },
                  { persist: false },
                )
              } else {
                this.dependencies.store.updateMessage(assistantId, { content })
              }
            }
          }
          continue
        }

        // Accumulate assistant text and mirror it into the store for live UI updates.
        if (part.type === 'text-delta') {
          const chunk =
            typeof part.text === 'string' ? part.text : typeof part.textDelta === 'string' ? part.textDelta : typeof part.delta === 'string' ? part.delta : ''

          if (!chunk) {
            continue
          }

          assistantContent += chunk
          const content = composeAssistantContent(assistantContent)
          if (!assistantAdded) {
            assistantAdded = true
            await this.dependencies.store.pushMessage(
              {
                id: assistantId,
                role: 'assistant',
                content,
                timestamp: new Date().toISOString(),
              },
              { persist: false },
            )
          } else {
            this.dependencies.store.updateMessage(assistantId, { content })
          }
          continue
        }

        if (part.type === 'tool-call') {
          const content = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'started',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
          })
          await this.upsertToolMessage(part.toolCallId, {
            toolName: part.toolName ?? 'unknown',
            content,
            args: part.input ?? {},
            status: 'started',
          })
          continue
        }

        if (part.type === 'tool-result') {
          if (part.preliminary) {
            continue
          }
          const content = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'completed',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
            result: part.output,
          })
          await this.upsertToolMessage(part.toolCallId, {
            toolName: part.toolName ?? 'unknown',
            content,
            args: part.input ?? {},
            result: part.output,
            status: 'completed',
          })
          continue
        }

        if (part.type === 'tool-error') {
          const errorMessage =
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === 'string'
                ? part.error
                : JSON.stringify(part.error, null, 2)
          const content = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'failed',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
            result: `Error: ${errorMessage}`,
          })
          await this.upsertToolMessage(part.toolCallId, {
            toolName: part.toolName ?? 'unknown',
            content,
            args: part.input ?? {},
            result: `Error: ${errorMessage}`,
            status: 'failed',
          })
        }
      }

      if (streamError) {
        throw streamError instanceof Error ? streamError : new Error(extractErrorMessage(streamError))
      }

      streamLog.finish({ textChars: assistantContent.length, reasoningChars: reasoningContent.length })

      const resolvedText = ((await result.text) || assistantContent).trim()
      const finalContent = composeAssistantContent(resolvedText)
      turn.finishedAt = new Date().toISOString()
      turn.assistantOutput = finalContent

      // Commit the final assistant message. If we were streaming live, swap
      // the ephemeral message for the persisted one.
      if (!assistantAdded && finalContent) {
        await this.dependencies.store.pushMessage({
          id: assistantId,
          role: 'assistant',
          content: finalContent,
          timestamp: new Date().toISOString(),
        })
      } else if (assistantAdded) {
        this.dependencies.store.removeMessage(assistantId)
        if (finalContent) {
          await this.dependencies.store.pushMessage({
            id: assistantId,
            role: 'assistant',
            content: finalContent,
            timestamp: new Date().toISOString(),
          })
        }
      }

      await this.dependencies.store.appendTurn(turn)
      this.dependencies.store.setStatus('idle')
      return turn
    } catch (error) {
      const isAbort = options.signal?.aborted === true
      if (isAbort) {
        streamLog.aborted({ textChars: assistantContent.length })
      } else {
        streamLog.error(error, { textChars: assistantContent.length })
      }
      if (assistantAdded) {
        this.dependencies.store.removeMessage(assistantId)
      }
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
}

function extractErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string') {
      return record.message
    }
    const error = record.error
    if (error instanceof Error) {
      return error.message
    }
    if (typeof error === 'string') {
      return error
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
