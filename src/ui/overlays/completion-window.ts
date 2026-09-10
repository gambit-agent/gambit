export interface CompletionWindow<T> {
  /** Items that should actually be rendered. */
  items: T[]
  /** Index into `results` of the first rendered item. */
  start: number
  /** Number of results hidden above the window. */
  hiddenAbove: number
  /** Number of results hidden below the window. */
  hiddenBelow: number
}

/**
 * Pick the slice of `results` to render so that `selectedIndex` is always
 * inside the rendered window. Keeps the selection visible when the list is
 * longer than the number of rows the overlay can display.
 */
export function getCompletionWindow<T>(
  results: readonly T[],
  selectedIndex: number,
  maxVisible: number,
): CompletionWindow<T> {
  const size = Math.max(1, Math.floor(maxVisible))
  const total = results.length
  if (total <= size) {
    return { items: [...results], start: 0, hiddenAbove: 0, hiddenBelow: 0 }
  }

  const clampedIndex = Math.min(Math.max(selectedIndex, 0), total - 1)
  // Keep the selection roughly centered once it moves past the first page.
  const preferredStart = clampedIndex - Math.floor(size / 2)
  const start = Math.min(Math.max(preferredStart, 0), total - size)
  const end = start + size

  return {
    items: results.slice(start, end),
    start,
    hiddenAbove: start,
    hiddenBelow: total - end,
  }
}
