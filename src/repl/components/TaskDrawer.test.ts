import { expect, test } from 'bun:test'

import type { TaskKind, TaskRecord, TaskStatus } from '../../tasks/task-types'
import {
  baseName,
  buildProgressBar,
  formatClock,
  formatRelativeTime,
  getKindBadge,
  getStatusGlyph,
  summarizeTasks,
} from './TaskDrawer'

function makeTask(status: TaskStatus, id = `task-${status}`): TaskRecord {
  return {
    id,
    kind: 'shell',
    title: id,
    status,
    background: true,
    createdAt: '2026-08-04T12:00:00Z',
  }
}

// getStatusGlyph ------------------------------------------------------------

test('getStatusGlyph maps each status to its glyph', () => {
  expect(getStatusGlyph('pending')).toBe('◌')
  expect(getStatusGlyph('completed')).toBe('✓')
  expect(getStatusGlyph('failed')).toBe('×')
  expect(getStatusGlyph('cancelled')).toBe('◦')
})

test('getStatusGlyph returns the spinner frame for running tasks when provided', () => {
  expect(getStatusGlyph('running', '⠇')).toBe('⠇')
})

test('getStatusGlyph falls back to a static glyph for running tasks without a frame', () => {
  expect(getStatusGlyph('running')).toBe('◉')
})

// getKindBadge ---------------------------------------------------------------

test('getKindBadge maps each task kind to a 2-char badge', () => {
  const badges: Record<TaskKind, string> = { workflow: 'wf', agent: 'ag', shell: 'sh' }
  for (const [kind, badge] of Object.entries(badges)) {
    expect(getKindBadge(kind as TaskKind)).toBe(badge)
    expect(badge).toHaveLength(2)
  }
})

// summarizeTasks -------------------------------------------------------------

test('summarizeTasks counts tasks by status', () => {
  const tasks = [
    makeTask('running', 'a'),
    makeTask('running', 'b'),
    makeTask('pending', 'c'),
    makeTask('failed', 'd'),
    makeTask('completed', 'e'),
    makeTask('completed', 'f'),
    makeTask('completed', 'g'),
  ]
  expect(summarizeTasks(tasks)).toEqual({ running: 2, pending: 1, failed: 1, completed: 3 })
})

test('summarizeTasks returns zero counts for an empty list', () => {
  expect(summarizeTasks([])).toEqual({ running: 0, pending: 0, failed: 0, completed: 0 })
})

test('summarizeTasks excludes cancelled tasks from the header counts', () => {
  expect(summarizeTasks([makeTask('cancelled')])).toEqual({ running: 0, pending: 0, failed: 0, completed: 0 })
})

// buildProgressBar -----------------------------------------------------------

test('buildProgressBar fills proportionally to done/total', () => {
  const bar = buildProgressBar(1, 4, 8)
  expect(bar.filled).toBe('██')
  expect(bar.empty).toBe('░░░░░░')
})

test('buildProgressBar clamps over-complete progress to a full bar', () => {
  const bar = buildProgressBar(7, 4, 6)
  expect(bar.filled).toBe('██████')
  expect(bar.empty).toBe('')
})

test('buildProgressBar renders an empty bar when total is zero', () => {
  const bar = buildProgressBar(0, 0, 5)
  expect(bar.filled).toBe('')
  expect(bar.empty).toBe('░░░░░')
})

test('buildProgressBar handles zero and negative widths', () => {
  expect(buildProgressBar(1, 2, 0)).toEqual({ filled: '', empty: '' })
  expect(buildProgressBar(1, 2, -3)).toEqual({ filled: '', empty: '' })
})

// formatClock ----------------------------------------------------------------

test('formatClock formats a local timestamp as HH:MM', () => {
  expect(formatClock('2026-08-04T09:05:13')).toBe('09:05')
})

test('formatClock returns null for missing or invalid timestamps', () => {
  expect(formatClock(undefined)).toBeNull()
  expect(formatClock('not-a-date')).toBeNull()
})

// formatRelativeTime ---------------------------------------------------------

test('formatRelativeTime renders seconds, minutes, hours, and days', () => {
  const now = Date.parse('2026-08-04T12:00:00Z')
  expect(formatRelativeTime('2026-08-04T11:59:30Z', now)).toBe('30s ago')
  expect(formatRelativeTime('2026-08-04T11:45:00Z', now)).toBe('15m ago')
  expect(formatRelativeTime('2026-08-04T09:00:00Z', now)).toBe('3h ago')
  expect(formatRelativeTime('2026-08-02T12:00:00Z', now)).toBe('2d ago')
})

test('formatRelativeTime clamps future timestamps to 0s ago', () => {
  const now = Date.parse('2026-08-04T12:00:00Z')
  expect(formatRelativeTime('2026-08-04T12:00:30Z', now)).toBe('0s ago')
})

test('formatRelativeTime returns null for missing or invalid timestamps', () => {
  expect(formatRelativeTime(undefined)).toBeNull()
  expect(formatRelativeTime('not-a-date')).toBeNull()
})

// baseName -------------------------------------------------------------------

test('baseName extracts the final path segment for posix and windows paths', () => {
  expect(baseName('/home/sergio/tasks/output.log')).toBe('output.log')
  expect(baseName('C:\\Users\\sergi\\tasks\\output.log')).toBe('output.log')
})

test('baseName returns bare names unchanged', () => {
  expect(baseName('output.log')).toBe('output.log')
})
