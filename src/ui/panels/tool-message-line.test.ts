import { expect, test } from 'bun:test'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { formatToolMessageLine, toolMessageRunningFrames } from './tool-message-line'

function createToolMessage(status: 'started' | 'completed' | 'failed'): ConversationMessage {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: '2026-04-01T12:00:00.000Z',
    metadata: {
      toolName: 'executeShell',
      toolArgs: { command: 'echo hello' },
      toolStatus: status,
    },
  }
}

test('formats running tool messages without a chevron prefix', () => {
  const line = formatToolMessageLine(createToolMessage('started'), 1)

  expect(line.indicator).toBe(toolMessageRunningFrames[1])
  expect(line.text.startsWith('Tool: executeShell [running]')).toBe(true)
  expect(line.text.includes('> Tool')).toBe(false)
})

test('omits the animated indicator once the tool finishes', () => {
  const line = formatToolMessageLine(createToolMessage('completed'), 2)

  expect(line.indicator).toBeNull()
  expect(line.text.startsWith('Tool: executeShell [done]')).toBe(true)
})
