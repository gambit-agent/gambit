import { expect, test } from 'bun:test'

import { parseLaunchOptions } from './launch-options'

test('defaults to a new session when no launch flags are provided', () => {
  expect(parseLaunchOptions([])).toEqual({
    mode: 'new',
    conversationId: undefined,
    query: undefined,
    headless: undefined,
  })
})

test('parses continue mode', () => {
  expect(parseLaunchOptions(['--continue'])).toEqual({
    mode: 'continue',
    conversationId: undefined,
    query: undefined,
    headless: undefined,
  })
})

test('parses resume picker mode with an optional query', () => {
  expect(parseLaunchOptions(['--resume'])).toEqual({
    mode: 'resume-picker',
    conversationId: undefined,
    query: undefined,
    headless: undefined,
  })

  expect(parseLaunchOptions(['--resume', 'auth bug'])).toEqual({
    mode: 'resume-picker',
    conversationId: undefined,
    query: 'auth bug',
    headless: undefined,
  })
})

test('parses resume by conversation id when the value is a uuid', () => {
  expect(parseLaunchOptions(['--resume', '7d8ef8c1-20d2-4c65-8f0c-0db4488ac7f9'])).toEqual({
    mode: 'resume-id',
    conversationId: '7d8ef8c1-20d2-4c65-8f0c-0db4488ac7f9',
    query: undefined,
    headless: undefined,
  })
})

test('parses -p with a prompt and defaults to text output format', () => {
  const options = parseLaunchOptions(['-p', 'hello world'])
  expect(options.mode).toBe('new')
  expect(options.headless).toEqual({
    prompt: 'hello world',
    outputFormat: 'text',
    verbose: false,
    includePartialMessages: false,
    allowedTools: undefined,
    systemPromptOverride: undefined,
    appendSystemPrompt: undefined,
    appendSystemPromptFiles: undefined,
    permissionMode: undefined,
    mcpConfigPath: undefined,
  })
})

test('parses --prompt as the long form', () => {
  const options = parseLaunchOptions(['--prompt', 'summarize the repo'])
  expect(options.headless?.prompt).toBe('summarize the repo')
})

test('accepts --print as an alias for --prompt', () => {
  const options = parseLaunchOptions(['--print', 'summarize the repo'])
  expect(options.headless?.prompt).toBe('summarize the repo')
})

test('preserves dash-prefixed prompt contents', () => {
  const options = parseLaunchOptions(['-p', '--flag-like-prompt'])
  expect(options.headless?.prompt).toBe('--flag-like-prompt')
})

test('ignores -p when no value follows', () => {
  expect(parseLaunchOptions(['-p'])).toEqual({
    mode: 'new',
    conversationId: undefined,
    query: undefined,
    headless: undefined,
  })
})

test('combines -p with --continue to resume latest in headless mode', () => {
  const options = parseLaunchOptions(['-p', 'follow up', '--continue'])
  expect(options.mode).toBe('continue')
  expect(options.headless?.prompt).toBe('follow up')
})

test('combines -p with --resume <id> to resume a specific session', () => {
  const id = '7d8ef8c1-20d2-4c65-8f0c-0db4488ac7f9'
  const options = parseLaunchOptions(['-p', 'follow up', '--resume', id])
  expect(options.mode).toBe('resume-id')
  expect(options.conversationId).toBe(id)
  expect(options.headless?.prompt).toBe('follow up')
})

test('parses --output-format with valid values', () => {
  expect(parseLaunchOptions(['-p', 'hi', '--output-format', 'json']).headless?.outputFormat).toBe('json')
  expect(parseLaunchOptions(['-p', 'hi', '--output-format', 'stream-json']).headless?.outputFormat).toBe('stream-json')
  expect(parseLaunchOptions(['-p', 'hi', '--output-format', 'text']).headless?.outputFormat).toBe('text')
})

test('ignores invalid --output-format values', () => {
  expect(parseLaunchOptions(['-p', 'hi', '--output-format', 'yaml']).headless?.outputFormat).toBe('text')
})

test('parses --verbose and --include-partial-messages flags', () => {
  const options = parseLaunchOptions(['-p', 'hi', '--verbose', '--include-partial-messages'])
  expect(options.headless?.verbose).toBe(true)
  expect(options.headless?.includePartialMessages).toBe(true)
})

test('parses --allowed-tools as a comma-separated list', () => {
  const options = parseLaunchOptions(['-p', 'hi', '--allowed-tools', 'Read, Edit,Bash'])
  expect(options.headless?.allowedTools).toEqual(['Read', 'Edit', 'Bash'])
})

test('accepts --allowedTools as an alias', () => {
  const options = parseLaunchOptions(['-p', 'hi', '--allowedTools', 'Read,Bash'])
  expect(options.headless?.allowedTools).toEqual(['Read', 'Bash'])
})

test('parses --system-prompt and --append-system-prompt', () => {
  const options = parseLaunchOptions([
    '-p',
    'hi',
    '--system-prompt',
    'You are strict.',
    '--append-system-prompt',
    'Be concise.',
    '--append-system-prompt',
    'Use bullets.',
  ])
  expect(options.headless?.systemPromptOverride).toBe('You are strict.')
  expect(options.headless?.appendSystemPrompt).toBe('Be concise.\n\nUse bullets.')
})

test('collects multiple --append-system-prompt-file values', () => {
  const options = parseLaunchOptions([
    '-p',
    'hi',
    '--append-system-prompt-file',
    './a.md',
    '--append-system-prompt-file',
    './b.md',
  ])
  expect(options.headless?.appendSystemPromptFiles).toEqual(['./a.md', './b.md'])
})

test('parses --permission-mode and rejects unknown values', () => {
  expect(parseLaunchOptions(['-p', 'hi', '--permission-mode', 'Plan']).headless?.permissionMode).toBe('Plan')
  expect(parseLaunchOptions(['-p', 'hi', '--permission-mode', 'acceptEdits']).headless?.permissionMode).toBe(
    'acceptEdits',
  )
  expect(parseLaunchOptions(['-p', 'hi', '--permission-mode', 'nonsense']).headless?.permissionMode).toBeUndefined()
})

test('parses --mcp-config with a path', () => {
  const options = parseLaunchOptions(['-p', 'hi', '--mcp-config', '/tmp/mcp.json'])
  expect(options.headless?.mcpConfigPath).toBe('/tmp/mcp.json')
})
