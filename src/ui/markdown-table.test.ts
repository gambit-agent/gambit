import { expect, test } from 'bun:test'

import {
  buildBorderLine,
  buildRowLines,
  fitColumnWidths,
  layoutMarkdownTable,
  padCellLine,
  tableWidth,
  wrapCellText,
} from './markdown-table'

test('cell text wraps on whitespace', () => {
  expect(wrapCellText('one two three', 9)).toEqual(['one two', 'three'])
  expect(wrapCellText('short', 20)).toEqual(['short'])
  expect(wrapCellText('', 10)).toEqual([''])
  expect(wrapCellText('   ', 10)).toEqual([''])
})

test('a word too long for its column is broken rather than clipped', () => {
  expect(wrapCellText('supercalifragilistic', 6)).toEqual(['superc', 'alifra', 'gilist', 'ic'])
  // The break must not swallow the words around it.
  expect(wrapCellText('a supercalifragilistic b', 6)).toEqual(['a', 'superc', 'alifra', 'gilist', 'ic b'])
})

test('columns keep their natural width when the table already fits', () => {
  expect(fitColumnWidths([5, 10, 3], 100)).toEqual([5, 10, 3])
})

test('shrinking takes from the widest column first', () => {
  // 40 wide must lose 8; all of it comes off the 30-wide column.
  expect(fitColumnWidths([5, 30, 5], 32)).toEqual([5, 22, 5])
  // Once columns even out they shrink together.
  expect(fitColumnWidths([10, 10], 14)).toEqual([7, 7])
})

test('columns shrink past the preferred floor only when they must', () => {
  // Three columns into 9 leaves each at the preferred minimum.
  expect(fitColumnWidths([20, 20, 20], 9)).toEqual([3, 3, 3])
  // Tighter than that, they keep going rather than overflowing the terminal.
  expect(fitColumnWidths([20, 20, 20], 3)).toEqual([1, 1, 1])
})

test('layout wraps every cell to its fitted column', () => {
  const layout = layoutMarkdownTable(
    ['Name', 'What it does'],
    [['Runtime', 'Bun and TypeScript together']],
    ['left', 'left'],
    34,
  )

  expect(tableWidth(layout.columnWidths)).toBeLessThanOrEqual(34)
  expect(layout.header[0]).toEqual(['Name'])
  expect(layout.rows[0]![1]!.length).toBeGreaterThan(1)
})

test('ragged rows are padded out to the widest row', () => {
  const layout = layoutMarkdownTable(['A', 'B', 'C'], [['only one']], ['left', 'left', 'left'], 60)

  expect(layout.columnWidths).toHaveLength(3)
  expect(layout.rows[0]).toHaveLength(3)
  expect(layout.rows[0]![2]).toEqual([''])
})

test('alignment positions text within its column', () => {
  expect(padCellLine('ab', 6, 'left')).toBe('ab    ')
  expect(padCellLine('ab', 6, 'right')).toBe('    ab')
  expect(padCellLine('ab', 6, 'center')).toBe('  ab  ')
  // An odd remainder leans left, matching how the header renders.
  expect(padCellLine('ab', 7, 'center')).toBe('  ab   ')
  expect(padCellLine('toolong', 4, 'left')).toBe('tool')
})

test('borders and rows agree on width', () => {
  const widths = [4, 6]
  const top = buildBorderLine(widths, 'top')
  const rows = buildRowLines([['ab'], ['cd']], widths, ['left', 'right'])

  expect(top).toBe('┌──────┬────────┐')
  expect(buildBorderLine(widths, 'middle')).toBe('├──────┼────────┤')
  expect(buildBorderLine(widths, 'bottom')).toBe('└──────┴────────┘')
  expect(rows).toEqual(['│ ab   │     cd │'])
  expect(rows[0]!.length).toBe(top.length)
  expect(tableWidth(widths)).toBe(top.length)
})

test('a taller cell stretches its whole row', () => {
  const rows = buildRowLines([['one'], ['a', 'b', 'c']], [3, 3], ['left', 'left'])

  expect(rows).toEqual(['│ one │ a   │', '│     │ b   │', '│     │ c   │'])
})
