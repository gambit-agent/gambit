import { expect, test } from 'bun:test'

import type { TaskRecord } from '../tasks/task-types'
import {
  cycleTaskDrawerFilter,
  filterTaskDrawerTasks,
  isTaskCancellable,
  resolveTaskDrawerAction,
} from './task-drawer-model'

function task(id: string, status: TaskRecord['status']): TaskRecord {
  return {
    id,
    kind: 'shell',
    title: id,
    status,
    background: true,
    createdAt: '2026-08-04T12:00:00.000Z',
  }
}

test('filterTaskDrawerTasks preserves active-first ordering for all tasks', () => {
  const active = [task('running', 'running'), task('queued', 'pending')]
  const recent = [task('done', 'completed'), task('failed', 'failed')]

  expect(filterTaskDrawerTasks(active, recent, 'all').map((item) => item.id)).toEqual([
    'running',
    'queued',
    'done',
    'failed',
  ])
  expect(filterTaskDrawerTasks(active, recent, 'active').map((item) => item.id)).toEqual([
    'running',
    'queued',
  ])
  expect(filterTaskDrawerTasks(active, recent, 'history').map((item) => item.id)).toEqual([
    'done',
    'failed',
  ])
})

test('cycleTaskDrawerFilter wraps in both directions', () => {
  expect(cycleTaskDrawerFilter('all')).toBe('active')
  expect(cycleTaskDrawerFilter('history')).toBe('all')
  expect(cycleTaskDrawerFilter('all', -1)).toBe('history')
})

test('only pending and running tasks can be cancelled', () => {
  expect(isTaskCancellable(task('pending', 'pending'))).toBe(true)
  expect(isTaskCancellable(task('running', 'running'))).toBe(true)
  expect(isTaskCancellable(task('done', 'completed'))).toBe(false)
  expect(isTaskCancellable(null)).toBe(false)
})

test('resolveTaskDrawerAction separates list navigation, detail scrolling, and commands', () => {
  const key = (name: string, modifiers: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; option: boolean }> = {}) => ({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    ...modifiers,
  })

  expect(resolveTaskDrawerAction(key('down'), 'list')).toBe('select-next')
  expect(resolveTaskDrawerAction(key('down'), 'detail')).toBeNull()
  expect(resolveTaskDrawerAction(key('tab'), 'list')).toBe('toggle-pane')
  expect(resolveTaskDrawerAction(key('o'), 'list')).toBe('show-output')
  expect(resolveTaskDrawerAction(key('c'), 'detail')).toBe('cancel-selected')
  expect(resolveTaskDrawerAction(key('c', { ctrl: true }), 'detail')).toBeNull()
  expect(resolveTaskDrawerAction(key('b', { ctrl: true }), 'detail')).toBe('close')
})
