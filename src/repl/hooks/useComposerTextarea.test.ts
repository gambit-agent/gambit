import { describe, expect, test } from 'bun:test'

import { resolveRewrittenCursorOffset, shouldApplyExternalValue } from './useComposerTextarea'

describe('resolveRewrittenCursorOffset', () => {
  test('keeps the caret just past a collapsed paste label', () => {
    const typed = 'before X after'
    const collapsed = 'before [Pasted text #1 +10 lines] after'
    // Caret sat right after the inserted blob; it belongs after the label.
    const offset = resolveRewrittenCursorOffset(typed.indexOf(' after'), typed, collapsed)

    expect(offset).toBe(collapsed.indexOf(' after'))
  })

  test('clamps into the rewritten value at both ends', () => {
    expect(resolveRewrittenCursorOffset(0, 'abcdef', 'ab')).toBe(0)
    expect(resolveRewrittenCursorOffset(6, 'abcdef', 'ab')).toBe(2)
  })
})

describe('shouldApplyExternalValue', () => {
  test('applies an external edit that the textarea did not produce', () => {
    expect(shouldApplyExternalValue('recalled', 'draft', 'draft')).toBe(true)
  })

  test('ignores the render that echoes the value the textarea just produced', () => {
    // The user typed another character before React re-rendered; writing the
    // stale state back would drop it.
    expect(shouldApplyExternalValue('ab', 'abc', 'ab')).toBe(false)
  })

  test('still clears the composer after a submit that echoed the same value', () => {
    // Regression: a one-shot "input came from the textarea" flag went stale
    // whenever onInput produced no state change, swallowing the next clear.
    expect(shouldApplyExternalValue('', 'draft', 'draft')).toBe(true)
  })

  test('skips a value the textarea already holds', () => {
    expect(shouldApplyExternalValue('same', 'same', null)).toBe(false)
  })
})
