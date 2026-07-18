import path from 'node:path'

import { generateId } from './id'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface ImageAttachment {
  id: string
  name: string
  mediaType: string
  data: string
  size: number
}

const extensionMediaTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const mediaTypeExtensions: Record<string, string> = {
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

export function detectImageMediaType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'image/gif'
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 &&
    bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66
  ) {
    return 'image/avif'
  }
  return null
}

export function imageMediaTypeFromPath(filePath: string): string | null {
  return extensionMediaTypes[path.extname(filePath).toLowerCase()] ?? null
}

export function createImageAttachment(
  bytes: Uint8Array,
  options: { name?: string; mediaType?: string } = {},
): ImageAttachment {
  if (bytes.byteLength === 0) {
    throw new Error('The image is empty.')
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Images must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`)
  }

  const detectedMediaType = detectImageMediaType(bytes)
  if (!detectedMediaType) {
    throw new Error('Unsupported image format. Use PNG, JPEG, GIF, WebP, or AVIF.')
  }
  const declaredMediaType = options.mediaType?.toLowerCase().split(';', 1)[0]?.trim()
  const mediaType = declaredMediaType === detectedMediaType ? declaredMediaType : detectedMediaType

  const extension = mediaTypeExtensions[mediaType] ?? ''
  const name = path.basename(options.name?.trim() || `pasted-image-${Date.now()}${extension}`)

  return {
    id: generateId(),
    name,
    mediaType,
    data: Buffer.from(bytes).toString('base64'),
    size: bytes.byteLength,
  }
}

export async function loadImageAttachment(filePath: string): Promise<ImageAttachment> {
  const resolvedPath = path.resolve(filePath)
  const file = Bun.file(resolvedPath)
  if (!(await file.exists())) {
    throw new Error(`Image not found: ${filePath}`)
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Images must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller: ${filePath}`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return createImageAttachment(bytes, {
    name: path.basename(resolvedPath),
    mediaType: imageMediaTypeFromPath(resolvedPath) ?? undefined,
  })
}

/** Resolve an exact pasted/dragged image path without treating general text as a file. */
export function normalizePastedImagePath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return null
  }

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed
  if (/^file:\/\//i.test(unquoted)) {
    try {
      return decodeURIComponent(new URL(unquoted).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'))
    } catch {
      return null
    }
  }
  return imageMediaTypeFromPath(unquoted) ? unquoted : null
}
