export interface StreamToolPart {
  type: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
  preliminary?: boolean
  error?: unknown
}

export interface ModelStreamHandlers {
  onTextDelta?: (chunk: string, part: StreamToolPart) => Promise<void>
  onReasoningDelta?: (text: string, part: StreamToolPart) => Promise<void>
  onToolCall?: (part: StreamToolPart) => Promise<void>
  onToolResult?: (part: StreamToolPart) => Promise<void>
  onToolError?: (part: StreamToolPart, errorMessage: string) => Promise<void>
}

export interface ModelStreamConsumeResult {
  /** True when the stream ended with an 'abort' part (user abort) instead of finishing. */
  aborted: boolean
  /** Finish reason from the final 'finish' part (e.g. 'stop', 'length', 'tool-calls'). */
  finishReason?: string
  /** Number of completed model steps observed on the stream. */
  stepCount: number
}

export async function consumeModelStream(options: {
  stream: AsyncIterable<unknown>
  handlers: ModelStreamHandlers
}): Promise<ModelStreamConsumeResult> {
  const streamErrors: unknown[] = []
  let aborted = false
  let finishReason: string | undefined
  let stepCount = 0

  for await (const rawPart of options.stream) {
    const part = normalizeStreamPart(rawPart)

    if (part.type === 'error') {
      streamErrors.push(part.error)
      continue
    }

    if (part.type === 'abort') {
      // The AI SDK enqueues an abort part and closes the stream without
      // throwing; treat it as an interruption, never as success.
      aborted = true
      continue
    }

    if (part.type === 'finish') {
      finishReason = part.finishReason
      continue
    }

    if (part.type === 'finish-step') {
      stepCount++
      continue
    }

    if (part.type === 'reasoning-delta' && part.reasoningDelta) {
      await options.handlers.onReasoningDelta?.(part.reasoningDelta, part)
      continue
    }

    if (part.type === 'text-delta' && part.textDelta) {
      await options.handlers.onTextDelta?.(part.textDelta, part)
      continue
    }

    if (part.type === 'tool-call') {
      await options.handlers.onToolCall?.(part)
      continue
    }

    if (part.type === 'tool-result') {
      await options.handlers.onToolResult?.(part)
      continue
    }

    if (part.type === 'tool-error') {
      await options.handlers.onToolError?.(part, extractErrorMessage(part.error))
    }
  }

  if (streamErrors.length > 0 && !aborted) {
    if (streamErrors.length === 1 && streamErrors[0] instanceof Error) {
      throw streamErrors[0]
    }
    throw new Error(streamErrors.map((error) => extractErrorMessage(error)).join('; '))
  }

  return { aborted, finishReason, stepCount }
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

function normalizeStreamPart(value: unknown): StreamToolPart & {
  reasoningDelta: string
  textDelta: string
  textLength?: number
  finishReason?: string
} {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const type = typeof record.type === 'string' ? record.type : 'unknown'
  const textDelta =
    typeof record.text === 'string'
      ? record.text
      : typeof record.textDelta === 'string'
        ? record.textDelta
        : typeof record.delta === 'string'
          ? record.delta
          : ''

  return {
    type,
    toolName: typeof record.toolName === 'string' ? record.toolName : undefined,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    input: record.input,
    output: record.output,
    preliminary: typeof record.preliminary === 'boolean' ? record.preliminary : undefined,
    error: record.error,
    reasoningDelta: typeof record.text === 'string' && type === 'reasoning-delta' ? record.text : '',
    textDelta: type === 'text-delta' ? textDelta : '',
    textLength: textDelta ? textDelta.length : undefined,
    finishReason: typeof record.finishReason === 'string' ? record.finishReason : undefined,
  }
}
