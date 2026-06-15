import { expect, test } from 'bun:test'

import { parseAssistantReasoning } from './ConversationPanel'
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
