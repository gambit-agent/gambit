import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createImageAttachment,
  detectImageMediaType,
  loadImageAttachment,
  normalizePastedImagePath,
} from './image-attachments'

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('detects and encodes pasted PNG data', () => {
  expect(detectImageMediaType(pngBytes)).toBe('image/png')
  expect(createImageAttachment(pngBytes, { name: 'shot.png' })).toMatchObject({
    name: 'shot.png',
    mediaType: 'image/png',
    data: Buffer.from(pngBytes).toString('base64'),
    size: pngBytes.byteLength,
  })
})

test('loads an image attachment from a file path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gambit-image-'))
  const imagePath = path.join(root, 'screen.png')
  try {
    await writeFile(imagePath, pngBytes)
    const attachment = await loadImageAttachment(imagePath)
    expect(attachment).toMatchObject({ name: 'screen.png', mediaType: 'image/png' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('normalizes quoted and file URL image paths only', () => {
  expect(normalizePastedImagePath('"./screen.png"')).toBe('./screen.png')
  expect(normalizePastedImagePath('notes.txt')).toBeNull()
  expect(normalizePastedImagePath('one.png\ntwo.png')).toBeNull()
})
