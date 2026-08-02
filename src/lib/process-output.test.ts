import { expect, test } from 'bun:test'

import { appendTruncationNotice, collectBoundedText } from './process-output'

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

test('collectBoundedText drains streams while capping retained text', async () => {
  const result = await collectBoundedText(streamFromChunks(['abc', 'def', 'ghi']), 5)

  expect(result).toEqual({ text: 'abcde', truncated: true })
  expect(appendTruncationNotice(result, 'stdout')).toContain('[stdout truncated]')
})

test('collectBoundedText returns complete text under the cap', async () => {
  const result = await collectBoundedText(streamFromChunks(['hello']), 10)

  expect(result).toEqual({ text: 'hello', truncated: false })
})

test('collectBoundedText does not mark exact cap output as truncated', async () => {
  const result = await collectBoundedText(streamFromChunks(['hello']), 5)

  expect(result).toEqual({ text: 'hello', truncated: false })
})

test('collectBoundedText stops on the stop signal when the stream never ends', async () => {
  const encoder = new TextEncoder()
  // Models a pipe whose write end is still held by a surviving grandchild:
  // data arrives, then the stream stays open forever without closing.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('partial output'))
    },
  })

  const stop = new AbortController()
  const collected = collectBoundedText(stream, 100, { stopSignal: stop.signal })
  setTimeout(() => stop.abort(), 50)

  await expect(collected).resolves.toEqual({ text: 'partial output', truncated: false })
})

test('collectBoundedText returns immediately for an already-aborted stop signal', async () => {
  const stop = new AbortController()
  stop.abort()
  const stream = new ReadableStream<Uint8Array>({ start() {} })

  await expect(collectBoundedText(stream, 100, { stopSignal: stop.signal })).resolves.toEqual({
    text: '',
    truncated: false,
  })
})
