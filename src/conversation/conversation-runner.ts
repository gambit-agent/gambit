import { streamText } from 'ai'
import { randomUUID } from 'node:crypto'

import { toCoreMessages } from '../lib/messages'
import { createModelSelector, type ReasoningEffort } from '../lib/model'
import { formatToolEvent } from '../lib/toolSummaries'
import { getMemoryPrompt } from '../memory/memory-prompt'
import { MemoryStore } from '../memory/memory-store'
import { createAiToolMap, createRuntimeToolRegistry } from '../tools/index'
import type { ToolExecutionContext } from '../tools/tool-types'
import { createToolExecutor, type ToolExecutionResult } from '../tools/tool-executor'
import { ConversationStore } from './conversation-store'
import type { ConversationMessage, ConversationToolCall, ConversationTurnRecord } from './conversation-types'

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
}

export class ConversationRunner {
  constructor(private readonly dependencies: ConversationRunnerDependencies) {}

  async appendMessage(message: ConversationMessage): Promise<void> {
    await this.dependencies.store.appendMessage(message)
  }

  async appendTurn(record: ConversationTurnRecord): Promise<void> {
    await this.dependencies.store.appendTurn(record)
  }

  async executeToolCall(
    toolCall: ConversationToolCall,
    context: Partial<ToolExecutionContext> = {},
  ): Promise<ToolExecutionResult> {
    const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true })
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

  async runTurn(options: RunConversationTurnOptions): Promise<ConversationTurnRecord> {
    const snapshot = this.dependencies.store.getSnapshot()
    const relevantMemoryContext = await this.dependencies.memoryStore.getRelevantContext(options.userInput)
    const systemPrompt = [
      this.dependencies.baseSystemPrompt,
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
        baseSystemPrompt: this.dependencies.baseSystemPrompt,
      },
    })
    const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true })
    const toolExecutor = createToolExecutor(registry, {
      workspaceRoot: toolContext.workspaceRoot,
    })
    const tools = createAiToolMap(registry, toolExecutor, toolContext)

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
            ...snapshot.messages.map((message) => ({
              ...message,
              timestamp: new Date(message.timestamp),
            })),
          ],
        ),
        tools,
        stopWhen: [],
        abortSignal: options.signal,
      })

      const stream = result.fullStream as AsyncIterable<any>
      for await (const part of stream) {
        if (part.type === 'reasoning') {
          if (typeof part.text === 'string' && part.text) {
            reasoningContent += part.text
          }
          continue
        }

        if (part.type === 'text-delta') {
          const chunk =
            typeof part.textDelta === 'string' ? part.textDelta : typeof part.delta === 'string' ? part.delta : ''

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

      const resolvedText = ((await result.text) || assistantContent).trim()
      const finalContent = composeAssistantContent(resolvedText)
      turn.finishedAt = new Date().toISOString()
      turn.assistantOutput = finalContent

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
      if (assistantAdded) {
        this.dependencies.store.removeMessage(assistantId)
      }
      this.dependencies.store.setStatus('idle')
      this.dependencies.store.setError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

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
