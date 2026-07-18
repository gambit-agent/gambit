import { stepCountIs, streamText, type LanguageModel, type LogWarningsFunction, type ToolSet, type Warning } from 'ai'
import type { ModelMessage } from '@ai-sdk/provider-utils'

import { consumeModelStream, type ModelStreamHandlers } from './stream-model-turn'

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
  /**
   * Stable identifier for the conversation, used to improve prompt cache
   * routing (OpenAI `prompt_cache_key`, including the ChatGPT connector).
   */
  promptCacheKey?: string
}

export interface ModelStreamRunResult {
  text: string
  streamedText: string
  reasoning: string
  /** True when the user aborted the stream before it finished. */
  aborted: boolean
  /** Finish reason reported by the model (e.g. 'stop', 'length', 'tool-calls'). */
  finishReason?: string
  /** Number of completed model steps. */
  stepCount: number
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

const CACHE_BREAKPOINT_COUNT = 2
const ANTHROPIC_CACHE_CONTROL = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const

/**
 * Remove any cache breakpoints previously added by `withCacheBreakpoints`, so
 * that re-annotating between steps never accumulates breakpoints (Anthropic
 * allows at most 4 per request; system/tools may already consume some).
 */
export function stripCacheBreakpoints(messages: readonly NonSystemModelMessage[]): NonSystemModelMessage[] {
  return messages.map((message) => {
    const providerOptions = message.providerOptions
    if (!providerOptions || !('anthropic' in providerOptions)) {
      return message
    }
    const { anthropic, ...rest } = providerOptions
    const anthropicOptions = { ...(anthropic as Record<string, unknown>) }
    delete anthropicOptions.cacheControl
    const nextProviderOptions = {
      ...rest,
      ...(Object.keys(anthropicOptions).length > 0 ? { anthropic: anthropicOptions } : {}),
    }
    if (Object.keys(nextProviderOptions).length === 0) {
      const { providerOptions: _removed, ...bare } = message
      return bare as NonSystemModelMessage
    }
    return { ...message, providerOptions: nextProviderOptions } as NonSystemModelMessage
  })
}

/**
 * Mark the trailing messages as prompt-cache breakpoints. Anthropic (and
 * OpenRouter-routed Anthropic models) only cache prompt prefixes that end at
 * an explicit `cache_control` breakpoint; a breakpoint on the last message
 * caches everything before it (tools + system + history). Other providers
 * ignore the `anthropic` provider-options namespace.
 */
export function withCacheBreakpoints(messages: NonSystemModelMessage[]): NonSystemModelMessage[] {
  if (messages.length === 0) {
    return messages
  }

  const firstBreakpointIndex = Math.max(0, messages.length - CACHE_BREAKPOINT_COUNT)
  return messages.map((message, index) => {
    if (index < firstBreakpointIndex) {
      return message
    }
    return {
      ...message,
      providerOptions: { ...message.providerOptions, ...ANTHROPIC_CACHE_CONTROL },
    } as NonSystemModelMessage
  })
}

/**
 * Slide the cache breakpoints to the current trailing messages. Used by
 * `prepareStep` so intra-turn tool traffic appended after the initial
 * annotation still lands inside the cached prefix on subsequent steps.
 */
export function reannotateCacheBreakpoints(messages: readonly NonSystemModelMessage[]): NonSystemModelMessage[] {
  return withCacheBreakpoints(stripCacheBreakpoints(messages))
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
    let streamedText = ''
    let reasoning = ''
    const prompt = splitInstructionsFromMessages(options.messages)

    return await withFilteredAiSdkWarnings(async () => {
      const result = await streamText({
        model: options.model,
        instructions: prompt.instructions,
        // Cache breakpoints are added exclusively by `prepareStep`, which runs
        // before every step (including the first); annotating here as well
        // would be dead work.
        messages: prompt.messages,
        tools: options.tools,
        stopWhen: stepCountIs(options.maxSteps),
        abortSignal: options.signal,
        // (Re-)annotate the trailing messages on every step: the loop appends
        // tool traffic after the previous step's breakpoints, and a frozen
        // breakpoint would re-send all intra-turn messages uncached on each
        // step. The strip inside `reannotateCacheBreakpoints` stays required:
        // the SDK carries the returned messages into the next step's input.
        prepareStep: ({ messages }) => ({
          messages: reannotateCacheBreakpoints(messages as NonSystemModelMessage[]),
        }),
        providerOptions: options.promptCacheKey
          ? { openai: { promptCacheKey: options.promptCacheKey } }
          : undefined,
      })

      const consumeResult = await consumeModelStream({
        stream: result.fullStream as AsyncIterable<unknown>,
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

      // After a user abort the SDK's result promises may reject or never
      // settle; fall back to the streamed text instead of awaiting them.
      const text = consumeResult.aborted ? streamedText.trim() : ((await result.text) || streamedText).trim()

      return {
        text,
        streamedText,
        reasoning,
        aborted: consumeResult.aborted,
        finishReason: consumeResult.finishReason,
        stepCount: consumeResult.stepCount,
      }
    })
  }
}
