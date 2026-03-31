import { TextAttributes } from '@opentui/core'

import type { TaskRecord } from '../../tasks/task-types'
import { theme } from '../theme'

export interface TaskPanelProps {
  tasks: TaskRecord[]
}

export function TaskPanel({ tasks }: TaskPanelProps) {
  if (tasks.length === 0) {
    return null
  }

  return (
    <box
      flexDirection="column"
      style={{ border: ['left'], borderColor: theme.bodyBorder, padding: 1, backgroundColor: theme.background }}
    >
      <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Tasks" />
      {tasks.slice(0, 5).map((task) => (
        <text
          key={task.id}
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={`${task.id.slice(0, 8)} [${task.kind}:${task.status}] ${task.title}`}
        />
      ))}
    </box>
  )
}
