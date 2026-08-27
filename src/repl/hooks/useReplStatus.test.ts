import { expect, test } from 'bun:test'

import { formatPendingInputLabel } from './useReplStatus'

test('no pending input adds no label', () => {
  expect(formatPendingInputLabel(0)).toBe('')
  expect(formatPendingInputLabel(0, 0)).toBe('')
})

test('input the running turn will pick up reads as steering', () => {
  expect(formatPendingInputLabel(2, 2)).toBe(' (2 steering)')
  expect(formatPendingInputLabel(1, 1)).toBe(' (1 steering)')
})

test('input that has to wait for the turn to end reads as queued', () => {
  expect(formatPendingInputLabel(2)).toBe(' (2 queued)')
  // An entry carrying an image cannot be steered, so both states are reported
  // rather than hiding the one that will not land mid-turn.
  expect(formatPendingInputLabel(3, 2)).toBe(' (2 steering, 1 queued)')
})

test('a steering count above the queue size never reports more than is pending', () => {
  expect(formatPendingInputLabel(1, 5)).toBe(' (1 steering)')
  expect(formatPendingInputLabel(2, -1)).toBe(' (2 queued)')
})
