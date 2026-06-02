import { expect, test } from 'bun:test'

import { parseAssistantReasoning } from './ConversationPanel'

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
