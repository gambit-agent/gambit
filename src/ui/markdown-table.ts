/**
 * Layout for GFM tables, computed from marked's table token.
 *
 * Tables used to be handed to OpenTUI's `<markdown>` renderable, which draws
 * them correctly here but has been reported rendering as raw pipe text on real
 * terminals. Everything else in the markdown renderer is plain `<box>`/`<text>`
 * and has never shown that failure, so tables are laid out here and drawn with
 * the same primitives.
 *
 * This module is pure string work: no rendering, so the column fitting and
 * wrapping can be tested directly.
 */

export type ColumnAlign = 'left' | 'center' | 'right'

export interface MarkdownTableLayout {
  columnWidths: number[]
  /** Header cell text, wrapped to its column. */
  header: string[][]
  /** Body rows, each an array of wrapped cell lines per column. */
  rows: string[][][]
  aligns: ColumnAlign[]
}

/** Space either side of a cell's text. */
const CELL_PADDING = 1
/** Columns never shrink below this until every column is already at it. */
const PREFERRED_MIN_COLUMN = 3
const ABSOLUTE_MIN_COLUMN = 1

/** Wrap on whitespace, breaking mid-word only when a word cannot fit alone. */
export function wrapCellText(text: string, width: number): string[] {
  if (width <= 0) {
    return ['']
  }

  const words = text.split(/\s+/u).filter((word) => word.length > 0)
  if (words.length === 0) {
    return ['']
  }

  const lines: string[] = []
  let current = ''

  const pushLongWord = (word: string): string => {
    let rest = word
    while (rest.length > width) {
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    return rest
  }

  for (const word of words) {
    if (!current) {
      current = word.length <= width ? word : pushLongWord(word)
      continue
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`
      continue
    }
    lines.push(current)
    current = word.length <= width ? word : pushLongWord(word)
  }

  if (current) {
    lines.push(current)
  }

  return lines.length > 0 ? lines : ['']
}

/**
 * Shrink columns until the row fits, always taking from the widest column so
 * one long column gives up space before several short ones do.
 */
export function fitColumnWidths(natural: readonly number[], contentWidth: number): number[] {
  const widths = natural.map((width) => Math.max(width, ABSOLUTE_MIN_COLUMN))
  if (widths.length === 0) {
    return widths
  }

  const shrinkTo = (floor: number): void => {
    let total = widths.reduce((sum, width) => sum + width, 0)
    while (total > contentWidth) {
      let widest = 0
      for (let index = 1; index < widths.length; index += 1) {
        if ((widths[index] ?? 0) > (widths[widest] ?? 0)) {
          widest = index
        }
      }
      const current = widths[widest] ?? 0
      if (current <= floor) {
        return
      }
      widths[widest] = current - 1
      total -= 1
    }
  }

  shrinkTo(PREFERRED_MIN_COLUMN)
  // Still too wide with every column at the preferred floor: keep going. A
  // cramped table is better than one that overflows the terminal.
  shrinkTo(ABSOLUTE_MIN_COLUMN)

  return widths
}

export function layoutMarkdownTable(
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
  aligns: ReadonlyArray<ColumnAlign>,
  availableWidth: number,
): MarkdownTableLayout {
  const columnCount = Math.max(
    header.length,
    ...rows.map((row) => row.length),
    1,
  )

  const cellAt = (row: readonly string[], index: number): string => row[index] ?? ''

  const natural: number[] = []
  for (let index = 0; index < columnCount; index += 1) {
    let widest = cellAt(header, index).length
    for (const row of rows) {
      widest = Math.max(widest, cellAt(row, index).length)
    }
    natural.push(Math.max(widest, ABSOLUTE_MIN_COLUMN))
  }

  // Borders take one column per separator plus the two outer edges.
  const chrome = columnCount + 1 + columnCount * CELL_PADDING * 2
  const contentWidth = Math.max(columnCount * ABSOLUTE_MIN_COLUMN, availableWidth - chrome)
  const columnWidths = fitColumnWidths(natural, contentWidth)

  return {
    columnWidths,
    header: columnWidths.map((width, index) => wrapCellText(cellAt(header, index), width)),
    rows: rows.map((row) => columnWidths.map((width, index) => wrapCellText(cellAt(row, index), width))),
    aligns: columnWidths.map((_, index) => aligns[index] ?? 'left'),
  }
}

/** Pad a single wrapped line out to its column width, honouring alignment. */
export function padCellLine(text: string, width: number, align: ColumnAlign): string {
  const clipped = text.length > width ? text.slice(0, width) : text
  const slack = width - clipped.length
  if (slack <= 0) {
    return clipped
  }
  if (align === 'right') {
    return `${' '.repeat(slack)}${clipped}`
  }
  if (align === 'center') {
    const left = Math.floor(slack / 2)
    return `${' '.repeat(left)}${clipped}${' '.repeat(slack - left)}`
  }
  return `${clipped}${' '.repeat(slack)}`
}

export type BorderKind = 'top' | 'middle' | 'bottom'

const BORDER_GLYPHS: Record<BorderKind, { left: string; join: string; right: string }> = {
  top: { left: '┌', join: '┬', right: '┐' },
  middle: { left: '├', join: '┼', right: '┤' },
  bottom: { left: '└', join: '┴', right: '┘' },
}

export function buildBorderLine(columnWidths: readonly number[], kind: BorderKind): string {
  const { left, join, right } = BORDER_GLYPHS[kind]
  const segments = columnWidths.map((width) => '─'.repeat(width + CELL_PADDING * 2))
  return `${left}${segments.join(join)}${right}`
}

/**
 * One printable row of the table: the wrapped cell lines padded, aligned and
 * separated by vertical rules. A row taller than one line repeats for each.
 */
export function buildRowLines(
  cells: ReadonlyArray<readonly string[]>,
  columnWidths: readonly number[],
  aligns: ReadonlyArray<ColumnAlign>,
): string[] {
  const height = Math.max(1, ...cells.map((lines) => lines.length))
  const padding = ' '.repeat(CELL_PADDING)

  const lines: string[] = []
  for (let line = 0; line < height; line += 1) {
    const rendered = columnWidths.map((width, index) => {
      const text = cells[index]?.[line] ?? ''
      return `${padding}${padCellLine(text, width, aligns[index] ?? 'left')}${padding}`
    })
    lines.push(`│${rendered.join('│')}│`)
  }
  return lines
}

/** Total rendered width, including borders and padding. */
export function tableWidth(columnWidths: readonly number[]): number {
  return columnWidths.reduce((sum, width) => sum + width + CELL_PADDING * 2, 0) + columnWidths.length + 1
}
