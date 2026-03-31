import { streamText } from 'ai'

import { formatToolEvent, toCoreMessages } from '../lib/messages'
import { createModelSelector, type ReasoningEffort } from '../lib/model'
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

    const result = await streamText({
      model: selectModel(options.modelId, modelSettings),
      messages: toCoreMessages(
        history.map((message) => ({
          ...message,
          timestamp: new Date(message.timestamp),
        })),
      ),
      tools,
      stopWhen: [],
      abortSignal: options.signal,
    })

    let assistantContent = ''
    let reasoningContent = ''
    const stream = result.fullStream as AsyncIterable<any>

    for await (const part of stream) {
      if (part.type === 'text-delta') {
        const chunk =
          typeof part.textDelta === 'string' ? part.textDelta : typeof part.delta === 'string' ? part.delta : ''
        if (!chunk) {
          continue
        }
        assistantContent += chunk
        await options.updateProgress(`Agent writing response (${assistantContent.length} chars)`)
        continue
      }

      if (part.type === 'reasoning') {
        if (typeof part.text === 'string' && part.text) {
          reasoningContent += part.text
          await options.updateProgress('Agent reasoning')
        }
        continue
      }

      if (part.type === 'tool-call') {
        const summary = formatToolEvent({
          toolName: part.toolName ?? 'unknown',
          args: part.input ?? {},
          toolCallId: part.toolCallId,
        })
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
          args: part.input ?? {},
          toolCallId: part.toolCallId,
          result: part.output,
        })
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

    const finalText = (await result.text).trim() || assistantContent.trim()
    const finalOutput = reasoningContent.trim()
      ? `Reasoning:\n${reasoningContent.trim()}\n\n${finalText}`
      : finalText

    await options.appendTranscript({
      type: 'assistant',
      content: finalOutput,
      timestamp: new Date().toISOString(),
    })

    return {
      output: finalOutput,
      summary: finalText.slice(0, 200) || `Completed ${options.definition.id} agent run`,
    }
  }
}
