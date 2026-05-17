import { stepCountIs, streamText } from 'ai'
import { randomUUID } from 'node:crypto'

import { toCoreMessages } from '../lib/messages'
import { createModelSelector, type ReasoningEffort } from '../lib/model'
import { createStreamLogger } from '../lib/stream-logger'
import { formatToolEvent } from '../lib/toolSummaries'
import { getMemoryPrompt } from '../memory/memory-prompt'
import type { AgentDefinition } from './agent-types'
import type { ConversationMessage } from '../conversation/conversation-types'

export interface AgentRunnerOptions {
  definition: AgentDefinition
  prompt: string
  apiKey: string
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  baseSystemPrompt: string
  createTools: (allowedToolIds?: readonly string[]) => Promise<Record<string, any>>
  appendTranscript: (entry: unknown) => Promise<void>
  updateProgress: (summary: string) => Promise<void>
  signal?: AbortSignal
}

export interface AgentRunnerResult {
  output: string
  summary: string
}

export class AgentRunner {
  async run(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
    const tools = await options.createTools(options.definition.allowedToolIds)
    const selectModel = createModelSelector(options.apiKey)
    const modelSettings = options.reasoningEffort
      ? { reasoning: { enabled: true, effort: options.reasoningEffort } }
      : undefined

    const systemPrompt = [
      options.baseSystemPrompt,
      getMemoryPrompt(),
      options.definition.systemPromptAddendum,
    ]
      .filter(Boolean)
      .join('\n\n')

    const history: ConversationMessage[] = [
      {
        id: `${options.definition.id}-system`,
        role: 'system',
        content: systemPrompt,
        timestamp: new Date().toISOString(),
        hidden: true,
      },
      {
        id: `${options.definition.id}-user`,
        role: 'user',
        content: options.prompt,
        timestamp: new Date().toISOString(),
      },
    ]

    await options.appendTranscript({
      type: 'system',
      content: systemPrompt,
      timestamp: new Date().toISOString(),
    })
    await options.appendTranscript({
      type: 'user',
      content: options.prompt,
      timestamp: new Date().toISOString(),
    })

    const turnId = `agent-${options.definition.id}-${randomUUID()}`
    const streamLog = createStreamLogger(turnId, {
      agentId: options.definition.id,
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort ?? null,
      messageCount: history.length,
      toolCount: Object.keys(tools).length,
    })

    let assistantContent = ''
    let reasoningContent = ''
    let streamError: unknown = null
    let reasoningFlushed = false
    const flushReasoning = async () => {
      if (reasoningContent.trim() && !reasoningFlushed) {
        reasoningFlushed = true
        await options.appendTranscript({
          type: 'reasoning',
          content: reasoningContent.trim(),
          timestamp: new Date().toISOString(),
        })
      }
    }

    try {
      const result = await streamText({
        model: selectModel(options.modelId, modelSettings),
        messages: toCoreMessages(
          history.map((message) => ({
            ...message,
            timestamp: new Date(message.timestamp),
          })),
        ),
        tools,
        stopWhen: stepCountIs(50),
        abortSignal: options.signal,
      })

      const stream = result.fullStream as AsyncIterable<any>

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

        if (part.type === 'text-delta') {
          const chunk =
            typeof part.text === 'string' ? part.text : typeof part.textDelta === 'string' ? part.textDelta : typeof part.delta === 'string' ? part.delta : ''
          if (!chunk) {
            continue
          }
          assistantContent += chunk
          await options.updateProgress(`Agent writing response (${assistantContent.length} chars)`)
          continue
        }

        if (part.type === 'reasoning-delta' && typeof part.text === 'string' && part.text) {
          reasoningContent += part.text
          const preview = reasoningContent.trim().slice(0, 120)
          await options.updateProgress(`Agent reasoning: ${preview}`)
          await flushReasoning()
          continue
        }

        if (part.type === 'tool-call') {
          const summary = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'started',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
          })
          await flushReasoning()
          await options.appendTranscript({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? 'unknown',
            input: part.input ?? {},
            timestamp: new Date().toISOString(),
          })
          await options.updateProgress(summary)
          continue
        }

        if (part.type === 'tool-result') {
          if (part.preliminary) {
            continue
          }
          const summary = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'completed',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
            result: part.output,
          })
          await flushReasoning()
          await options.appendTranscript({
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? 'unknown',
            input: part.input ?? {},
            output: part.output,
            timestamp: new Date().toISOString(),
          })
          await options.updateProgress(summary)
          continue
        }

        if (part.type === 'tool-error') {
          const errorMessage =
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === 'string'
                ? part.error
                : JSON.stringify(part.error, null, 2)
          await flushReasoning()
          await options.appendTranscript({
            type: 'tool-error',
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? 'unknown',
            input: part.input ?? {},
            error: errorMessage,
            timestamp: new Date().toISOString(),
          })
          await options.updateProgress(`Tool failed: ${part.toolName ?? 'unknown'}`)
          continue
        }
      }

      if (streamError) {
        throw streamError instanceof Error ? streamError : new Error(extractAgentErrorMessage(streamError))
      }

      streamLog.finish({ textChars: assistantContent.length, reasoningChars: reasoningContent.length })

      const finalText = (await result.text).trim() || assistantContent.trim()
      const finalOutput = reasoningContent.trim()
        ? `Reasoning:\n${reasoningContent.trim()}\n\n${finalText}`
        : finalText

      await flushReasoning()
      await options.appendTranscript({
        type: 'assistant',
        content: finalOutput,
        timestamp: new Date().toISOString(),
      })

      return {
        output: finalOutput,
        summary: finalText.slice(0, 200) || `Completed ${options.definition.id} agent run`,
      }
    } catch (error) {
      const isAbort = options.signal?.aborted === true
      if (isAbort) {
        streamLog.aborted({ textChars: assistantContent.length })
      } else {
        streamLog.error(error, { textChars: assistantContent.length })
      }
      throw error
    }
  }
}

function extractAgentErrorMessage(value: unknown): string {
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
