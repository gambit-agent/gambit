import { expect, test } from 'bun:test'
import { tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { ModelMessage } from '@ai-sdk/provider-utils'

import {
  acceptsSteeringInjection,
  appendSteeringMessages,
  applySteering,
  filterKnownAiSdkWarnings,
  ModelStreamRunner,
  splitInstructionsFromMessages,
  STEERING_MESSAGE_PREFIX,
} from './model-stream-runner'

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

test('reannotating slides breakpoints to the current trailing messages', async () => {
  const { reannotateCacheBreakpoints, withCacheBreakpoints } = await import('./model-stream-runner')

  // Simulate a later step: earlier messages carry stale breakpoints from a
  // previous step, and tool traffic was appended after them.
  const stepMessages = [
    ...withCacheBreakpoints([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'calling a tool' },
    ]),
    { role: 'tool', content: [] },
    { role: 'assistant', content: 'calling another tool' },
    { role: 'tool', content: [] },
  ] as Parameters<typeof reannotateCacheBreakpoints>[0]

  const annotated = reannotateCacheBreakpoints(stepMessages)

  // Stale breakpoints are removed; only the trailing two messages carry one.
  expect(annotated).toHaveLength(5)
  expect(annotated[0]?.providerOptions).toBeUndefined()
  expect(annotated[1]?.providerOptions).toBeUndefined()
  expect(annotated[2]?.providerOptions).toBeUndefined()
  expect(annotated[3]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
  expect(annotated[4]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
})

test('stripping breakpoints preserves unrelated provider options', async () => {
  const { stripCacheBreakpoints } = await import('./model-stream-runner')

  const stripped = stripCacheBreakpoints([
    {
      role: 'user',
      content: 'hi',
      providerOptions: {
        openai: { promptCacheKey: 'abc' },
        anthropic: { cacheControl: { type: 'ephemeral' }, other: 'keep' },
      },
    },
  ])

  expect(stripped[0]?.providerOptions).toEqual({
    openai: { promptCacheKey: 'abc' },
    anthropic: { other: 'keep' },
  })
})

test('re-annotation stays within the two-breakpoint budget across repeated steps', async () => {
  const { reannotateCacheBreakpoints } = await import('./model-stream-runner')

  let messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
  ] as Parameters<typeof reannotateCacheBreakpoints>[0]

  for (let step = 0; step < 5; step++) {
    messages = reannotateCacheBreakpoints([...messages, { role: 'assistant', content: `step ${step}` }])
    const breakpointCount = messages.filter(
      (message) =>
        (message.providerOptions as Record<string, Record<string, unknown>> | undefined)?.anthropic?.cacheControl,
    ).length
    expect(breakpointCount).toBe(2)
  }
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

test('a user message may follow tool results but not unanswered tool calls', () => {
  const toolCall: ModelMessage = {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 'tc-1', toolName: 'bash', input: {} }],
  }
  const toolResult: ModelMessage = {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: 'tc-1', toolName: 'bash', output: { type: 'text', value: 'ok' } }],
  }

  expect(acceptsSteeringInjection([{ role: 'user', content: 'hi' }])).toBe(true)
  expect(acceptsSteeringInjection([{ role: 'assistant', content: 'done' }])).toBe(true)
  expect(acceptsSteeringInjection([toolCall, toolResult])).toBe(true)
  // Injecting here would separate the tool call from its result.
  expect(acceptsSteeringInjection([toolCall])).toBe(false)
  expect(acceptsSteeringInjection([])).toBe(false)
})

test('steering is appended as marked user messages', () => {
  const messages = appendSteeringMessages([{ role: 'user', content: 'refactor this' }], ['use grep instead'])

  expect(messages).toHaveLength(2)
  expect(messages[1]?.role).toBe('user')
  expect(messages[1]?.content).toBe(`${STEERING_MESSAGE_PREFIX}\n\nuse grep instead`)
})

test('applySteering injects pending text and reports what was injected', async () => {
  const steered: string[][] = []
  const messages = await applySteering([{ role: 'user', content: 'refactor this' }], {
    pull: () => ['use grep instead'],
    onSteered: (texts) => {
      steered.push([...texts])
    },
  })

  expect(steered).toEqual([['use grep instead']])
  expect(messages).toHaveLength(2)
  expect(messages[1]?.content).toContain('use grep instead')
})

