export interface BoundedTextResult {
  text: string
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 20_000

export interface CollectBoundedTextOptions {
  /**
   * Stop reading when this aborts, even though the stream has not reached EOF.
   *
   * A pipe stays open as long as *any* process holds its write end, so a
   * surviving grandchild keeps the reader pending forever after the direct
   * child is gone. Callers that know the process has exited use this to stop
   * waiting on output that will never arrive.
   */
  stopSignal?: AbortSignal
}

export async function collectBoundedText(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
  options: CollectBoundedTextOptions = {},
): Promise<BoundedTextResult> {
  if (!stream || maxChars <= 0) {
    return { text: '', truncated: Boolean(stream) }
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false

  const { stopSignal } = options
  // Cancelling the reader settles the in-flight read() with done: true, which
  // is what unblocks the loop below.
  const onStop = () => {
    void reader.cancel().catch(() => undefined)
  }
  if (stopSignal?.aborted) {
    onStop()
  } else {
    stopSignal?.addEventListener('abort', onStop, { once: true })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      const chunk = decoder.decode(value, { stream: true })
      if (text.length < maxChars) {
        const remaining = maxChars - text.length
        if (chunk.length > remaining) {
          truncated = true
        }
        text += chunk.length <= remaining ? chunk : chunk.slice(0, remaining)
      } else if (chunk.length > 0) {
        truncated = true
      }
    }

    const tail = decoder.decode()
    if (tail) {
      if (text.length < maxChars) {
        const remaining = maxChars - text.length
        if (tail.length > remaining) {
          truncated = true
        }
        text += tail.length <= remaining ? tail : tail.slice(0, remaining)
      } else {
        truncated = true
      }
    }
  } finally {
    stopSignal?.removeEventListener('abort', onStop)
    reader.releaseLock()
  }

  return { text, truncated }
}

export function appendTruncationNotice(result: BoundedTextResult, label = 'output'): string {
  if (!result.truncated) {
    return result.text
  }
  const suffix = `\n[${label} truncated]\n`
  return `${result.text}${suffix}`
}
