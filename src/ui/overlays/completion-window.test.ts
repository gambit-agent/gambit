import { describe, expect, test } from 'bun:test'

import { getCompletionWindow } from './completion-window'

const items = Array.from({ length: 30 }, (_, index) => `item-${index}`)

describe('getCompletionWindow', () => {
  test('returns everything when results fit', () => {
    const window = getCompletionWindow(items.slice(0, 5), 3, 10)
    expect(window.items).toEqual(items.slice(0, 5))
    expect(window.start).toBe(0)
    expect(window.hiddenAbove).toBe(0)
    expect(window.hiddenBelow).toBe(0)
  })

  test('starts at the top while the selection is on the first page', () => {
    const window = getCompletionWindow(items, 0, 10)
    expect(window.start).toBe(0)
    expect(window.items).toHaveLength(10)
    expect(window.hiddenBelow).toBe(20)
  })

  test('keeps the selected item inside the window for every index', () => {
    for (let selected = 0; selected < items.length; selected += 1) {
      const window = getCompletionWindow(items, selected, 10)
      expect(window.items).toHaveLength(10)
      expect(window.items).toContain(`item-${selected}`)
      expect(selected - window.start).toBeGreaterThanOrEqual(0)
      expect(selected - window.start).toBeLessThan(window.items.length)
      expect(window.hiddenAbove + window.items.length + window.hiddenBelow).toBe(items.length)
    }
  })

  test('pins the window to the bottom for the last items', () => {
    const window = getCompletionWindow(items, 29, 10)
    expect(window.start).toBe(20)
    expect(window.items).toEqual(items.slice(20, 30))
    expect(window.hiddenBelow).toBe(0)
  })

  test('clamps an out-of-range selection', () => {
    expect(getCompletionWindow(items, -5, 10).start).toBe(0)
    expect(getCompletionWindow(items, 99, 10).start).toBe(20)
  })
})
