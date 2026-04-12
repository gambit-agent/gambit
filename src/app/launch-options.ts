export type LaunchMode = 'new' | 'continue' | 'resume-id' | 'resume-picker' | 'headless'

export interface LaunchOptions {
  mode: LaunchMode
  conversationId?: string
  query?: string
  message?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isConversationId(value: string): boolean {
  return UUID_PATTERN.test(value.trim())
}

function readOptionalValue(argv: string[], index: number): { value: string | undefined; consumed: number } {
  const next = argv[index + 1]
  if (!next || next.startsWith('-')) {
    return { value: undefined, consumed: 0 }
  }
  return { value: next, consumed: 1 }
}

export function parseLaunchOptions(argv: string[]): LaunchOptions {
  let mode: LaunchMode = 'new'
  let conversationId: string | undefined
  let query: string | undefined
  let message: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--continue' || arg === '-c') {
      mode = 'continue'
      conversationId = undefined
      query = undefined
      continue
    }

    if (arg === '--resume' || arg === '-r') {
      const next = readOptionalValue(argv, index)
      index += next.consumed
      const value = next.value?.trim()
      if (value && isConversationId(value)) {
        mode = 'resume-id'
        conversationId = value
        query = undefined
        continue
      }

      mode = 'resume-picker'
      conversationId = undefined
      query = value || undefined
      continue
    }

    if (arg === '--message' || arg === '-m') {
      const next = argv[index + 1]
      if (next === undefined) {
        continue
      }
      index += 1
      mode = 'headless'
      message = next
      conversationId = undefined
      query = undefined
    }
  }

  return {
    mode,
    conversationId,
    query,
    message,
  }
}
