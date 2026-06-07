import { TextAttributes } from '@opentui/core'

import type { TaskRecord } from '../../tasks/task-types'
import { layout, theme } from '../../ui/theme'
import { formatTaskTitle, truncateTaskLine } from '../repl-format'

function getTaskPanelHeight(terminalHeight: number, taskCount: number): number {
  const desiredHeight = Math.min(14, Math.max(7, taskCount * 2 + 5))
  const maxHeight = Math.max(5, Math.floor(terminalHeight * 0.35))
  return Math.min(desiredHeight, maxHeight)
}

export function TaskDrawer({
  activeTasks,
  recentTasks,
  terminalWidth,
  terminalHeight,
}: {
  activeTasks: TaskRecord[]
  recentTasks: TaskRecord[]
  terminalWidth: number
  terminalHeight: number
}) {
  const taskCount = activeTasks.length + recentTasks.length
  const panelHeight = getTaskPanelHeight(terminalHeight, taskCount)
  const bodyHeight = Math.max(1, panelHeight - 4)
  const lineWidth = Math.max(24, terminalWidth - layout.screenPadding * 2 - 8)
  const runningCount = activeTasks.filter((task) => task.status === 'running').length
  const pendingCount = activeTasks.filter((task) => task.status === 'pending').length
  const statusText =
    taskCount === 0
      ? 'No tasks'
      : `${runningCount} running${pendingCount > 0 ? `, ${pendingCount} pending` : ''}`

  const renderTask = (task: TaskRecord, tone: 'active' | 'recent') => (
    <box key={task.id} flexDirection="column" minHeight={task.progressSummary ? 2 : 1}>
      <text
        fg={tone === 'active' ? theme.assistantFg : theme.statusFg}
        attributes={tone === 'active' ? TextAttributes.BOLD : TextAttributes.DIM}
        content={truncateTaskLine(
          `${task.id.slice(0, 8)}  ${task.status.padEnd(9)}  ${formatTaskTitle(task.title)}`,
          lineWidth,
        )}
      />
      {task.progressSummary ? (
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={truncateTaskLine(`  ${task.progressSummary}`, lineWidth)}
        />
      ) : null}
    </box>
  )

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width="100%"
      height={panelHeight}
      border={['top', 'bottom', 'left', 'right']}
      borderStyle="heavy"
      paddingX={1}
      marginBottom={1}
      style={{
        borderColor: theme.inputBorder,
        backgroundColor: theme.background,
      }}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Tasks" />
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={statusText} />
      </box>
      <scrollbox
        height={bodyHeight}
        scrollY
        style={{
          rootOptions: {
            backgroundColor: theme.background,
          },
          contentOptions: {
            flexDirection: 'column',
            gap: 0,
            backgroundColor: theme.background,
          },
        }}
      >
        {taskCount === 0 ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No tasks yet." />
        ) : null}
        {activeTasks.length > 0 ? (
          <>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Active" />
            {activeTasks.map((task) => renderTask(task, 'active'))}
          </>
        ) : taskCount > 0 ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No active tasks." />
        ) : null}
        {recentTasks.length > 0 ? (
          <>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Recent" />
            {recentTasks.map((task) => renderTask(task, 'recent'))}
          </>
        ) : null}
      </scrollbox>
      <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Ctrl+B to close" />
    </box>
  )
}
