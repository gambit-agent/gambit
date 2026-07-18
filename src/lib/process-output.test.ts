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
