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
  const textContent = tasks.length === 0
    ? 'Activity: goal (Ctrl+B)'
    : runningTasks > 0
      ? `Activity: ${runningTasks} run / ${workflowTasks} wf / ${agentTasks} ag (Ctrl+B)`
      : `Activity: ${tasks.length} total / ${workflowTasks} wf / ${agentTasks} ag (Ctrl+B)`

  return (
    <box flexDirection="row" gap={layout.panelGap} paddingLeft={2}>
      <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={textContent} />
    </box>
  )
}
