import { expect, test } from 'bun:test'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { formatToolMessageLine, toolMessageRunningFrames } from './tool-message-line'

function createToolMessage(
  status: 'started' | 'completed' | 'failed',
  metadata: NonNullable<ConversationMessage['metadata']> = {},
): ConversationMessage {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: '2026-04-01T12:00:00.000Z',
    metadata: {
      toolName: 'executeShell',
      toolArgs: { command: 'echo hello' },
      toolStatus: status,
      ...metadata,
    },
  }
}

test('formats running tool messages with a tool-specific prefix', () => {
  const line = formatToolMessageLine(createToolMessage('started'), 1)

  expect(line.indicator).toBe(toolMessageRunningFrames[1])
  expect(line.text).toBe('Ran: echo hello')
})

test('omits the animated indicator once the tool finishes', () => {
  const line = formatToolMessageLine(createToolMessage('completed'), 2)

  expect(line.indicator).toBeNull()
  expect(line.text).toBe('Ran: echo hello')
})

test('uses varied action verbs based on the tool name', () => {
  expect(
    formatToolMessageLine(createToolMessage('completed', { toolName: 'readFile', toolArgs: { path: 'src/index.tsx' } })).text,
  ).toStartWith('Read:')
  expect(
    formatToolMessageLine(createToolMessage('started', { toolName: 'searchFiles', toolArgs: { query: 'TODO' } })).text,
  ).toStartWith('Searched:')
  expect(
    formatToolMessageLine(createToolMessage('completed', { toolName: 'patchFile', toolArgs: { path: 'src/index.tsx' } })).text,
  ).toStartWith('Edited:')
  expect(
    formatToolMessageLine(createToolMessage('completed', { toolName: 'listTasks', toolArgs: {} })).text,
  ).toStartWith('Explored:')
})
