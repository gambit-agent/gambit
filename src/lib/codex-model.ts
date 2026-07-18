import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2FunctionTool,
  LanguageModelV2Message,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'

import { getCodexAuthToken, normalizeCodexModelId } from './codex-auth'
import type { ReasoningEffort } from './model'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex/responses'
const OPENAI_BETA = 'responses=experimental'

type ResponsesInputItem = Record<string, unknown>
type ResponsesEvent = Record<string, unknown>

interface CodexLanguageModelOptions {
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  authToken?: typeof getCodexAuthToken
}

export function createCodexLanguageModel(options: CodexLanguageModelOptions): LanguageModelV2 {
  const modelId = normalizeCodexModelId(options.modelId)
  const getAuthToken = options.authToken ?? getCodexAuthToken
  return {
    specificationVersion: 'v2',
    provider: 'openai-codex',
    modelId,
    supportedUrls: {},
    async doGenerate(callOptions) {
      const { stream } = await this.doStream(callOptions)
      const reader = stream.getReader()
      const content: LanguageModelV2Content[] = []
      let text = ''
      let finishReason: LanguageModelV2FinishReason = 'stop'
      let usage: LanguageModelV2Usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text-delta') text += value.delta
        if (value.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            input: value.input,
          })
        }
        if (value.type === 'finish') {
          finishReason = value.finishReason
          usage = value.usage
        }
      }

      if (text) content.push({ type: 'text', text })
      return { content, finishReason, usage, warnings: [] }
    },
    async doStream(callOptions) {
      const requestBody = buildRequestBody(modelId, callOptions, options.reasoningEffort)
      const { accessToken, accountId } = await getAuthToken()
      const response = await fetch(CODEX_BASE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'chatgpt-account-id': accountId,
          originator: 'gambit',
          'OpenAI-Beta': OPENAI_BETA,
          accept: 'text/event-stream',
          'content-type': 'application/json',
          'User-Agent': 'gambit',
        },
        body: JSON.stringify(requestBody),
        signal: callOptions.abortSignal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(formatCodexError(response.status, text || response.statusText))
      }

      return {
        stream: createResponseStream(response),
        request: { body: requestBody },
        response: { headers: filterResponseHeaders(response.headers) },
      }
    },
  }
}

export function buildRequestBody(
  modelId: string,
  options: LanguageModelV2CallOptions,
  reasoningEffort?: ReasoningEffort | null,
): Record<string, unknown> {
  const { instructions, input } = convertPrompt(options.prompt)
  const body: Record<string, unknown> = {
    model: modelId,
    store: false,
    stream: true,
    instructions: instructions || 'You are a helpful assistant.',
    input,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    text: { verbosity: 'low' },
    include: ['reasoning.encrypted_content'],
  }

  if (typeof options.temperature === 'number') body.temperature = options.temperature
  if (typeof options.maxOutputTokens === 'number') body.max_output_tokens = options.maxOutputTokens
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort, summary: 'auto' }
  if (options.tools?.length) body.tools = options.tools.filter(isFunctionTool).map(convertTool)

  // Stable per-conversation key improves prompt cache routing on the backend
  // (same mechanism as the official Codex CLI's session-scoped cache key).
  const promptCacheKey = options.providerOptions?.openai?.promptCacheKey
  if (typeof promptCacheKey === 'string' && promptCacheKey) body.prompt_cache_key = promptCacheKey

  return body
}

function convertPrompt(prompt: readonly LanguageModelV2Message[]): { instructions: string; input: ResponsesInputItem[] } {
  const instructions: string[] = []
  const input: ResponsesInputItem[] = []

  for (const message of prompt) {
    if (message.role === 'system') {
      instructions.push(message.content)
      continue
    }

    if (message.role === 'user') {
      input.push({ role: 'user', content: message.content.map(partToText).filter(Boolean).join('\n') })
      continue
    }

    if (message.role === 'assistant') {
      const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
      if (text) input.push({ role: 'assistant', content: text })
      for (const part of message.content) {
        if (part.type === 'tool-call') {
          input.push({
            type: 'function_call',
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: JSON.stringify(part.input ?? {}),
          })
        }
      }
      continue
    }

    for (const part of message.content) {
      input.push({
        type: 'function_call_output',
        call_id: part.toolCallId,
        output: toolOutputToString(part.output),
      })
    }
  }

  return { instructions: instructions.join('\n\n'), input }
}

