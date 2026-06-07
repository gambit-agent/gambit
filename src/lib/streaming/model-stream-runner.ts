import { stepCountIs, streamText, type LanguageModel, type ToolSet } from 'ai'
import type { ModelMessage } from '@ai-sdk/provider-utils'

import { consumeModelStream, type ModelStreamHandlers } from './stream-model-turn'
import { createStreamLogger } from '../stream-logger'

export interface ModelStreamRunOptions {
  streamId: string
  model: LanguageModel
  messages: ModelMessage[]
  tools: ToolSet
  maxSteps: number
  signal?: AbortSignal
  logMetadata?: Record<string, unknown>
  handlers?: ModelStreamHandlers
}

export interface ModelStreamRunResult {
  text: string
  streamedText: string
  reasoning: string
}

export class ModelStreamRunner {
  async run(options: ModelStreamRunOptions): Promise<ModelStreamRunResult> {
    const streamLog = createStreamLogger(options.streamId, options.logMetadata)
    let streamedText = ''
    let reasoning = ''

    try {
      const result = await streamText({
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        stopWhen: stepCountIs(options.maxSteps),
        abortSignal: options.signal,
      })

      await consumeModelStream({
        stream: result.fullStream as AsyncIterable<unknown>,
        streamLog,
        handlers: {
          onReasoningDelta: async (text, part) => {
            reasoning += text
            await options.handlers?.onReasoningDelta?.(text, part)
          },
          onTextDelta: async (chunk, part) => {
            streamedText += chunk
            await options.handlers?.onTextDelta?.(chunk, part)
          },
          onToolCall: async (part) => {
            await options.handlers?.onToolCall?.(part)
          },
          onToolResult: async (part) => {
            await options.handlers?.onToolResult?.(part)
          },
          onToolError: async (part, errorMessage) => {
            await options.handlers?.onToolError?.(part, errorMessage)
          },
        },
      })

      streamLog.finish({ textChars: streamedText.length, reasoningChars: reasoning.length })
      return {
        text: ((await result.text) || streamedText).trim(),
        streamedText,
        reasoning,
      }
    } catch (error) {
      if (options.signal?.aborted) {
        streamLog.aborted({ textChars: streamedText.length })
      } else {
        streamLog.error(error, { textChars: streamedText.length })
      }
      throw error
    }
  }
}
