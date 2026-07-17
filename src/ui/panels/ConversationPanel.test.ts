import { expect, test } from 'bun:test'

import { groupConversationRenderItems, parseAssistantReasoning } from './ConversationPanel'
import { shouldRenderMessageTimestamp } from './ConversationPanel'
import type { ConversationMessage } from '../../conversation/conversation-types'

function createMessage(role: ConversationMessage['role'], content: string): ConversationMessage {
  return {
    id: `${role}-1`,
    role,
    content,
    timestamp: '2026-04-01T12:00:00.000Z',
  }
}

function createToolMessage(id: string, toolName: string, toolArgs: Record<string, unknown>): ConversationMessage {
  return {
    id,
    role: 'tool',
    content: '',
    timestamp: '2026-04-01T12:00:00.000Z',
    metadata: {
      toolName,
      toolArgs,
      toolStatus: 'completed',
    },
  }
}

test('parses assistant reasoning prefix into reasoning and response sections', () => {
  expect(parseAssistantReasoning('Reasoning:\nInspect intent.\n\nDone.')).toEqual({
    reasoning: 'Inspect intent.',
    response: 'Done.',
  })
})

test('parses streaming reasoning before the answer starts', () => {
  expect(parseAssistantReasoning('Reasoning:\nStill thinking...')).toEqual({
    reasoning: 'Still thinking...',
    response: '',
  })
})

test('ignores regular assistant text', () => {
  expect(parseAssistantReasoning('Reasoning is useful, but this is normal prose.')).toBeNull()
})

test('omits timestamp footer for assistant thought blocks', () => {
  expect(shouldRenderMessageTimestamp(createMessage('assistant', 'Reasoning:\nInspect intent.'))).toBe(false)
  expect(shouldRenderMessageTimestamp(createMessage('assistant', 'Reasoning:\nInspect intent.\n\nDone.'))).toBe(false)
})

test('keeps timestamp footer for normal messages', () => {
  expect(shouldRenderMessageTimestamp(createMessage('assistant', 'Done.'))).toBe(true)
  expect(shouldRenderMessageTimestamp(createMessage('user', 'Please inspect this.'))).toBe(true)
})

test('groups adjacent explored tool messages in normal mode', () => {
  const items = groupConversationRenderItems(
    [
      createToolMessage('tool-1', 'readFile', { path: 'src/repl/ReplScreen.tsx' }),
      createToolMessage('tool-2', 'readFile', { path: 'src/lib/modelPicker.ts' }),
      createToolMessage('tool-3', 'readFile', { path: 'src/tools/mcp.ts' }),
    ],
    false,
  )

  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    type: 'tool-group',
    messages: [{ id: 'tool-1' }, { id: 'tool-2' }, { id: 'tool-3' }],
  })
})

test('does not group tool messages in transcript mode', () => {
  const items = groupConversationRenderItems(
    [
      createToolMessage('tool-1', 'readFile', { path: 'src/repl/ReplScreen.tsx' }),
      createToolMessage('tool-2', 'readFile', { path: 'src/lib/modelPicker.ts' }),
    ],
    true,
  )

  expect(items).toEqual([
    { type: 'message', message: expect.objectContaining({ id: 'tool-1' }) },
    { type: 'message', message: expect.objectContaining({ id: 'tool-2' }) },
  ])
})