function partToText(part: { type: string; text?: string; data?: unknown; mediaType?: string }): string {
  if (part.type === 'text') return part.text ?? ''
  if (part.type === 'file') return `[${part.mediaType ?? 'file'} omitted]`
  return ''
}

function toolOutputToString(output: { type: string; value?: unknown }): string {
  if (output.type === 'text' || output.type === 'error-text') return String(output.value ?? '')
  return JSON.stringify(output.value ?? null)
}

function isFunctionTool(tool: NonNullable<LanguageModelV2CallOptions['tools']>[number]): tool is LanguageModelV2FunctionTool {
  return tool.type === 'function'
}

function convertTool(tool: LanguageModelV2FunctionTool): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }
}

function createResponseStream(response: Response): ReadableStream<LanguageModelV2StreamPart> {
  return new ReadableStream<LanguageModelV2StreamPart>({
    async start(controller) {
      // Each in-flight function call is indexed under BOTH the output item id
      // (`fc_...`, carried by `response.function_call_arguments.*` events as
      // `item_id`) and the `call_id` so either identifier resolves it. The
      // emitted tool-call part always uses the true `call_id`.
      const toolCalls = new Map<string, ToolCallState>()
      let toolCallCount = 0
      let textStarted = false
      let reasoningStarted = false
      let usage: LanguageModelV2Usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }
      let finishReason: LanguageModelV2FinishReason = 'stop'

      const ensureText = () => {
        if (textStarted) return
        textStarted = true
        controller.enqueue({ type: 'text-start', id: 'text-0' })
      }
      const ensureReasoning = () => {
        if (reasoningStarted) return
        reasoningStarted = true
        controller.enqueue({ type: 'reasoning-start', id: 'reasoning-0' })
      }

      controller.enqueue({ type: 'stream-start', warnings: [] })

      try {
        for await (const event of parseSSE(response)) {
          if (event.type === 'response.created') {
            const responseId = getNestedString(event, 'response', 'id')
            if (responseId) controller.enqueue({ type: 'response-metadata', id: responseId })
            continue
          }

          if (event.type === 'response.output_text.delta') {
            const delta = typeof event.delta === 'string' ? event.delta : ''
            if (delta) {
              ensureText()
              controller.enqueue({ type: 'text-delta', id: 'text-0', delta })
            }
            continue
          }

          if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
            const delta = typeof event.delta === 'string' ? event.delta : ''
            if (delta) {
              ensureReasoning()
              controller.enqueue({ type: 'reasoning-delta', id: 'reasoning-0', delta })
            }
            continue
          }

          if (event.type === 'response.output_item.added') {
            const item = getRecord(event, 'item')
            if (item?.type === 'function_call') {
              const callId = stringValue(item.call_id)
              const itemId = stringValue(item.id)
              const id = callId || itemId || `call-${toolCallCount}`
              toolCallCount += 1
              const name = stringValue(item.name) || 'unknown'
              const call: ToolCallState = { id, name, input: stringValue(item.arguments) || '', emitted: false }
              toolCalls.set(id, call)
              if (itemId) toolCalls.set(itemId, call)
              controller.enqueue({ type: 'tool-input-start', id, toolName: name })
            }
            continue
          }

          if (event.type === 'response.function_call_arguments.delta') {
            const call = findToolCall(event, toolCalls)
            const delta = typeof event.delta === 'string' ? event.delta : ''
            if (call && delta) {
              call.input += delta
              controller.enqueue({ type: 'tool-input-delta', id: call.id, delta })
            }
            continue
          }

          if (event.type === 'response.function_call_arguments.done') {
            const call = findToolCall(event, toolCalls)
            if (call && !call.emitted) {
              call.emitted = true
              call.input = stringValue(event.arguments) || call.input
              controller.enqueue({ type: 'tool-input-end', id: call.id })
              controller.enqueue({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.input || '{}' })
            }
            continue
          }

          if (event.type === 'response.output_item.done') {
            const item = getRecord(event, 'item')
            if (item?.type === 'function_call') {
              const id = stringValue(item.call_id) || stringValue(item.id)
              const call = id ? toolCalls.get(id) : undefined
              if (call && !call.input) call.input = stringValue(item.arguments) || '{}'
              // Some backends omit `function_call_arguments.done`; make sure the
              // tool call is still surfaced exactly once.
              if (call && !call.emitted) {
                call.emitted = true
                controller.enqueue({ type: 'tool-input-end', id: call.id })
                controller.enqueue({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.input || '{}' })
              }
            }
            continue
          }

          if (event.type === 'response.completed' || event.type === 'response.done' || event.type === 'response.incomplete') {
            const responsePayload = getRecord(event, 'response')
            usage = extractUsage(responsePayload?.usage)
            finishReason = event.type === 'response.incomplete' ? 'length' : 'stop'
            continue
          }

          if (event.type === 'error' || event.type === 'response.failed') {
            controller.enqueue({ type: 'error', error: formatEventError(event) })
            finishReason = 'error'
          }
        }

        if (reasoningStarted) controller.enqueue({ type: 'reasoning-end', id: 'reasoning-0' })
        if (textStarted) controller.enqueue({ type: 'text-end', id: 'text-0' })
        controller.enqueue({ type: 'finish', finishReason, usage })
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

async function* parseSSE(response: Response): AsyncGenerator<ResponsesEvent> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = findEventBoundary(buffer)
      while (boundary) {
        const chunk = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const data = chunk
          .split('\n')
          .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
          .trim()
        if (data && data !== '[DONE]') yield JSON.parse(data) as ResponsesEvent
        boundary = findEventBoundary(buffer)
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {}
    try {
      reader.releaseLock()
    } catch {}
  }
}

/** SSE events end at a blank line; tolerate both `\n\n` and `\r\n\r\n` framing. */
function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  if (lf !== -1) return { index: lf, length: 2 }
  return null
}

export function extractUsage(value: unknown): LanguageModelV2Usage {
  const usage = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const input = numberValue(usage.input_tokens)
  const output = numberValue(usage.output_tokens)
  const inputDetails =
    usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
      ? (usage.input_tokens_details as Record<string, unknown>)
      : {}
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: numberValue(usage.total_tokens) ?? (input !== undefined && output !== undefined ? input + output : undefined),
    cachedInputTokens: numberValue(inputDetails.cached_tokens),
  }
}

