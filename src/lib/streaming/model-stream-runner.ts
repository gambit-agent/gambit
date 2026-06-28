import { stepCountIs, streamText, type LanguageModel, type LogWarningsFunction, type ToolSet, type Warning } from 'ai'
import type { ModelMessage } from '@ai-sdk/provider-utils'

import { consumeModelStream, type ModelStreamHandlers } from './stream-model-turn'
import { createStreamLogger } from '../stream-logger'

type NonSystemModelMessage = Exclude<ModelMessage, { role: 'system' }>
type WarningLoggerOptions = Parameters<LogWarningsFunction>[0]

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

export function splitInstructionsFromMessages(messages: readonly ModelMessage[]): {
  instructions?: string
  messages: NonSystemModelMessage[]
} {
  const instructions: string[] = []
  const nonSystemMessages: NonSystemModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) {
        instructions.push(message.content)
      }
      continue
    }

    nonSystemMessages.push(message)
  }

  return {
    instructions: instructions.length > 0 ? instructions.join('\n\n') : undefined,
    messages: nonSystemMessages,
  }
}

export function filterKnownAiSdkWarnings(warnings: readonly Warning[]): Warning[] {
  return warnings.filter((warning) => {
    if (warning.type !== 'other') {
      return true
    }
    return !warning.message.includes('System messages in the prompt or messages fields can be a security risk')
  })
}

function formatAiSdkWarning(warning: Warning, options: WarningLoggerOptions): string {
  const scope = options.provider && options.model ? ` (${options.provider} / ${options.model})` : ''
  const prefix = `AI SDK Warning${scope}:`

  switch (warning.type) {
    case 'unsupported':
      return `${prefix} The feature "${warning.feature}" is not supported.${warning.details ? ` ${warning.details}` : ''}`
    case 'compatibility':
      return `${prefix} The feature "${warning.feature}" is used in a compatibility mode.${warning.details ? ` ${warning.details}` : ''}`
    case 'deprecated':
      return `${prefix} Deprecated: "${warning.setting}". ${warning.message}`
    case 'other':
      return `${prefix} ${warning.message}`
  }
}

function logAiSdkWarnings(warnings: Warning[], options: WarningLoggerOptions): void {
  for (const warning of warnings) {
    const message = formatAiSdkWarning(warning, options)
    if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
      process.emitWarning(message, {
        type: warning.type === 'deprecated' ? 'DeprecationWarning' : 'Warning',
      })
    } else {
      console.warn(message)
    }
  }
}

async function withFilteredAiSdkWarnings<T>(run: () => Promise<T>): Promise<T> {
  const previousLogger = globalThis.AI_SDK_LOG_WARNINGS
  if (previousLogger === false) {
    return run()
  }

  globalThis.AI_SDK_LOG_WARNINGS = (options) => {
    const warnings = filterKnownAiSdkWarnings(options.warnings)
    if (warnings.length === 0) {
      return
    }
    if (typeof previousLogger === 'function') {
      previousLogger({ ...options, warnings })
      return
    }
    logAiSdkWarnings(warnings, options)
  }

  try {
    return await run()
  } finally {
    globalThis.AI_SDK_LOG_WARNINGS = previousLogger
  }
}

export class ModelStreamRunner {
  async run(options: ModelStreamRunOptions): Promise<ModelStreamRunResult> {
    const streamLog = createStreamLogger(options.streamId, options.logMetadata)
    let streamedText = ''
    let reasoning = ''
    const prompt = splitInstructionsFromMessages(options.messages)

    try {
      return await withFilteredAiSdkWarnings(async () => {
        const result = await streamText({
          model: options.model,
          instructions: prompt.instructions,
          messages: prompt.messages,
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
      })
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
