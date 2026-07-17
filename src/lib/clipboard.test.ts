import { expect, test } from 'bun:test'

import { copyTextWithRendererClipboard, getClipboardCommandCandidates } from './clipboard'

type TestRenderer = Parameters<typeof copyTextWithRendererClipboard>[0]

function createRenderer({
  osc52Supported,
  osc52Result = true,
}: {
  osc52Supported: boolean
  osc52Result?: boolean
}) {
  const calls = {
    osc52: [] as string[],
    fallback: [] as string[],
    notifications: [] as Array<{ message: string; title?: string }>,
  }

  const renderer: TestRenderer = {
    isOsc52Supported: () => osc52Supported,
    copyToClipboardOSC52: (text: string) => {
      calls.osc52.push(text)
      return osc52Result
    },
    triggerNotification: (message: string, title?: string) => {
      calls.notifications.push({ message, title })
      return true
    },
  }

  return { calls, renderer }
}

test('returns Windows clipboard command candidates', () => {
  expect(getClipboardCommandCandidates('win32')).toEqual([
    ['powershell', '-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
    ['cmd', '/c', 'clip'],
  ])
})

test('returns macOS clipboard command candidates', () => {
  expect(getClipboardCommandCandidates('darwin')).toEqual([['pbcopy']])
})

test('returns Linux clipboard command candidates', () => {
  expect(getClipboardCommandCandidates('linux')).toEqual([
    ['wl-copy'],
    ['xclip', '-selection', 'clipboard'],
    ['xsel', '--clipboard', '--input'],
  ])
})

test('copies text with OSC 52 and triggers a notification', async () => {
  const { calls, renderer } = createRenderer({ osc52Supported: true })
  const copied = await copyTextWithRendererClipboard(renderer, '  hello  ', async (text) => {
    calls.fallback.push(text)
  })

  expect(copied).toBe(true)
  expect(calls.osc52).toEqual(['  hello  '])
  expect(calls.fallback).toEqual([])
  expect(calls.notifications).toEqual([
    { message: 'Copied text to clipboard', title: 'Gambit' },
  ])
})

test('falls back to the platform clipboard when OSC 52 is unavailable', async () => {
  const { calls, renderer } = createRenderer({ osc52Supported: false })
  const copied = await copyTextWithRendererClipboard(renderer, 'fallback text', async (text) => {
    calls.fallback.push(text)
  })

  expect(copied).toBe(true)
  expect(calls.osc52).toEqual([])
  expect(calls.fallback).toEqual(['fallback text'])
  expect(calls.notifications).toEqual([
    { message: 'Copied text to clipboard', title: 'Gambit' },
  ])
})

test('falls back when OSC 52 reports that the copy failed', async () => {
  const { calls, renderer } = createRenderer({ osc52Supported: true, osc52Result: false })
  const copied = await copyTextWithRendererClipboard(renderer, '  fallback after osc\n', async (text) => {
    calls.fallback.push(text)
  })

  expect(copied).toBe(true)
  expect(calls.osc52).toEqual(['  fallback after osc\n'])
  expect(calls.fallback).toEqual(['  fallback after osc\n'])
  expect(calls.notifications).toEqual([
    { message: 'Copied text to clipboard', title: 'Gambit' },
  ])
})

test('ignores blank clipboard text', async () => {
  const { calls, renderer } = createRenderer({ osc52Supported: true })
  const copied = await copyTextWithRendererClipboard(renderer, '   ', async (text) => {
    calls.fallback.push(text)
  })

  expect(copied).toBe(false)
  expect(calls.osc52).toEqual([])
  expect(calls.fallback).toEqual([])
  expect(calls.notifications).toEqual([])
})
