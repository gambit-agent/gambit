import { describe, expect, test } from 'bun:test'

import {
  LARGE_PASTE_MIN_CHARACTERS,
  LARGE_PASTE_MIN_LINES,
  PastedTextDraft,
  shouldCollapsePastedText,
} from './pasted-text'

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')
}

describe('large pasted text thresholds', () => {
  test('collapses at ten lines but not nine', () => {
    expect(shouldCollapsePastedText(lines(LARGE_PASTE_MIN_LINES - 1))).toBe(false)
    expect(shouldCollapsePastedText(lines(LARGE_PASTE_MIN_LINES))).toBe(true)
  })

  test('collapses at one thousand characters but not 999', () => {
    expect(shouldCollapsePastedText('x'.repeat(LARGE_PASTE_MIN_CHARACTERS - 1))).toBe(false)
    expect(shouldCollapsePastedText('x'.repeat(LARGE_PASTE_MIN_CHARACTERS))).toBe(true)
  })
})

describe('PastedTextDraft', () => {
  test('numbers multiple pastes and expands exact content with surrounding text', () => {
    const draft = new PastedTextDraft()
    const first = lines(10)
    const second = 'x'.repeat(1_000)
    const firstLabel = draft.collapse(first)
    const secondLabel = draft.collapse(second)

    expect(firstLabel).toBe('[Pasted text #1 +10 lines]')
    expect(secondLabel).toBe('[Pasted text #2 +1000 chars]')
    expect(draft.materialize(`before ${firstLabel} between ${secondLabel} after`)).toBe(
      `before ${first} between ${second} after`,
    )
  })

  test('does not expand a token after the user edits or deletes its label', () => {
    const draft = new PastedTextDraft()
    const label = draft.collapse(lines(10))
    const edited = label.replace('Pasted', 'Edited')

    expect(draft.materialize(edited)).toBe(edited)
    expect(draft.materialize(label)).toBe(label)
  })

  test('expands in one pass when pasted content contains another label', () => {
    const draft = new PastedTextDraft()
    const first = `${lines(10)}\n[Pasted text #2 +1000 chars]`
    const second = 'y'.repeat(1_000)
    const firstLabel = draft.collapse(first)
    const secondLabel = draft.collapse(second)

    expect(draft.materialize(`${firstLabel}\n${secondLabel}`)).toBe(`${first}\n${second}`)
  })

  test('resets numbering after the draft is cleared', () => {
    const draft = new PastedTextDraft()
    draft.collapse(lines(10))
    draft.sync('')

    expect(draft.collapse(lines(10))).toBe('[Pasted text #1 +10 lines]')
  })
})
