import { expect, test } from 'bun:test'

import { CharCanvas, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from './canvas'

test('strokes meeting in a cell produce the right junction', () => {
  const canvas = new CharCanvas(5, 3)
  canvas.vertical(2, 0, 2)
  canvas.horizontal(0, 4, 1)

  // A crossing must read as a crossing, not as whichever stroke drew last.
  expect(canvas.toLines()[1]).toBe('──┼──')
  expect(canvas.toLines()[0]).toBe('  │')
})

test('a stroke ending on another produces a tee', () => {
  const canvas = new CharCanvas(5, 3)
  canvas.vertical(2, 0, 2)
  canvas.horizontal(2, 4, 1)

  expect(canvas.toLines()[1]).toBe('  ├──')
})

test('individual connections merge into corners', () => {
  const canvas = new CharCanvas(3, 3)
  canvas.connect(1, 1, DIR_UP | DIR_RIGHT)
  expect(canvas.toLines()[1]).toBe(' └')

  const other = new CharCanvas(3, 3)
  other.connect(1, 1, DIR_DOWN | DIR_LEFT)
  expect(other.toLines()[1]).toBe(' ┐')
})

test('text overwrites line state and is not merged into', () => {
  const canvas = new CharCanvas(6, 1)
  canvas.horizontal(0, 5, 0)
  canvas.text(2, 0, 'ab')

  expect(canvas.toLines()[0]).toBe('──ab──')

  // Routing another edge across a label must leave the text readable.
  canvas.vertical(2, 0, 0)
  expect(canvas.toLines()[0]).toBe('──ab──')
})

test('clear reopens a cell for line drawing but set does not', () => {
  const cleared = new CharCanvas(3, 1)
  cleared.text(1, 0, 'x')
  cleared.clear(1, 0)
  cleared.horizontal(0, 2, 0)
  expect(cleared.toLines()[0]).toBe('───')

  const blanked = new CharCanvas(3, 1)
  blanked.text(1, 0, 'x')
  blanked.set(1, 0, ' ')
  blanked.horizontal(0, 2, 0)
  expect(blanked.toLines()[0]).toBe('─ ─')
})

test('textAtFirstFree skips occupied candidates and reports failure', () => {
  const canvas = new CharCanvas(10, 2)
  canvas.horizontal(0, 9, 0)

  expect(canvas.textAtFirstFree([{ x: 0, y: 0 }, { x: 0, y: 1 }], 'label')).toBe(true)
  expect(canvas.toLines()[0]).toBe('──────────')
  expect(canvas.toLines()[1]).toBe('label')

  // Nowhere free: the label is dropped rather than punched through a line.
  expect(canvas.textAtFirstFree([{ x: 0, y: 0 }], 'other')).toBe(false)
  expect(canvas.toLines()[0]).toBe('──────────')
})

test('trimmed output drops blank leading and trailing rows', () => {
  const canvas = new CharCanvas(4, 5)
  canvas.text(0, 2, 'hi')

  expect(canvas.toTrimmedLines()).toEqual(['hi'])
})

test('drawing outside the canvas is ignored', () => {
  const canvas = new CharCanvas(3, 2)
  canvas.text(-5, 0, 'abc')
  canvas.set(99, 99, 'x')
  canvas.horizontal(-10, 20, 0)

  expect(canvas.toLines()[0]).toBe('───')
})
