import { expect, test } from 'bun:test'

import { getClipboardCommandCandidates } from './clipboard'

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