test('applySteering does not pull when the messages cannot take a user turn', async () => {
  let pulls = 0
  const toolCall: ModelMessage = {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 'tc-1', toolName: 'bash', input: {} }],
  }

  // Pulling here would consume the user's text and then have nowhere to put
  // it, silently losing what they typed.
  const messages = await applySteering([toolCall] as never, {
    pull: () => {
      pulls += 1
      return ['stop what you are doing']
    },
  })

  expect(pulls).toBe(0)
  expect(messages).toHaveLength(1)
})

test('applySteering still injects when recording the steer fails', async () => {
  const messages = await applySteering([{ role: 'user', content: 'go' }], {
    pull: () => ['actually stop'],
    onSteered: () => {
      throw new Error('store write failed')
    },
  })

  expect(messages).toHaveLength(2)
  expect(messages[1]?.content).toContain('actually stop')
})

test('no steering source leaves the messages untouched', async () => {
  const original: ModelMessage[] = [{ role: 'user', content: 'go' }]

  expect(await applySteering(original as never, undefined)).toEqual(original as never)
  expect(await applySteering(original as never, { pull: () => [] })).toEqual(original as never)
})

test('steering typed during a step reaches the model on the next one', async () => {
  ;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = false

  const prompts: ModelMessage[][] = []
  const pending: string[] = []
  const model = {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    async doStream(options: { prompt: ModelMessage[] }) {
      prompts.push(options.prompt)
      const isFirstStep = prompts.length === 1
      if (isFirstStep) {
        // The user types while the first step is in flight.
        pending.push('actually check the tests first')
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            if (isFirstStep) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'tc-1',
                toolName: 'echo',
                input: '{"value":"hi"}',
              })
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: {} })
            } else {
              controller.enqueue({ type: 'text-start', id: 't1' })
              controller.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              controller.enqueue({ type: 'text-end', id: 't1' })
              controller.enqueue({ type: 'finish', finishReason: 'stop', usage: {} })
            }
            controller.close()
          },
        }),
        warnings: [],
      }
    },
  } as unknown as LanguageModel

  const steered: string[] = []

  await new ModelStreamRunner().run({
    streamId: 'steering-e2e',
    model,
    messages: [
      { role: 'system', content: 'Base prompt' },
      { role: 'user', content: 'refactor the queue' },
    ],
    tools: {
      echo: tool({
        description: 'echo',
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }: { value: string }) => value,
      }),
    },
    maxSteps: 3,
    steering: {
      pull: () => pending.splice(0, pending.length),
      onSteered: (texts) => {
        steered.push(...texts)
      },
    },
  })

  expect(prompts).toHaveLength(2)
  // Nothing had been typed when the turn started.
  expect(prompts[0]!.filter((message) => message.role === 'user')).toHaveLength(1)

  // The second step sees it, placed after the tool result rather than between
  // the tool call and its result.
  const secondStep = prompts[1]!
  expect(steered).toEqual(['actually check the tests first'])
  expect(secondStep.at(-1)?.role).toBe('user')
  expect(JSON.stringify(secondStep.at(-1)?.content)).toContain('actually check the tests first')
  expect(secondStep.at(-2)?.role).toBe('tool')
})

test('input already waiting when a turn starts is injected on the first step', async () => {
  ;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = false

  let capturedPrompt: ModelMessage[] = []
  const model = {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    async doStream(options: { prompt: ModelMessage[] }) {
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

  const pending = ['and skip the tests']

  await new ModelStreamRunner().run({
    streamId: 'steering-first-step',
    model,
    messages: [
      { role: 'system', content: 'Base prompt' },
      { role: 'user', content: 'refactor the queue' },
    ],
    tools: {},
    maxSteps: 1,
    steering: { pull: () => pending.splice(0, pending.length) },
  })

  // Typed between submitting and the first model call: no reason to make it
  // wait a whole step.
  expect(capturedPrompt.at(-1)?.role).toBe('user')
  expect(JSON.stringify(capturedPrompt.at(-1)?.content)).toContain('and skip the tests')
})
