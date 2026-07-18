import { TextAttributes } from '@opentui/core'

import type { TaskRecord } from '../../tasks/task-types'
import { layout, theme } from '../theme'

export interface TaskPanelProps {
  tasks: TaskRecord[]
  goalActive?: boolean
}

export function TaskPanel({ tasks, goalActive = false }: TaskPanelProps) {
  if (tasks.length === 0 && !goalActive) {
    return null
  }

  const runningTasks = tasks.filter((t) => t.status === 'running').length
  const workflowTasks = tasks.filter((task) => task.kind === 'workflow').length
  const agentTasks = tasks.filter((task) => task.kind === 'agent').length
  const parts: string[] = []
  if (runningTasks > 0) {
    parts.push(`${runningTasks} run`)
  }
  if (workflowTasks > 0) {
    parts.push(`${workflowTasks} wf`)
  }
  if (agentTasks > 0) {
    parts.push(`${agentTasks} ag`)
  }
  const summary = parts.length > 0 ? parts.join(' · ') : `${tasks.length} total`
  const textContent = tasks.length === 0
    ? 'Activity: goal (Ctrl+B)'
    : `Activity: ${summary} (Ctrl+B)`

  return (
    <box flexDirection="row" gap={layout.panelGap} paddingLeft={2}>
      <text wrapMode="none" fg={theme.statusFg} attributes={TextAttributes.DIM} content={textContent} />
    </box>
  )
}
