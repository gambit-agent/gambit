/**
 * A fixed-size grid of characters that diagrams are drawn onto before being
 * handed to the TUI as plain lines.
 *
 * Line drawing tracks which directions each cell connects in, so two strokes
 * meeting in the same cell produce the right junction ('├', '┼', …) instead of
 * whichever one was drawn last. Terminal diagrams cross edges constantly, and
 * without this they read as broken.
 */

export const DIR_UP = 1
export const DIR_RIGHT = 2
export const DIR_DOWN = 4
export const DIR_LEFT = 8

/** Solid box-drawing glyph for every combination of connected directions. */
const SOLID_BY_MASK: readonly string[] = [
  ' ', '│', '─', '└', '│', '│', '┌', '├',
  '─', '┘', '─', '┴', '┐', '┤', '┬', '┼',
]

/** Dotted equivalents, used for `-.->` style edges. */
const DASHED_BY_MASK: readonly string[] = [
  ' ', '╎', '╌', '└', '╎', '╎', '┌', '├',
  '╌', '┘', '╌', '┴', '┐', '┤', '┬', '┼',
]

export type StrokeStyle = 'solid' | 'dashed'

export class CharCanvas {
  readonly width: number
  readonly height: number
  private readonly chars: string[]
  /** Connection mask per cell, or -1 for a cell holding a non-line glyph. */
  private readonly masks: number[]
  private readonly styles: StrokeStyle[]

  constructor(width: number, height: number) {
    this.width = Math.max(0, Math.floor(width))
    this.height = Math.max(0, Math.floor(height))
    const size = this.width * this.height
    this.chars = new Array<string>(size).fill(' ')
    this.masks = new Array<number>(size).fill(0)
    this.styles = new Array<StrokeStyle>(size).fill('solid')
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Write a single glyph, clearing any line state the cell was carrying. */
  set(x: number, y: number, char: string): void {
    if (!this.inBounds(x, y) || char.length === 0) {
      return
    }
    const index = y * this.width + x
    this.chars[index] = char
    this.masks[index] = -1
  }

  /** Write text left to right, clipped at the canvas edge. */
  text(x: number, y: number, value: string): void {
    for (let offset = 0; offset < value.length; offset += 1) {
      this.set(x + offset, y, value[offset]!)
    }
  }

  /**
   * Reset a cell to empty, including its line state. Unlike writing a space
   * with `set`, this leaves the cell open for later line drawing — needed
   * where a box is punched over content it must cover, such as a note sitting
   * across lifelines.
   */
  clear(x: number, y: number): void {
    if (!this.inBounds(x, y)) {
      return
    }
    const index = y * this.width + x
    this.chars[index] = ' '
    this.masks[index] = 0
    this.styles[index] = 'solid'
  }

  /** True when every cell of a horizontal run is still empty. */
  isBlank(x: number, y: number, length: number): boolean {
    for (let offset = 0; offset < length; offset += 1) {
      const cx = x + offset
      if (!this.inBounds(cx, y)) {
        return false
      }
      if (this.chars[y * this.width + cx] !== ' ') {
        return false
      }
    }
    return true
  }

  /**
   * Write text at the first candidate position that is entirely free. Labels
   * are placed after the edges they belong to, so writing unconditionally
   * would punch holes in the lines already drawn.
   */
  textAtFirstFree(candidates: ReadonlyArray<{ x: number; y: number }>, value: string): boolean {
    for (const candidate of candidates) {
      if (this.isBlank(candidate.x, candidate.y, value.length)) {
        this.text(candidate.x, candidate.y, value)
        return true
      }
    }
    return false
  }

  /**
   * Add line connections to a cell, merging with whatever is already there.
   * Cells holding text are left alone: a label must stay readable even when an
   * edge is routed across it.
   */
  connect(x: number, y: number, mask: number, style: StrokeStyle = 'solid'): void {
    if (!this.inBounds(x, y)) {
      return
    }
    const index = y * this.width + x
    const existing = this.masks[index]!
    if (existing < 0) {
      return
    }
    const merged = existing | mask
    this.masks[index] = merged
    // A dashed stroke crossing a solid one keeps the solid look; mixing the two
    // in one glyph reads as a rendering fault rather than two distinct edges.
    const nextStyle: StrokeStyle = existing === 0 ? style : this.styles[index] === 'solid' ? 'solid' : style
    this.styles[index] = nextStyle
    this.chars[index] = (nextStyle === 'dashed' ? DASHED_BY_MASK : SOLID_BY_MASK)[merged]!
  }

  /** Horizontal run between two inclusive x positions on the same row. */
  horizontal(x1: number, x2: number, y: number, style: StrokeStyle = 'solid'): void {
    const from = Math.min(x1, x2)
    const to = Math.max(x1, x2)
    for (let x = from; x <= to; x += 1) {
      let mask = 0
      if (x > from) mask |= DIR_LEFT
      if (x < to) mask |= DIR_RIGHT
      // A single-cell run still needs to read as a horizontal stroke.
      if (from === to) mask = DIR_LEFT | DIR_RIGHT
      this.connect(x, y, mask, style)
    }
  }

  /** Vertical run between two inclusive y positions in the same column. */
  vertical(x: number, y1: number, y2: number, style: StrokeStyle = 'solid'): void {
    const from = Math.min(y1, y2)
    const to = Math.max(y1, y2)
    for (let y = from; y <= to; y += 1) {
      let mask = 0
      if (y > from) mask |= DIR_UP
      if (y < to) mask |= DIR_DOWN
      if (from === to) mask = DIR_UP | DIR_DOWN
      this.connect(x, y, mask, style)
    }
  }

  /** Outline of a rectangle, corners included. */
  rectangle(x: number, y: number, width: number, height: number, style: StrokeStyle = 'solid'): void {
    if (width < 2 || height < 2) {
      return
    }
    const right = x + width - 1
    const bottom = y + height - 1
    this.horizontal(x, right, y, style)
    this.horizontal(x, right, bottom, style)
    this.vertical(x, y, bottom, style)
    this.vertical(right, y, bottom, style)
  }

  toLines(): string[] {
    const lines: string[] = []
    for (let y = 0; y < this.height; y += 1) {
      const start = y * this.width
      lines.push(this.chars.slice(start, start + this.width).join('').replace(/\s+$/u, ''))
    }
    return lines
  }

  /** Rendered lines with fully blank leading and trailing rows removed. */
  toTrimmedLines(): string[] {
    const lines = this.toLines()
    let first = 0
    let last = lines.length - 1
    while (first <= last && lines[first]!.trim().length === 0) first += 1
    while (last >= first && lines[last]!.trim().length === 0) last -= 1
    return lines.slice(first, last + 1)
  }
}
