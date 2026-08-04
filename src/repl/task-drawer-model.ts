import type { TaskRecord } from '../tasks/task-types'
import { isActiveTaskStatus } from './repl-format'

export type TaskDrawerFilter = 'all' | 'active' | 'history'
export type TaskDrawerPane = 'list' | 'detail'
export type TaskDrawerDetailTab = 'activity' | 'output' | 'details'
export type TaskDrawerAction =
  | 'close'
  | 'toggle-pane'
  | 'cycle-filter'
  | 'show-activity'
  | 'show-output'
  | 'show-details'
  | 'cancel-selected'
  | 'focus-list'
  | 'focus-detail'
  | 'select-previous'
  | 'select-next'
  | 'select-first'
  | 'select-last'

interface TaskDrawerKey {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
}

export const taskDrawerFilters: readonly TaskDrawerFilter[] = ['all', 'active', 'history']
export const taskDrawerDetailTabs: readonly TaskDrawerDetailTab[] = ['activity', 'output', 'details']

export function filterTaskDrawerTasks(
  activeTasks: readonly TaskRecord[],
  recentTasks: readonly TaskRecord[],
  filter: TaskDrawerFilter,
): TaskRecord[] {
  switch (filter) {
    case 'active':
      return [...activeTasks]
    case 'history':
      return [...recentTasks]
    case 'all':
      return [...activeTasks, ...recentTasks]
  }
}

export function cycleTaskDrawerFilter(
  filter: TaskDrawerFilter,
  delta = 1,
): TaskDrawerFilter {
  const currentIndex = taskDrawerFilters.indexOf(filter)
  const nextIndex = (currentIndex + delta + taskDrawerFilters.length) % taskDrawerFilters.length
  return taskDrawerFilters[nextIndex] ?? 'all'
}

export function isTaskCancellable(task: TaskRecord | null): boolean {
  return Boolean(task && isActiveTaskStatus(task.status))
}

export function resolveTaskDrawerAction(
  key: TaskDrawerKey,
  focusPane: TaskDrawerPane,
): TaskDrawerAction | null {
  const plainKey = !key.ctrl && !key.meta && !key.shift && !key.option

  if (key.name === 'escape' || (key.name === 'b' && key.ctrl && !key.meta && !key.shift)) {
    return 'close'
  }
  if (key.name === 'tab') return 'toggle-pane'
  if (key.name === 'f' && plainKey) return 'cycle-filter'
  if (key.name === 'a' && plainKey) return 'show-activity'
  if (key.name === 'o' && plainKey) return 'show-output'
  if (key.name === 'd' && plainKey) return 'show-details'
  if (key.name === 'c' && plainKey) return 'cancel-selected'
  if (key.name === 'left' || (key.name === 'h' && plainKey)) return 'focus-list'
  if (key.name === 'right' || (key.name === 'l' && plainKey) || key.name === 'enter' || key.name === 'return') {
    return 'focus-detail'
  }

  if (focusPane !== 'list') {
    return null
  }
  if (key.name === 'up' || (key.name === 'k' && plainKey) || (key.name === 'p' && key.ctrl)) {
    return 'select-previous'
  }
  if (key.name === 'down' || (key.name === 'j' && plainKey) || (key.name === 'n' && key.ctrl)) {
    return 'select-next'
  }
  if (key.name === 'home') return 'select-first'
  if (key.name === 'end') return 'select-last'

  return null
}
