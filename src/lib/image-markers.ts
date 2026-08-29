import type { ImageAttachment } from './image-attachments'

/**
 * `[Image #N]` markers that stand for an attached image inside the composer
 * text, so a prompt can point at one image among several ("explain the error
 * in [Image #2]") instead of leaving the model to guess the order.
 *
 * The marker is the attachment's handle: delete it and the attachment goes
 * with it, the same rule collapsed pasted text follows.
 */

const IMAGE_MARKER_PATTERN = /\[Image #(\d+)\]/g

export function formatImageMarker(index: number): string {
  return `[Image #${index}]`
}

/** The numbers of every marker still present, in the order they appear. */
export function findImageMarkers(value: string): number[] {
  return [...value.matchAll(IMAGE_MARKER_PATTERN)].map((match) => Number(match[1]))
}

/**
 * The next free marker number for this draft. Reuses gaps left by deleted
 * markers so a long session does not drift up to `[Image #47]`.
 */
export function nextImageMarkerIndex(value: string): number {
  const used = new Set(findImageMarkers(value))
  let index = 1
  while (used.has(index)) {
    index += 1
  }
  return index
}

export interface MarkerInsertion {
  value: string
  cursorOffset: number
  marker: string
}

/**
 * Inserts a marker at the cursor, padded with single spaces so it never fuses
 * onto neighbouring words.
 */
export function insertImageMarker(value: string, cursorOffset: number): MarkerInsertion {
  const at = Math.min(Math.max(cursorOffset, 0), value.length)
  const marker = formatImageMarker(nextImageMarkerIndex(value))
  const before = value.slice(0, at)
  const after = value.slice(at)
  const leading = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trailing = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const inserted = `${leading}${marker}${trailing}`

  return {
    value: `${before}${inserted}${after}`,
    cursorOffset: at + leading.length + marker.length,
    marker,
  }
}

/**
 * Drops attachments whose marker the user has since deleted. Attachments
 * without a marker (attached before markers existed, or by a path paste that
 * did not reach the composer) are always kept.
 */
export function syncImageAttachments(
  value: string,
  attachments: ImageAttachment[],
): ImageAttachment[] {
  const kept = attachments.filter((attachment) => !attachment.marker || value.includes(attachment.marker))
  return kept.length === attachments.length ? attachments : kept
}
