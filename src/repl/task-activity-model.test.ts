import { expect, test } from 'bun:test'

import type { TaskRecord, TaskStatus } from '../tasks/task-types'
import type { WorkflowSnapshot } from '../workflows/workflow-display'
import {
  buildActivityRows,
  countActivity,
  cycleActivityFilter,
  formatCompactDuration,
  formatTaskElapsed,
  getStatusGlyph,
  getTaskElapsedMs,
  getWorkflowSnapshot,
  isCancellableTask,
  matchesActivityFilter,
  parseTranscriptEntry,
  renderProgressBar,
  spinnerFrames,
  splitTaskLists,
  summarizeWorkflowPhases,
} from './task-activity-model'

function createTask(overrides: Partial<TaskRecord> & { id: string; status: TaskStatus }): TaskRecord {
  return {
    kind: 'agent',
    title: `task ${overrides.id}`,
    background: true,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Filters and rows
// ---------------------------------------------------------------------------

test('cycleActivityFilter wraps in both directions', () => {
  expect(cycleActivityFilter('all', 1)).toBe('running')
  expect(cycleActivityFilter('failed', 1)).toBe('all')
  expect(cycleActivityFilter('all', -1)).toBe('failed')
})

test('matchesActivityFilter groups pending with running and cancelled with failed', () => {
  expect(matchesActivityFilter('pending', 'running')).toBe(true)
  expect(matchesActivityFilter('running', 'running')).toBe(true)
  expect(matchesActivityFilter('completed', 'running')).toBe(false)
  expect(matchesActivityFilter('cancelled', 'failed')).toBe(true)
  expect(matchesActivityFilter('failed', 'failed')).toBe(true)
  expect(matchesActivityFilter('completed', 'done')).toBe(true)
  expect(matchesActivityFilter('cancelled', 'all')).toBe(true)
})

test('buildActivityRows keeps active rows ahead of recent rows', () => {
  const active = [createTask({ id: 'a', status: 'running' }), createTask({ id: 'b', status: 'pending' })]
  const recent = [createTask({ id: 'c', status: 'completed' })]

  const rows = buildActivityRows(active, recent)
  expect(rows.map((row) => row.task.id)).toEqual(['a', 'b', 'c'])
  expect(rows.map((row) => row.group)).toEqual(['active', 'active', 'recent'])
})

test('buildActivityRows applies the filter tab', () => {
  const active = [createTask({ id: 'a', status: 'running' })]
  const recent = [
    createTask({ id: 'b', status: 'completed' }),
    createTask({ id: 'c', status: 'failed' }),
  ]

  expect(buildActivityRows(active, recent, 'running').map((row) => row.task.id)).toEqual(['a'])
  expect(buildActivityRows(active, recent, 'done').map((row) => row.task.id)).toEqual(['b'])
  expect(buildActivityRows(active, recent, 'failed').map((row) => row.task.id)).toEqual(['c'])
})

test('buildActivityRows searches title, kind, status, summary, and error', () => {
  const recent = [
    createTask({ id: 'a', status: 'completed', title: 'rewrite INSTALL.md' }),
    createTask({ id: 'b', status: 'failed', title: 'bench', error: 'exit 1: assertion failed' }),
    createTask({ id: 'c', status: 'completed', kind: 'shell', title: 'tsc' }),
    createTask({ id: 'd', status: 'completed', title: 'docs', progressSummary: 'wrote 3 pages' }),
  ]

  expect(buildActivityRows([], recent, 'all', 'install').map((row) => row.task.id)).toEqual(['a'])
  expect(buildActivityRows([], recent, 'all', 'assertion').map((row) => row.task.id)).toEqual(['b'])
  expect(buildActivityRows([], recent, 'all', 'shell').map((row) => row.task.id)).toEqual(['c'])
  expect(buildActivityRows([], recent, 'all', 'pages').map((row) => row.task.id)).toEqual(['d'])
  expect(buildActivityRows([], recent, 'all', '   ').map((row) => row.task.id)).toEqual(['a', 'b', 'c', 'd'])
})

test('buildActivityRows combines filter and search', () => {
  const active = [createTask({ id: 'a', status: 'running', title: 'auth refactor' })]
  const recent = [createTask({ id: 'b', status: 'completed', title: 'auth docs' })]

  expect(buildActivityRows(active, recent, 'running', 'auth').map((row) => row.task.id)).toEqual(['a'])
  expect(buildActivityRows(active, recent, 'done', 'auth').map((row) => row.task.id)).toEqual(['b'])
  expect(buildActivityRows(active, recent, 'done', 'nope')).toEqual([])
})

test('splitTaskLists separates active from recent and caps the recent list', () => {
  const tasks = [
    createTask({ id: 'r1', status: 'running' }),
    createTask({ id: 'p1', status: 'pending' }),
    ...Array.from({ length: 12 }, (_, index) =>
      createTask({ id: `d${index}`, status: 'completed' }),
    ),
  ]

  const { activeTasks, recentTasks } = splitTaskLists(tasks)
  expect(activeTasks.map((task) => task.id)).toEqual(['r1', 'p1'])
  expect(recentTasks.length).toBe(8)
  expect(recentTasks[0]?.id).toBe('d0')
})

test('countActivity tallies every status bucket', () => {
  const counts = countActivity([
    createTask({ id: 'a', status: 'running' }),
    createTask({ id: 'b', status: 'running' }),
    createTask({ id: 'c', status: 'pending' }),
    createTask({ id: 'd', status: 'completed' }),
    createTask({ id: 'e', status: 'failed' }),
    createTask({ id: 'f', status: 'cancelled' }),
  ])

  expect(counts).toEqual({ running: 2, pending: 1, done: 1, failed: 1, cancelled: 1 })
})

test('isCancellableTask only accepts in-flight tasks', () => {
  expect(isCancellableTask(createTask({ id: 'a', status: 'running' }))).toBe(true)
  expect(isCancellableTask(createTask({ id: 'b', status: 'pending' }))).toBe(true)
  expect(isCancellableTask(createTask({ id: 'c', status: 'completed' }))).toBe(false)
  expect(isCancellableTask(null)).toBe(false)
  expect(isCancellableTask(undefined)).toBe(false)
})

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

test('formatCompactDuration stays narrow across magnitudes', () => {
  expect(formatCompactDuration(0)).toBe('0s')
  expect(formatCompactDuration(8_400)).toBe('8s')
  expect(formatCompactDuration(59_999)).toBe('59s')
  expect(formatCompactDuration(64_000)).toBe('1m04s')
  expect(formatCompactDuration(3_600_000)).toBe('1h00m')
  expect(formatCompactDuration(3_720_000)).toBe('1h02m')
})

test('getTaskElapsedMs measures to finishedAt when the task is over', () => {
  const task = createTask({
    id: 'a',
    status: 'completed',
    startedAt: '2026-08-04T12:00:00.000Z',
    finishedAt: '2026-08-04T12:00:31.000Z',
  })
  const now = Date.parse('2026-08-04T13:00:00.000Z')
  expect(getTaskElapsedMs(task, now)).toBe(31_000)
})

test('getTaskElapsedMs measures to now while the task runs', () => {
  const task = createTask({ id: 'a', status: 'running', startedAt: '2026-08-04T12:00:00.000Z' })
  const now = Date.parse('2026-08-04T12:01:04.000Z')
  expect(getTaskElapsedMs(task, now)).toBe(64_000)
})

test('getTaskElapsedMs returns null without a usable start time', () => {
  expect(getTaskElapsedMs(createTask({ id: 'a', status: 'pending' }), Date.now())).toBeNull()
  expect(
    getTaskElapsedMs(createTask({ id: 'b', status: 'running', startedAt: 'not-a-date' }), Date.now()),
  ).toBeNull()
})

test('formatTaskElapsed labels pending tasks as queued', () => {
  expect(formatTaskElapsed(createTask({ id: 'a', status: 'pending' }), Date.now())).toBe('queued')
  expect(formatTaskElapsed(createTask({ id: 'b', status: 'completed' }), Date.now())).toBe('--')
  expect(
    formatTaskElapsed(
      createTask({ id: 'c', status: 'running', startedAt: '2026-08-04T12:00:00.000Z' }),
      Date.parse('2026-08-04T12:00:42.000Z'),
    ),
  ).toBe('42s')
})

// ---------------------------------------------------------------------------
// Glyphs and bars
// ---------------------------------------------------------------------------

test('getStatusGlyph animates running and gives every terminal state its own shape', () => {
  const frames: readonly string[] = spinnerFrames
  expect(getStatusGlyph('running', 0)).toBe(frames[0]!)
  expect(getStatusGlyph('running', 1)).toBe(frames[1]!)
  expect(getStatusGlyph('running', frames.length)).toBe(frames[0]!)
  expect(getStatusGlyph('running', -1)).toBe(frames[frames.length - 1]!)

  const terminal = (['pending', 'completed', 'failed', 'cancelled'] as const).map((status) =>
    getStatusGlyph(status),
  )
  expect(new Set(terminal).size).toBe(terminal.length)
})

test('renderProgressBar fills proportionally and keeps total width', () => {
  const half = renderProgressBar(5, 10, 10)
  expect(half.filled.length).toBe(5)
  expect(half.track.length).toBe(5)

  const complete = renderProgressBar(10, 10, 10)
  expect(complete.filled.length).toBe(10)
  expect(complete.track.length).toBe(0)
})

test('renderProgressBar never renders started work as empty or partial work as full', () => {
  expect(renderProgressBar(1, 100, 10).filled.length).toBe(1)
  expect(renderProgressBar(99, 100, 10).filled.length).toBe(9)
})

test('renderProgressBar handles degenerate inputs', () => {
  expect(renderProgressBar(0, 0, 0)).toEqual({ filled: '', track: '' })
  expect(renderProgressBar(3, 0, 4)).toEqual({ filled: '', track: '████' })
  expect(renderProgressBar(0, 10, 6)).toEqual({ filled: '', track: '██████' })
})

// ---------------------------------------------------------------------------
// Workflow metadata
// ---------------------------------------------------------------------------

function createSnapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    name: 'wf',
    phases: [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
    ...overrides,
  }
}

test('getWorkflowSnapshot rejects metadata that is not a snapshot', () => {
  expect(getWorkflowSnapshot(createTask({ id: 'a', status: 'running' }))).toBeNull()
  expect(
    getWorkflowSnapshot(createTask({ id: 'b', status: 'running', metadata: { workflowSnapshot: 'nope' } })),
  ).toBeNull()
  expect(
    getWorkflowSnapshot(
      createTask({ id: 'c', status: 'running', metadata: { workflowSnapshot: { name: 'wf' } } }),
    ),
  ).toBeNull()

  const snapshot = createSnapshot({ name: 'refactor' })
  expect(
    getWorkflowSnapshot(
      createTask({ id: 'd', status: 'running', metadata: { workflowSnapshot: snapshot } }),
    )?.name,
  ).toBe('refactor')
})

test('summarizeWorkflowPhases counts each phase and marks completion', () => {
  const snapshot = createSnapshot({
    phases: ['scan', 'rewrite'],
    currentPhase: 'rewrite',
    agents: [
      { id: 1, label: 'a', phase: 'scan', prompt: '', status: 'done' },
      { id: 2, label: 'b', phase: 'scan', prompt: '', status: 'done' },
      { id: 3, label: 'c', phase: 'rewrite', prompt: '', status: 'running' },
      { id: 4, label: 'd', phase: 'rewrite', prompt: '', status: 'error' },
      { id: 5, label: 'e', phase: 'rewrite', prompt: '', status: 'skipped' },
    ],
  })

  const [scan, rewrite] = summarizeWorkflowPhases(snapshot)
  expect(scan).toEqual({
    phase: 'scan',
    total: 2,
    done: 2,
    running: 0,
    errors: 0,
    skipped: 0,
    complete: true,
  })
  expect(rewrite?.running).toBe(1)
  expect(rewrite?.errors).toBe(1)
  expect(rewrite?.skipped).toBe(1)
  expect(rewrite?.complete).toBe(false)
})

test('summarizeWorkflowPhases includes phases only referenced by agents, without duplicates', () => {
  const snapshot = createSnapshot({
    phases: ['scan'],
    currentPhase: 'scan',
    agents: [{ id: 1, label: 'a', phase: 'verify', prompt: '', status: 'queued' }],
  })

  expect(summarizeWorkflowPhases(snapshot).map((phase) => phase.phase)).toEqual(['scan', 'verify'])
})

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

test('parseTranscriptEntry types each entry instead of prefixing prose', () => {
  expect(parseTranscriptEntry({ type: 'tool-call', toolName: 'read', input: { path: 'a.ts' } })).toEqual({
    kind: 'call',
    label: 'read',
    detail: '{"path":"a.ts"}',
  })
  expect(parseTranscriptEntry({ type: 'tool-result', toolName: 'read', output: '148 lines' })).toEqual({
    kind: 'result',
    label: 'read',
    detail: '148 lines',
  })
  expect(parseTranscriptEntry({ type: 'tool-error', toolName: 'bash', error: 'exit 1' })).toEqual({
    kind: 'error',
    label: 'bash',
    detail: 'exit 1',
  })
  expect(parseTranscriptEntry({ type: 'reasoning', content: 'thinking' })?.kind).toBe('reasoning')
  expect(parseTranscriptEntry({ type: 'assistant', content: 'done' })?.kind).toBe('assistant')
  expect(parseTranscriptEntry({ type: 'user', content: 'go' })?.kind).toBe('prompt')
})

test('parseTranscriptEntry drops system entries and falls back for unknown types', () => {
  expect(parseTranscriptEntry({ type: 'system', content: 'boot' })).toBeNull()

  const unknown = parseTranscriptEntry({ type: 'heartbeat', at: 3 })
  expect(unknown?.kind).toBe('event')
  expect(unknown?.label).toBe('heartbeat')
})

test('parseTranscriptEntry names the tool unknown when the entry omits it', () => {
  expect(parseTranscriptEntry({ type: 'tool-call', input: 'x' })?.label).toBe('unknown')
})
