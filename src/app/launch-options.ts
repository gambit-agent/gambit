export type LaunchMode = 'new' | 'continue' | 'resume-id' | 'resume-picker'
export type OutputFormat = 'text' | 'json' | 'stream-json'
export type HeadlessPermissionMode = 'normal' | 'plan' | 'auto-accept' | 'acceptEdits'

export interface HeadlessLaunchOptions {
  prompt: string
  outputFormat: OutputFormat
  verbose: boolean
  includePartialMessages: boolean
  allowedTools?: string[]
  systemPromptOverride?: string
  appendSystemPrompt?: string
  appendSystemPromptFiles?: string[]
  permissionMode?: HeadlessPermissionMode
  mcpConfigPath?: string
}

export interface LaunchOptions {
  mode: LaunchMode
  conversationId?: string
  query?: string
  headless?: HeadlessLaunchOptions
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const OUTPUT_FORMATS: OutputFormat[] = ['text', 'json', 'stream-json']
const PERMISSION_MODES: HeadlessPermissionMode[] = ['normal', 'plan', 'auto-accept', 'acceptEdits']

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

function readRequiredValue(argv: string[], index: number): { value: string | undefined; consumed: number } {
  const next = argv[index + 1]
  if (next === undefined) {
    return { value: undefined, consumed: 0 }
  }
  return { value: next, consumed: 1 }
}

export function parseLaunchOptions(argv: string[]): LaunchOptions {
  let mode: LaunchMode = 'new'
  let conversationId: string | undefined
  let query: string | undefined

  let prompt: string | undefined
  let outputFormat: OutputFormat = 'text'
  let verbose = false
  let includePartialMessages = false
  let allowedTools: string[] | undefined
  let systemPromptOverride: string | undefined
  let appendSystemPrompt: string | undefined
  const appendSystemPromptFiles: string[] = []
  let permissionMode: HeadlessPermissionMode | undefined
  let mcpConfigPath: string | undefined

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

    if (arg === '--prompt' || arg === '-p' || arg === '--print') {
      const next = readRequiredValue(argv, index)
      if (next.value === undefined) continue
      index += next.consumed
      prompt = next.value
      continue
    }

    if (arg === '--output-format' || arg === '--events') {
      if (arg === '--events') {
        outputFormat = 'stream-json'
        continue
      }
      const next = readRequiredValue(argv, index)
      if (next.value && (OUTPUT_FORMATS as string[]).includes(next.value)) {
        outputFormat = next.value as OutputFormat
        index += next.consumed
      }
      continue
    }

    if (arg === '--verbose') {
      verbose = true
      continue
    }

    if (arg === '--include-partial-messages') {
      includePartialMessages = true
      continue
    }

    if (arg === '--allowed-tools' || arg === '--allowedTools') {
      const next = readRequiredValue(argv, index)
      if (next.value !== undefined) {
        const parsed = next.value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
        allowedTools = parsed
        index += next.consumed
      }
      continue
    }

    if (arg === '--system-prompt') {
      const next = readRequiredValue(argv, index)
      if (next.value !== undefined) {
        systemPromptOverride = next.value
        index += next.consumed
      }
      continue
    }

    if (arg === '--append-system-prompt') {
      const next = readRequiredValue(argv, index)
      if (next.value !== undefined) {
        appendSystemPrompt = appendSystemPrompt
          ? `${appendSystemPrompt}\n\n${next.value}`
          : next.value
        index += next.consumed
      }
      continue
    }

    if (arg === '--append-system-prompt-file') {
      const next = readRequiredValue(argv, index)
      if (next.value !== undefined) {
        appendSystemPromptFiles.push(next.value)
        index += next.consumed
      }
      continue
    }

    if (arg === '--permission-mode') {
      const next = readRequiredValue(argv, index)
      if (next.value && (PERMISSION_MODES as string[]).includes(next.value)) {
        permissionMode = next.value as HeadlessPermissionMode
        index += next.consumed
      }
      continue
    }

    if (arg === '--mcp-config') {
      const next = readOptionalValue(argv, index)
      if (next.value !== undefined) {
        mcpConfigPath = next.value
        index += next.consumed
      }
      continue
    }
  }

  const headless: HeadlessLaunchOptions | undefined =
    prompt !== undefined
      ? {
          prompt,
          outputFormat,
          verbose,
          includePartialMessages,
          allowedTools,
          systemPromptOverride,
          appendSystemPrompt,
          appendSystemPromptFiles: appendSystemPromptFiles.length > 0 ? appendSystemPromptFiles : undefined,
          permissionMode,
          mcpConfigPath,
        }
      : undefined

  return {
    mode,
    conversationId,
    query,
    headless,
  }
}
