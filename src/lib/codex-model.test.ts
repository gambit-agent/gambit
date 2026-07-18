import { expect, test } from 'bun:test'
import type { LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider'

import { buildRequestBody, createCodexLanguageModel, filterResponseHeaders } from './codex-model'

const baseOptions: LanguageModelV2CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

function sseBody(events: Array<Record<string, unknown>>, separator = '\n\n'): string {
  return events.map((event) => `data: ${JSON.stringify(event)}${separator}`).join('')
}

function makeModel() {
  return createCodexLanguageModel({
    modelId: 'codex/gpt-5.1-codex',
    authToken: async () => ({ accessToken: 'token', accountId: 'account' }),
  })
}

async function withMockedFetch<T>(body: string, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function collectStreamParts(stream: ReadableStream<LanguageModelV2StreamPart>): Promise<LanguageModelV2StreamPart[]> {
  const parts: LanguageModelV2StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

const parallelToolCallEvents: Array<Record<string, unknown>> = [
  { type: 'response.created', response: { id: 'resp_1' } },
  {
    type: 'response.output_item.added',
    item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '' },
  },
  {
    type: 'response.output_item.added',
    item: { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'write_file', arguments: '' },
  },
  { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path":' },
  { type: 'response.function_call_arguments.delta', item_id: 'fc_2', delta: '{"file":' },
  { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"a.txt"}' },
  { type: 'response.function_call_arguments.delta', item_id: 'fc_2', delta: '"b.txt"}' },
  { type: 'response.function_call_arguments.done', item_id: 'fc_1', arguments: '{"path":"a.txt"}' },
  { type: 'response.function_call_arguments.done', item_id: 'fc_2', arguments: '{"file":"b.txt"}' },
  {
    type: 'response.output_item.done',
    item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
  },
  {
    type: 'response.output_item.done',
    item: { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'write_file', arguments: '{"file":"b.txt"}' },
  },
  { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } },
]

test('emits both tool calls when a response contains parallel function calls', async () => {
  await withMockedFetch(sseBody(parallelToolCallEvents), async () => {
    const { stream } = await makeModel().doStream(baseOptions)
    const parts = await collectStreamParts(stream)

    const toolCalls = parts.filter((part) => part.type === 'tool-call')
    expect(toolCalls).toEqual([
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: '{"path":"a.txt"}' },
      { type: 'tool-call', toolCallId: 'call_2', toolName: 'write_file', input: '{"file":"b.txt"}' },
    ])

    const deltas = parts.filter((part) => part.type === 'tool-input-delta')
    expect(deltas.map((part) => part.id)).toEqual(['call_1', 'call_2', 'call_1', 'call_2'])
    expect(parts.filter((part) => part.type === 'tool-input-end').map((part) => part.id)).toEqual(['call_1', 'call_2'])
  })
})

test('emits a tool call from output_item.done when arguments.done is omitted', async () => {
  const events: Array<Record<string, unknown>> = [
    {
      type: 'response.output_item.added',
      item: { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'list_dir', arguments: '' },
    },
    {
      type: 'response.output_item.done',
      item: { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'list_dir', arguments: '{"dir":"src"}' },
    },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
  ]

  await withMockedFetch(sseBody(events), async () => {
    const { stream } = await makeModel().doStream(baseOptions)
    const parts = await collectStreamParts(stream)

    expect(parts.filter((part) => part.type === 'tool-call')).toEqual([
      { type: 'tool-call', toolCallId: 'call_9', toolName: 'list_dir', input: '{"dir":"src"}' },
    ])
  })
})

test('doGenerate surfaces tool calls in the generate result', async () => {
  await withMockedFetch(sseBody(parallelToolCallEvents), async () => {
    const result = await makeModel().doGenerate(baseOptions)

    expect(result.content).toEqual([
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: '{"path":"a.txt"}' },
      { type: 'tool-call', toolCallId: 'call_2', toolName: 'write_file', input: '{"file":"b.txt"}' },
    ])
    expect(result.usage.totalTokens).toBe(14)
  })
})

test('parses SSE streams framed with CRLF blank lines', async () => {
  const events: Array<Record<string, unknown>> = [
    { type: 'response.output_text.delta', delta: 'hello' },
    { type: 'response.output_text.delta', delta: ' world' },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 2 } } },
  ]

  await withMockedFetch(sseBody(events, '\r\n\r\n'), async () => {
    const { stream } = await makeModel().doStream(baseOptions)
    const parts = await collectStreamParts(stream)

    const text = parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => part.delta)
      .join('')
    expect(text).toBe('hello world')
  })
})

test('filterResponseHeaders keeps only safe headers', () => {
  const headers = new Headers({
    'content-type': 'text/event-stream',
    'x-request-id': 'req_123',
    'openai-processing-ms': '42',
    'x-ratelimit-remaining-requests': '99',
    'set-cookie': 'session=secret',
    'cf-ray': 'abc',
  })

  expect(filterResponseHeaders(headers)).toEqual({
    'content-type': 'text/event-stream',
    'x-request-id': 'req_123',
    'openai-processing-ms': '42',
    'x-ratelimit-remaining-requests': '99',
  })
})

test('includes prompt_cache_key when a cache key is provided', () => {
  const body = buildRequestBody('gpt-5.1-codex', {
    ...baseOptions,
    providerOptions: { openai: { promptCacheKey: 'conversation-123' } },
  })

  expect(body.prompt_cache_key).toBe('conversation-123')
})

test('omits prompt_cache_key when no cache key is provided', () => {
  const body = buildRequestBody('gpt-5.1-codex', baseOptions)

  expect(body).not.toHaveProperty('prompt_cache_key')
})

test('maps cached input tokens from the responses usage payload', async () => {
  const { extractUsage } = await import('./codex-model')

  expect(
    extractUsage({
      input_tokens: 2620,
      input_tokens_details: { cached_tokens: 2304, cache_write_tokens: 0 },
      output_tokens: 5,
      total_tokens: 2625,
    }),
  ).toEqual({ inputTokens: 2620, outputTokens: 5, totalTokens: 2625, cachedInputTokens: 2304 })

  expect(extractUsage({ input_tokens: 10, output_tokens: 2 }).cachedInputTokens).toBeUndefined()
})
