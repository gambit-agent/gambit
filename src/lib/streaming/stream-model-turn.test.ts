import { expect, test } from 'bun:test'

import { consumeModelStream } from './stream-model-turn'

async function* streamOf(parts: unknown[]): AsyncGenerator<unknown> {
  for (const part of parts) {
    yield part
  }
}

test('reports an abort part instead of treating the stream as a success', async () => {
  const toolCalls: string[] = []
  const result = await consumeModelStream({
    stream: streamOf([
      { type: 'text-delta', text: 'working on ' },
      { type: 'tool-call', toolCallId: 'tc-1', toolName: 'bash', input: { command: 'sleep' } },
      // The AI SDK enqueues an abort part and closes without throwing.
      { type: 'abort' },
    ]),
    handlers: {
      onToolCall: async (part) => {
        toolCalls.push(part.toolCallId ?? '')
      },
    },
  })

  expect(result.aborted).toBe(true)
  expect(toolCalls).toEqual(['tc-1'])
})

test('surfaces the finish reason and completed step count', async () => {
  const result = await consumeModelStream({
    stream: streamOf([
      { type: 'start' },
      { type: 'start-step' },
      { type: 'text-delta', text: 'partial' },
      { type: 'finish-step' },
      { type: 'start-step' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'length' },
    ]),
    handlers: {},
  })

  expect(result.aborted).toBe(false)
  expect(result.finishReason).toBe('length')
  expect(result.stepCount).toBe(2)
})

test('aggregates every error part into a single thrown error', async () => {
  await expect(
    consumeModelStream({
      stream: streamOf([
        { type: 'error', error: 'first failure' },
        { type: 'text-delta', text: 'recovered a bit' },
        { type: 'error', error: { message: 'second failure' } },
      ]),
      handlers: {},
    }),
  ).rejects.toThrow('first failure; second failure')
})

test('rethrows a single Error instance unchanged', async () => {
  const original = new Error('boom')
  await expect(
    consumeModelStream({
      stream: streamOf([{ type: 'error', error: original }]),
      handlers: {},
    }),
  ).rejects.toBe(original)
})

test('does not throw stream errors when the user aborted', async () => {
  const result = await consumeModelStream({
    stream: streamOf([{ type: 'error', error: 'aborted mid-flight' }, { type: 'abort' }]),
    handlers: {},
  })

  expect(result.aborted).toBe(true)
})
