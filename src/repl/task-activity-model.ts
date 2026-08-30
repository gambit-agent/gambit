import type { TaskRecord, TaskStatus } from '../tasks/task-types'
import type { WorkflowSnapshot } from '../workflows/workflow-display'
import { isActiveTaskStatus } from './repl-format'

export const RECENT_TASK_LIMIT = 8

export interface TaskLists {
  activeTasks: TaskRecord[]
  recentTasks: TaskRecord[]
}

/**
 * Keeps only tasks that belong to the given session. Tasks without a session
 * tag are treated as irrelevant (created before sessions were tracked) and
 * hidden, so the activity drawer shows only the current conversation's work.
 */
export function filterTasksBySession(tasks: readonly TaskRecord[], sessionId: string): TaskRecord[] {
  return tasks.filter((task) => task.sessionId === sessionId)
}

/**
 * Single source of truth for the active/recent split so the footer panel, the
 * drawer, and the drawer's selection index never disagree about row order.
 */
export function splitTaskLists(
  tasks: readonly TaskRecord[],
  recentLimit: number = RECENT_TASK_LIMIT,
): TaskLists {
  return {
    activeTasks: tasks.filter((task) => isActiveTaskStatus(task.status)),
    recentTasks: tasks.filter((task) => !isActiveTaskStatus(task.status)).slice(0, recentLimit),
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type ActivityFilter = 'all' | 'running' | 'done' | 'failed'

export const activityFilters: readonly ActivityFilter[] = ['all', 'running', 'done', 'failed']

export function cycleActivityFilter(current: ActivityFilter, delta: number): ActivityFilter {
  const index = activityFilters.indexOf(current)
  const next = (index + delta + activityFilters.length) % activityFilters.length
  return activityFilters[next]!
}

export function matchesActivityFilter(status: TaskStatus, filter: ActivityFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'running':
      return status === 'running' || status === 'pending'
    case 'done':
      return status === 'completed'
    case 'failed':
      return status === 'failed' || status === 'cancelled'
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type ActivityGroup = 'active' | 'recent'

export interface ActivityRow {
  task: TaskRecord
  group: ActivityGroup
}

function matchesQuery(task: TaskRecord, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return true
  }
  const haystack = [task.title, task.kind, task.status, task.progressSummary ?? '', task.error ?? '']
    .join(' ')
    .toLowerCase()
  return haystack.includes(trimmed)
}

/**
 * Flattens the active/recent task lists into the exact row order the drawer
 * renders, after applying the filter tab and the search query. The drawer and
 * the REPL selection state both derive from this so the highlighted index can
 * never point at a row that is filtered out.
 */
export function buildActivityRows(
  activeTasks: readonly TaskRecord[],
  recentTasks: readonly TaskRecord[],
  filter: ActivityFilter = 'all',
  query = '',
): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const task of activeTasks) {
    if (matchesActivityFilter(task.status, filter) && matchesQuery(task, query)) {
      rows.push({ task, group: 'active' })
    }
  }
  for (const task of recentTasks) {
    if (matchesActivityFilter(task.status, filter) && matchesQuery(task, query)) {
      rows.push({ task, group: 'recent' })
    }
  }
  return rows
}

export interface ActivityCounts {
  running: number
  pending: number
  done: number
  failed: number
  cancelled: number
}

export function countActivity(tasks: readonly TaskRecord[]): ActivityCounts {
  const counts: ActivityCounts = { running: 0, pending: 0, done: 0, failed: 0, cancelled: 0 }
  for (const task of tasks) {
    switch (task.status) {
      case 'running':
        counts.running += 1
        break
      case 'pending':
        counts.pending += 1
        break
      case 'completed':
        counts.done += 1
        break
      case 'failed':
        counts.failed += 1
        break
      case 'cancelled':
        counts.cancelled += 1
        break
    }
  }
  return counts
}

