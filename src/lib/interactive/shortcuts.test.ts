import { describe, expect, test } from 'bun:test'
import type { ParsedKey } from '@opentui/core'

import { matchShortcut } from './shortcuts'

function key(partial: Partial<ParsedKey> & { name: string }): ParsedKey {
  return {
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: '',
    number: false,
    raw: '',
    eventType: 'press',
    source: 'raw',
    ...partial,
  } as ParsedKey
}

describe('history keys', () => {
  test('Ctrl+P and Ctrl+N mirror the bare arrows', () => {
    expect(matchShortcut(key({ name: 'p', ctrl: true }))?.action).toBe('history-previous')
    expect(matchShortcut(key({ name: 'n', ctrl: true }))?.action).toBe('history-next')
    expect(matchShortcut(key({ name: 'up' }))?.action).toBe('history-previous')
    expect(matchShortcut(key({ name: 'down' }))?.action).toBe('history-next')
  })

  test('plain p and n stay ordinary characters', () => {
    expect(matchShortcut(key({ name: 'p' }))).toBeNull()
    expect(matchShortcut(key({ name: 'n' }))).toBeNull()
  })
})

describe('permission mode', () => {
  test('Shift+Tab and its Alt+M fallback both cycle', () => {
    expect(matchShortcut(key({ name: 'tab', shift: true }))?.action).toBe('cycle-permission')
    expect(matchShortcut(key({ name: 'm', meta: true }))?.action).toBe('cycle-permission')
    expect(matchShortcut(key({ name: 'm', option: true }))?.action).toBe('cycle-permission')
  })

  test('bare Tab is left to thinking and completions', () => {
    expect(matchShortcut(key({ name: 'tab' }))?.action).toBe('toggle-thinking')
    expect(matchShortcut(key({ name: 'm' }))).toBeNull()
  })
})

describe('image paste', () => {
  test('Ctrl+V, Alt+V, and Cmd+V all request a clipboard image', () => {
    expect(matchShortcut(key({ name: 'v', ctrl: true }))?.action).toBe('paste-image')
    expect(matchShortcut(key({ name: 'v', option: true }))?.action).toBe('paste-image')
    expect(matchShortcut(key({ name: 'v', meta: true }))?.action).toBe('paste-image')
  })

  test('a typed v is not a shortcut', () => {
    expect(matchShortcut(key({ name: 'v' }))).toBeNull()
  })
})

test('key releases never trigger a shortcut', () => {
  expect(matchShortcut(key({ name: 'c', ctrl: true, eventType: 'release' }))).toBeNull()
})
