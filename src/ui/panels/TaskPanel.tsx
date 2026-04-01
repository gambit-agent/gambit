import { TextAttributes } from '@opentui/core'

import type { TaskRecord } from '../../tasks/task-types'
import { layout, theme } from '../theme'

export interface TaskPanelProps {
  tasks: TaskRecord[]
}

export function TaskPanel({ tasks }: TaskPanelProps) {
  if (tasks.length === 0) {
    return null
  }

  const runningTasks = tasks.filter((t) => t.status === 'running').length
  const textContent = runningTasks > 0
    ? `⊙ Tasks: ${runningTasks} running (Ctrl+B)`
    : `⊙ Tasks: ${tasks.length} total (Ctrl+B)`

  return (
    <box flexDirection="row" gap={layout.panelGap}>
      <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={textContent} />
    </box>
  )
}
