import { expect, test } from 'bun:test'
import type { LanguageModel } from 'ai'
import type { ModelMessage } from '@ai-sdk/provider-utils'

import { filterKnownAiSdkWarnings, ModelStreamRunner, splitInstructionsFromMessages } from './model-stream-runner'

test('splits system messages into instructions for the AI SDK', () => {
  const messages: ModelMessage[] = [
    { role: 'system', content: 'Base prompt' },
    { role: 'user', content: 'Ask me a question' },
    { role: 'system', content: 'Relevant memory' },
    { role: 'assistant', content: 'Sure.' },
  ]

  const prompt = splitInstructionsFromMessages(messages)

  expect(prompt.instructions).toBe('Base prompt\n\nRelevant memory')
  expect(prompt.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
})

test('filters the OpenRouter system-message provider warning only', () => {
  const warnings = filterKnownAiSdkWarnings([
    {
      type: 'other',
      message:
        'System messages in the prompt or messages fields can be a security risk because they may enable prompt injection attacks. Use the system option instead when possible.',
    },
    {
      type: 'unsupported',
      feature: 'seed',
      details: 'This model ignores seed.',
    },
    {
      type: 'other',
      message: 'A different provider warning.',
    },
  ])

  expect(warnings).toEqual([
    {
      type: 'unsupported',
      feature: 'seed',
      details: 'This model ignores seed.',
    },
    {
      type: 'other',
      message: 'A different provider warning.',
    },
  ])
})

test('streams with system messages by passing them as instructions', async () => {
  ;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = false

  let capturedPrompt: unknown
  const model = {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    async doStream(options: { prompt: unknown }) {
      capturedPrompt = options.prompt
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: {} })
            controller.close()
          },
        }),
        warnings: [],
      }
    },
  } as unknown as LanguageModel

  await new ModelStreamRunner().run({
    streamId: 'system-instructions-test',
    model,
    messages: [
      { role: 'system', content: 'Base prompt' },
      { role: 'user', content: 'Ask me a question' },
    ],
    tools: {},
    maxSteps: 1,
  })

  expect((capturedPrompt as ModelMessage[]).map((message) => message.role)).toEqual(['system', 'user'])
  expect((globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS).toBe(false)
})

test('marks the trailing messages as anthropic cache breakpoints', async () => {
  const { withCacheBreakpoints } = await import('./model-stream-runner')
  const messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ] as const

  const annotated = withCacheBreakpoints([...messages] as Parameters<typeof withCacheBreakpoints>[0])

  expect(annotated[0]?.providerOptions).toBeUndefined()
  expect(annotated[1]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
  expect(annotated[2]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
  // Original messages are not mutated.
  expect(messages[2]).not.toHaveProperty('providerOptions')
})

test('preserves existing provider options when adding cache breakpoints', async () => {
  const { withCacheBreakpoints } = await import('./model-stream-runner')
  const annotated = withCacheBreakpoints([
    { role: 'user', content: 'hi', providerOptions: { openai: { promptCacheKey: 'abc' } } },
  ])

  expect(annotated[0]?.providerOptions).toEqual({
    openai: { promptCacheKey: 'abc' },
    anthropic: { cacheControl: { type: 'ephemeral' } },
  })
})

test('handles empty message lists when adding cache breakpoints', async () => {
  const { withCacheBreakpoints } = await import('./model-stream-runner')
  expect(withCacheBreakpoints([])).toEqual([])
})

test('passes the prompt cache key and cache breakpoints through to the model call', async () => {
  ;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = false

  let capturedOptions: { prompt: ModelMessage[]; providerOptions?: Record<string, Record<string, unknown>> } | undefined
  const model = {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    async doStream(options: { prompt: ModelMessage[]; providerOptions?: Record<string, Record<string, unknown>> }) {
      capturedOptions = options
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: {} })
            controller.close()
          },
        }),
        warnings: [],
      }
    },
  } as unknown as LanguageModel

  await new ModelStreamRunner().run({
    streamId: 'cache-key-test',
    model,
    messages: [
      { role: 'system', content: 'Base prompt' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ],
    tools: {},
    maxSteps: 1,
    promptCacheKey: 'conversation-abc',
  })

  expect(capturedOptions?.providerOptions?.openai?.promptCacheKey).toBe('conversation-abc')
  const prompt = capturedOptions?.prompt ?? []
  const nonSystem = prompt.filter((message) => message.role !== 'system')
  expect(nonSystem[0]?.providerOptions).toBeUndefined()
  expect(nonSystem[1]?.providerOptions).toMatchObject({ anthropic: { cacheControl: { type: 'ephemeral' } } })
  expect(nonSystem[2]?.providerOptions).toMatchObject({ anthropic: { cacheControl: { type: 'ephemeral' } } })
})