const SAFE_RESPONSE_HEADERS = new Set(['content-type', 'x-request-id'])
const SAFE_RESPONSE_HEADER_PREFIXES = ['openai-', 'x-ratelimit-']

export function filterResponseHeaders(headers: Headers): Record<string, string> {
  const filtered: Record<string, string> = {}
  headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (SAFE_RESPONSE_HEADERS.has(name) || SAFE_RESPONSE_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      filtered[name] = value
    }
  })
  return filtered
}

function formatCodexError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; plan_type?: string; resets_at?: number } }
    const error = parsed.error
    if (error?.code?.match(/usage_limit|rate_limit/i) || status === 429) {
      return `You have hit your ChatGPT usage limit${error?.plan_type ? ` (${error.plan_type})` : ''}.`
    }
    return error?.message || body
  } catch {
    return `Codex request failed (${status}): ${body}`
  }
}

function formatEventError(event: ResponsesEvent): Error {
  const message = getNestedString(event, 'error', 'message') || stringValue(event.message) || JSON.stringify(event)
  return new Error(message)
}

function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function getNestedString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  let current: unknown = record
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return stringValue(current)
}

interface ToolCallState {
  id: string
  name: string
  input: string
  emitted: boolean
}

function findToolCall(event: ResponsesEvent, toolCalls: Map<string, ToolCallState>): ToolCallState | undefined {
  const itemId = stringValue(event.item_id)
  if (itemId && toolCalls.has(itemId)) return toolCalls.get(itemId)
  const callId = stringValue(event.call_id)
  if (callId && toolCalls.has(callId)) return toolCalls.get(callId)
  const unique = new Set(toolCalls.values())
  if (unique.size === 1) return unique.values().next().value
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
