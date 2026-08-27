import { expect, test } from 'bun:test'

import { extractToolPreamble } from './tool-preamble'

const segment = (text: string, hasVisibleReasoning = false) => ({
  id: 'assistant-1',
  text,
  hasVisibleReasoning,
})

test('reads a short single-line segment as the call reason', () => {
  expect(extractToolPreamble(segment('checking how submit routes input'))).toBe(
    'checking how submit routes input',
  )
  expect(extractToolPreamble(segment('  running the type checker  '))).toBe('running the type checker')
})

test('keeps prose out of the tool line', () => {
  expect(extractToolPreamble(null)).toBeNull()
  expect(extractToolPreamble(segment(''))).toBeNull()
  expect(extractToolPreamble(segment('   '))).toBeNull()
  // Multi-line and over-long text is real content: folding it into the tool
  // line would hide something the user needs to read.
  expect(extractToolPreamble(segment('first line\nsecond line'))).toBeNull()
  expect(extractToolPreamble(segment('a'.repeat(201)))).toBeNull()
})

test('markdown structure is never a preamble', () => {
  expect(extractToolPreamble(segment('## Findings'))).toBeNull()
  expect(extractToolPreamble(segment('- checking the queue'))).toBeNull()
  expect(extractToolPreamble(segment('1. checking the queue'))).toBeNull()
  expect(extractToolPreamble(segment('> quoted'))).toBeNull()
  expect(extractToolPreamble(segment('```ts'))).toBeNull()
})

test('a segment that also renders reasoning stays visible on its own', () => {
  expect(extractToolPreamble(segment('checking the queue', true))).toBeNull()
})
