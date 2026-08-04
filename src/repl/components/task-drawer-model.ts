import type { TaskRecord, TaskStatus } from '../../tasks/task-types'
import type { WorkflowSnapshot } from '../../workflows/workflow-display'

export type TaskDrawerFilter = 'all' | 'running' | 'queued' | 'done'
export type TaskDrawerFocus = 'list' | 'detail'
export type TaskDrawerDetailMode = 'live' | 'details'

export const taskDrawerFilterOrder: readonly TaskDrawerFilter[] = [
  'all',
  'running',
  'queued',
  'done',
]

export interface TaskDrawerCounts {
  total: number
  running: number
  queued: number
  done: number
  failed: number
}

export interface TaskProgress {
  completed: number
  total: number
}

function isFinishedStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function matchesTaskDrawerFilter(task: TaskRecord, filter: TaskDrawerFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'running':
      return task.status === 'running'
    case 'queued':
      return task.status === 'pending'
    case 'done':
      return isFinishedStatus(task.status)
  }
}

export function filterTaskGroups(
  activeTasks: readonly TaskRecord[],
  recentTasks: readonly TaskRecord[],
  filter: TaskDrawerFilter,
): { activeTasks: TaskRecord[]; recentTasks: TaskRecord[]; tasks: TaskRecord[] } {
  const filteredActive = activeTasks.filter((task) => matchesTaskDrawerFilter(task, filter))
  const filteredRecent = recentTasks.filter((task) => matchesTaskDrawerFilter(task, filter))
  return {
    activeTasks: filteredActive,
    recentTasks: filteredRecent,
    tasks: [...filteredActive, ...filteredRecent],
  }
}

export function getTaskDrawerCounts(tasks: readonly TaskRecord[]): TaskDrawerCounts {
  return tasks.reduce<TaskDrawerCounts>(
    (counts, task) => ({
      total: counts.total + 1,
      running: counts.running + (task.status === 'running' ? 1 : 0),
      queued: counts.queued + (task.status === 'pending' ? 1 : 0),
      done: counts.done + (isFinishedStatus(task.status) ? 1 : 0),
      failed: counts.failed + (task.status === 'failed' ? 1 : 0),
    }),
    { total: 0, running: 0, queued: 0, done: 0, failed: 0 },
  )
}

function workflowProgress(task: TaskRecord): TaskProgress | null {
  const value = task.metadata?.workflowSnapshot
  if (!value || typeof value !== 'object') {
    return null
  }

  const snapshot = value as Partial<WorkflowSnapshot>
  if (
    typeof snapshot.doneCount !== 'number'
    || typeof snapshot.agentCount !== 'number'
    || snapshot.agentCount <= 0
  ) {
    return null
  }

  return {
    completed: Math.max(0, Math.min(snapshot.doneCount, snapshot.agentCount)),
    total: snapshot.agentCount,
  }
}

export function getTaskProgress(task: TaskRecord): TaskProgress | null {
  const workflow = workflowProgress(task)
  if (workflow) {
    return workflow
  }

  const summary = task.progressSummary ?? ''
  const match = summary.match(/\b(\d+)\s*\/\s*(\d+)\b/)
  if (!match) {
    return null
  }

  const completed = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return null
  }

  return {
    completed: Math.max(0, Math.min(completed, total)),
    total,
  }
}

export function makeProgressBar(progress: TaskProgress, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width))
  const filled = Math.round((progress.completed / progress.total) * safeWidth)
  return `${'█'.repeat(filled)}${'░'.repeat(safeWidth - filled)}`
}

export function nextTaskDrawerFilter(filter: TaskDrawerFilter): TaskDrawerFilter {
  const index = taskDrawerFilterOrder.indexOf(filter)
  return taskDrawerFilterOrder[(index + 1) % taskDrawerFilterOrder.length] ?? 'all'
}
