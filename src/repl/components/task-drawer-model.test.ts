import { expect, test } from 'bun:test'

import type { TaskRecord } from '../../tasks/task-types'
import {
  filterTaskGroups,
  getTaskDrawerCounts,
  getTaskProgress,
  makeProgressBar,
  nextTaskDrawerFilter,
} from './task-drawer-model'

function task(id: string, status: TaskRecord['status'], progressSummary?: string): TaskRecord {
  return {
    id,
    kind: 'shell',
    title: id,
    status,
    background: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    progressSummary,
  }
}

test('filters active and recent task groups without changing display order', () => {
  const active = [task('running', 'running'), task('queued', 'pending')]
  const recent = [task('complete', 'completed'), task('failed', 'failed'), task('cancelled', 'cancelled')]

  expect(filterTaskGroups(active, recent, 'running').tasks.map((entry) => entry.id)).toEqual(['running'])
  expect(filterTaskGroups(active, recent, 'queued').tasks.map((entry) => entry.id)).toEqual(['queued'])
  expect(filterTaskGroups(active, recent, 'done').tasks.map((entry) => entry.id)).toEqual([
    'complete',
    'failed',
    'cancelled',
  ])
  expect(filterTaskGroups(active, recent, 'all').tasks.map((entry) => entry.id)).toEqual([
    'running',
    'queued',
    'complete',
    'failed',
    'cancelled',
  ])
})

test('summarizes filter counts including failed finished tasks', () => {
  const counts = getTaskDrawerCounts([
    task('running', 'running'),
    task('queued', 'pending'),
    task('complete', 'completed'),
    task('failed', 'failed'),
    task('cancelled', 'cancelled'),
  ])

  expect(counts).toEqual({
    total: 5,
    running: 1,
    queued: 1,
    done: 3,
    failed: 1,
  })
})

test('extracts progress from task summaries and renders a stable terminal bar', () => {
  const progress = getTaskProgress(task('tests', 'running', '184 / 260 tests'))
  expect(progress).toEqual({ completed: 184, total: 260 })
  expect(makeProgressBar(progress!, 10)).toBe('███████░░░')
})

test('cycles filters in the order shown in the drawer', () => {
  expect(nextTaskDrawerFilter('all')).toBe('running')
  expect(nextTaskDrawerFilter('running')).toBe('queued')
  expect(nextTaskDrawerFilter('queued')).toBe('done')
  expect(nextTaskDrawerFilter('done')).toBe('all')
})