export function isCancellableTask(task: TaskRecord | null | undefined): boolean {
  return task?.status === 'running' || task?.status === 'pending'
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Fixed-width-ish elapsed label: `42s`, `1m04s`, `1h02m`. */
export function formatCompactDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m${String(totalSeconds % 60).padStart(2, '0')}s`
  }

  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

export function getTaskElapsedMs(task: TaskRecord, now: number): number | null {
  if (!task.startedAt) {
    return null
  }
  const started = new Date(task.startedAt).getTime()
  if (!Number.isFinite(started)) {
    return null
  }
  const finished = task.finishedAt ? new Date(task.finishedAt).getTime() : now
  if (!Number.isFinite(finished)) {
    return null
  }
  return Math.max(0, finished - started)
}

export function formatTaskElapsed(task: TaskRecord, now: number): string {
  if (task.status === 'pending') {
    return 'queued'
  }
  const elapsed = getTaskElapsedMs(task, now)
  return elapsed === null ? '--' : formatCompactDuration(elapsed)
}

// ---------------------------------------------------------------------------
// Status glyphs
// ---------------------------------------------------------------------------

export const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'] as const

export function getSpinnerFrame(tick: number): string {
  const index = ((tick % spinnerFrames.length) + spinnerFrames.length) % spinnerFrames.length
  return spinnerFrames[index]!
}

/**
 * A running task animates so it never looks identical to a stalled one; every
 * terminal state gets its own shape so status survives a monochrome terminal.
 */
export function getStatusGlyph(status: TaskStatus, tick = 0): string {
  switch (status) {
    case 'running':
      return getSpinnerFrame(tick)
    case 'pending':
      return '○'
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    case 'cancelled':
      return '⊘'
  }
}

// ---------------------------------------------------------------------------
// Progress bars
// ---------------------------------------------------------------------------

export interface ProgressBar {
  filled: string
  track: string
}

export function renderProgressBar(done: number, total: number, width: number): ProgressBar {
  const safeWidth = Math.max(0, Math.floor(width))
  if (safeWidth === 0) {
    return { filled: '', track: '' }
  }
  if (total <= 0) {
    return { filled: '', track: '█'.repeat(safeWidth) }
  }

  const ratio = Math.min(1, Math.max(0, done / total))
  let filledWidth = Math.round(ratio * safeWidth)
  // Never let real progress render as an empty bar, or a partial one as full.
  if (filledWidth === 0 && done > 0) {
    filledWidth = 1
  }
  if (filledWidth === safeWidth && done < total) {
    filledWidth = safeWidth - 1
  }

  return { filled: '█'.repeat(filledWidth), track: '█'.repeat(safeWidth - filledWidth) }
}

// ---------------------------------------------------------------------------
// Workflow metadata
// ---------------------------------------------------------------------------

export function getWorkflowSnapshot(task: TaskRecord): WorkflowSnapshot | null {
  const value = task.metadata?.workflowSnapshot
  if (!value || typeof value !== 'object') {
    return null
  }

  const snapshot = value as Partial<WorkflowSnapshot>
  if (typeof snapshot.name !== 'string' || !Array.isArray(snapshot.agents)) {
    return null
  }

  return snapshot as WorkflowSnapshot
}

export interface WorkflowPhaseSummary {
  phase: string
  total: number
  done: number
  running: number
  errors: number
  skipped: number
  complete: boolean
}

export function summarizeWorkflowPhases(snapshot: WorkflowSnapshot): WorkflowPhaseSummary[] {
  const phases = [
    ...new Set([
      ...snapshot.phases,
      ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
      ...snapshot.agents.map((agent) => agent.phase).filter((phase): phase is string => Boolean(phase)),
    ]),
  ]

  return phases.map((phase) => {
    const agents = snapshot.agents.filter((agent) => agent.phase === phase)
    const done = agents.filter((agent) => agent.status === 'done').length
    const running = agents.filter((agent) => agent.status === 'running').length
    const errors = agents.filter((agent) => agent.status === 'error').length
    const skipped = agents.filter((agent) => agent.status === 'skipped').length
    return {
      phase,
      total: agents.length,
      done,
      running,
      errors,
      skipped,
      complete: agents.length > 0 && done + errors + skipped === agents.length,
    }
  })
}

// ---------------------------------------------------------------------------
// Transcript lines
// ---------------------------------------------------------------------------

export type TranscriptLineKind =
  | 'call'
  | 'result'
  | 'error'
  | 'reasoning'
  | 'assistant'
  | 'prompt'
  | 'event'

export interface TranscriptLine {
  kind: TranscriptLineKind
  /** Short left-column label — a tool name, or the speaker for non-tool lines. */
  label: string
  detail: string
}

export const transcriptGlyphs: Record<TranscriptLineKind, string> = {
  call: '→',
  result: '←',
  error: '✗',
  reasoning: '~',
  assistant: '▸',
  prompt: '›',
  event: '·',
}

function toDetail(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Turns a raw transcript JSONL entry into a typed line. The drawer renders the
 * kind as a coloured glyph in a gutter instead of the old prose prefixes
 * (`tool start Read: …`), so the tool name lands in its own column.
 */
export function parseTranscriptEntry(entry: Record<string, unknown>): TranscriptLine | null {
  const type = typeof entry.type === 'string' ? entry.type : 'event'
  const toolName = typeof entry.toolName === 'string' ? entry.toolName : 'unknown'

  switch (type) {
    case 'tool-call':
      return { kind: 'call', label: toolName, detail: toDetail(entry.input) }
    case 'tool-result':
      return { kind: 'result', label: toolName, detail: toDetail(entry.output) }
    case 'tool-error':
      return { kind: 'error', label: toolName, detail: toDetail(entry.error) }
    case 'reasoning':
      return { kind: 'reasoning', label: 'think', detail: toDetail(entry.content) }
    case 'assistant':
      return { kind: 'assistant', label: 'say', detail: toDetail(entry.content) }
    case 'user':
      return { kind: 'prompt', label: 'you', detail: toDetail(entry.content) }
    case 'system':
      return null
    default:
      return { kind: 'event', label: type, detail: toDetail(entry) }
  }
}
