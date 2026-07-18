/**
 * Pure decision helpers for bare up/down arrow handling in the composer.
 *
 * Rules:
 * - Up-arrow on an empty composer pops the newest queued follow-up (if any),
 *   otherwise it recalls history.
 * - With content in the composer, up/down only navigate history when the
 *   cursor sits on the first/last line; otherwise the key falls through to
 *   the textarea so multi-line drafts stay editable.
 * - Down-arrow re-enqueues a popped follow-up (tracked by provenance) instead
 *   of navigating history, so a popped follow-up is never lost.
 */

export interface ComposerCursor {
  /** Zero-based row of the cursor within the composer. */
  row: number
  /** Total number of logical lines in the composer. */
  lineCount: number
}

export type UpArrowAction = 'pop-follow-up' | 'history-previous' | 'none'

export type DownArrowAction = 're-enqueue-popped' | 'history-next' | 'none'

export function isCursorOnFirstLine(cursor: ComposerCursor | null): boolean {
  return cursor === null || cursor.row <= 0
}

export function isCursorOnLastLine(cursor: ComposerCursor | null): boolean {
  return cursor === null || cursor.row >= cursor.lineCount - 1
}

export function resolveUpArrowAction({
  composerValue,
  followUpQueueLength,
  cursor,
}: {
  composerValue: string
  followUpQueueLength: number
  cursor: ComposerCursor | null
}): UpArrowAction {
  if (!composerValue.trim()) {
    return followUpQueueLength > 0 ? 'pop-follow-up' : 'history-previous'
  }
  return isCursorOnFirstLine(cursor) ? 'history-previous' : 'none'
}

export function resolveDownArrowAction({
  composerValue,
  poppedFollowUp,
  cursor,
}: {
  composerValue: string
  poppedFollowUp: string | null
  cursor: ComposerCursor | null
}): DownArrowAction {
  if (composerValue.trim() && !isCursorOnLastLine(cursor)) {
    return 'none'
  }
  if (poppedFollowUp !== null) {
    return 're-enqueue-popped'
  }
  return 'history-next'
}
