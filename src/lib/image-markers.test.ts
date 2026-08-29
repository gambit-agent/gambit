import { describe, expect, test } from 'bun:test'

import type { ImageAttachment } from './image-attachments'
import {
  findImageMarkers,
  insertImageMarker,
  nextImageMarkerIndex,
  syncImageAttachments,
} from './image-markers'

function attachment(marker?: string): ImageAttachment {
  return { id: marker ?? 'bare', name: 'shot.png', mediaType: 'image/png', data: '', size: 1, marker }
}

describe('insertImageMarker', () => {
  test('inserts at the cursor and leaves the caret after the marker', () => {
    const result = insertImageMarker('look at this', 7)

    expect(result.value).toBe('look at [Image #1] this')
    expect(result.marker).toBe('[Image #1]')
    expect(result.value.slice(0, result.cursorOffset)).toBe('look at [Image #1]')
  })

  test('does not double up spacing that is already there', () => {
    expect(insertImageMarker('look at ', 8).value).toBe('look at [Image #1]')
    expect(insertImageMarker('', 0).value).toBe('[Image #1]')
  })

  test('numbers each new marker past the ones already in the draft', () => {
    const first = insertImageMarker('', 0)
    const second = insertImageMarker(first.value, first.cursorOffset)

    expect(second.marker).toBe('[Image #2]')
    expect(findImageMarkers(second.value)).toEqual([1, 2])
  })

  test('reuses the number of a marker the user deleted', () => {
    // #1 is gone, so the next image takes that slot rather than becoming #3.
    expect(nextImageMarkerIndex('[Image #2]')).toBe(1)
    expect(insertImageMarker('[Image #2]', 0).marker).toBe('[Image #1]')
  })

  test('clamps a cursor that sits outside the value', () => {
    expect(insertImageMarker('abc', 99).value).toBe('abc [Image #1]')
    expect(insertImageMarker('abc', -5).value).toBe('[Image #1] abc')
  })
})

describe('syncImageAttachments', () => {
  test('drops an attachment once its marker is deleted', () => {
    const kept = attachment('[Image #1]')
    const removed = attachment('[Image #2]')

    expect(syncImageAttachments('here is [Image #1]', [kept, removed])).toEqual([kept])
  })

  test('keeps attachments that never had a marker', () => {
    const bare = attachment()

    expect(syncImageAttachments('', [bare])).toEqual([bare])
  })

  test('returns the same array when nothing changed, so state does not churn', () => {
    const attachments = [attachment('[Image #1]')]

    expect(syncImageAttachments('[Image #1]', attachments)).toBe(attachments)
  })
})
