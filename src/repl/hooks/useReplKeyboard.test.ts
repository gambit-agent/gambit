import { expect, test } from 'bun:test'
import type { ParsedKey } from '@opentui/core'

import {
  handleTaskDrawerKey,
  type TaskDrawerKeyboardController,
} from './useReplKeyboard'

function key(name: string, options: Partial<ParsedKey> = {}): ParsedKey {
  return {
    name,
    sequence: name,
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    eventType: 'press',
    repeated: false,
    ...options,
  } as ParsedKey
}

function controller(focus: TaskDrawerKeyboardController['focus'] = 'list') {
  const calls: string[] = []
  const drawer: TaskDrawerKeyboardController = {
    isOpen: true,
    focus,
    close: () => calls.push('close'),
    moveSelection: (delta) => calls.push(`move:${delta}`),
    selectFirst: () => calls.push('first'),
    selectLast: () => calls.push('last'),
    toggleFocus: () => calls.push('toggle-focus'),
    focusList: () => calls.push('focus-list'),
    focusDetail: () => calls.push('focus-detail'),
    cycleFilter: () => calls.push('cycle-filter'),
    showLive: () => calls.push('show-live'),
    showDetails: () => calls.push('show-details'),
    cancelSelected: async () => {
      calls.push('cancel')
    },
  }
  return { drawer, calls }
}

test('routes task drawer command keys to their controller actions', async () => {
  const { drawer, calls } = controller()

  expect(await handleTaskDrawerKey(key('f'), drawer)).toBe(true)
  expect(await handleTaskDrawerKey(key('tab'), drawer)).toBe(true)
  expect(await handleTaskDrawerKey(key('o'), drawer)).toBe(true)
  expect(await handleTaskDrawerKey(key('d'), drawer)).toBe(true)
  expect(await handleTaskDrawerKey(key('c'), drawer)).toBe(true)
  expect(await handleTaskDrawerKey(key('escape'), drawer)).toBe(true)

  expect(calls).toEqual([
    'cycle-filter',
    'toggle-focus',
    'show-live',
    'show-details',
    'cancel',
    'close',
  ])
})

test('moves task selection only while the list pane has focus', async () => {
  const list = controller('list')
  const detail = controller('detail')

  expect(await handleTaskDrawerKey(key('down'), list.drawer)).toBe(true)
  expect(await handleTaskDrawerKey(key('down'), detail.drawer)).toBe(false)
  expect(list.calls).toEqual(['move:1'])
  expect(detail.calls).toEqual([])
})
