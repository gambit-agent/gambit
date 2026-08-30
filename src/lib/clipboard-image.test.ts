import { describe, expect, test } from 'bun:test'

import {
  getClipboardImageCommandCandidates,
  readClipboardImage,
  readClipboardText,
} from './clipboard-image'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('getClipboardImageCommandCandidates', () => {
  test('offers a helper on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as NodeJS.Platform[]) {
      expect(getClipboardImageCommandCandidates(platform).length).toBeGreaterThan(0)
    }
  })

  test('falls back through the Wayland and X11 helpers on Linux', () => {
    const commands = getClipboardImageCommandCandidates('linux')

    expect(commands[0]?.[0]).toBe('wl-paste')
    expect(commands[1]?.[0]).toBe('xclip')
  })
})

describe('readClipboardImage', () => {
  test('returns the image with its detected media type', async () => {
    expect(await readClipboardImage('linux', async () => PNG)).toEqual({
      bytes: PNG,
      mediaType: 'image/png',
    })
  })

  test('returns null when the clipboard holds no image', async () => {
    expect(await readClipboardImage('linux', async () => null)).toBeNull()
  })

  test('returns null rather than throwing when no helper is installed', async () => {
    expect(
      await readClipboardImage('linux', async () => {
        throw new Error('wl-paste: command not found')
      }),
    ).toBeNull()
  })

  test('tries the next helper after one fails', async () => {
    const tried: string[] = []
    const image = await readClipboardImage('linux', async (command) => {
      tried.push(command[0]!)
      if (command[0] === 'wl-paste') {
        throw new Error('not on a Wayland session')
      }
      return PNG
    })

    expect(tried).toEqual(['wl-paste', 'xclip'])
    expect(image?.mediaType).toBe('image/png')
  })

  test('rejects clipboard bytes that are not a supported image', async () => {
    expect(await readClipboardImage('linux', async () => new TextEncoder().encode('plain text'))).toBeNull()
  })
})

describe('readClipboardText', () => {
  test('returns the clipboard text', async () => {
    const bytes = new TextEncoder().encode('some copied text')

    expect(await readClipboardText('linux', async () => bytes)).toBe('some copied text')
  })

  test('normalises CRLF and drops the newline Get-Clipboard appends', async () => {
    const bytes = new TextEncoder().encode('first\r\nsecond\r\n')

    expect(await readClipboardText('win32', async () => bytes)).toBe('first\nsecond')
  })

  test('returns null for an empty or whitespace-only read', async () => {
    expect(await readClipboardText('linux', async () => new Uint8Array())).toBeNull()
    expect(await readClipboardText('linux', async () => new TextEncoder().encode('\n'))).toBeNull()
  })

  test('returns null rather than throwing when no helper is installed', async () => {
    expect(
      await readClipboardText('linux', async () => {
        throw new Error('xclip: command not found')
      }),
    ).toBeNull()
  })
})
