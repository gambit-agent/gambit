export interface BoundedTextResult {
  text: string
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 20_000

export async function collectBoundedText(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<BoundedTextResult> {
  if (!stream || maxChars <= 0) {
    return { text: '', truncated: Boolean(stream) }
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false

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
