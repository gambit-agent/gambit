import { useEffect, useMemo, useState } from 'react'
import { TextAttributes } from '@opentui/core'

import type { TaskRecord, TaskStatus } from '../../tasks/task-types'
import { readTaskOutputTail } from '../../tasks/task-output'
import type { WorkflowAgentStatus, WorkflowSnapshot } from '../../workflows/workflow-display'
import { PopupOverlay } from '../../ui/components/PopupOverlay'
import { theme } from '../../ui/theme'
import { readRawJsonlTailEntries } from '../../session/jsonl'
import { formatDuration, formatTaskTitle, truncateTaskLine } from '../repl-format'

interface TaskPreview {
  taskId: string | null
  outputLines: string[]
  transcriptLines: string[]
  error: string | null
}

const emptyPreview: TaskPreview = {
  taskId: null,
  outputLines: [],
  transcriptLines: [],
  error: null,
}

function getTaskBodyHeight(terminalHeight: number, taskCount: number, hasGoal: boolean): number {
  const desiredHeight = Math.min(22, Math.max(hasGoal ? 10 : 8, taskCount * 2 + 6))
  const maxHeight = Math.max(8, terminalHeight - 12)
  return Math.min(desiredHeight, maxHeight)
}

function FooterHint({ title, label }: { title: string; label: string }) {
  return (
    <text>
      <span fg={theme.userFg} attributes={TextAttributes.BOLD}>{title}</span>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${label}`}</span>
    </text>
  )
}

function getStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return theme.successFg
    case 'failed':
      return theme.errorFg
    case 'cancelled':
      return theme.warningFg
    case 'running':
      return theme.headerAccent
    case 'pending':
      return theme.infoFg
  }
}

function getStatusMarker(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'ok'
    case 'failed':
      return 'err'
    case 'cancelled':
      return 'can'
    case 'running':
      return 'run'
    case 'pending':
      return 'new'
  }
}

function getWorkflowAgentStatusColor(status: WorkflowAgentStatus): string {
  switch (status) {
    case 'done':
      return theme.successFg
    case 'error':
      return theme.errorFg
    case 'running':
      return theme.headerAccent
    case 'queued':
      return theme.infoFg
    case 'skipped':
      return theme.warningFg
  }
}

function getWorkflowSnapshot(task: TaskRecord): WorkflowSnapshot | null {
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

function getElapsed(task: TaskRecord): string | null {
  if (!task.startedAt) {
    return null
  }

  const started = new Date(task.startedAt).getTime()
  if (!Number.isFinite(started)) {
    return null
  }

  const finished = task.finishedAt ? new Date(task.finishedAt).getTime() : Date.now()
  if (!Number.isFinite(finished)) {
    return null
  }

  return formatDuration(finished - started)
}

function metadataText(task: TaskRecord): string {
  const parts: string[] = [task.kind]
  const role = task.metadata?.agentRole
  if (typeof role === 'string') {
    parts.push(role)
  }
  const elapsed = getElapsed(task)
  if (elapsed) {
    parts.push(elapsed)
  }
  return parts.join(' / ')
}

function formatPreviewLines(text: string, maxLines: number, maxWidth: number): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => truncateTaskLine(line, maxWidth))
    .filter(Boolean)
    .slice(-maxLines)
}

function compactValue(value: unknown, maxLength: number): string {
  if (typeof value === 'string') {
    return truncateTaskLine(value, maxLength)
  }
  try {
    return truncateTaskLine(JSON.stringify(value), maxLength)
  } catch {
    return truncateTaskLine(String(value), maxLength)
  }
}

function formatTranscriptEntry(entry: Record<string, unknown>, maxWidth: number): string | null {
  const type = typeof entry.type === 'string' ? entry.type : 'event'
  switch (type) {
    case 'tool-call':
      return truncateTaskLine(
        `tool start ${String(entry.toolName ?? 'unknown')}: ${compactValue(entry.input, maxWidth)}`,
        maxWidth,
      )
    case 'tool-result':
      return truncateTaskLine(
        `tool done ${String(entry.toolName ?? 'unknown')}: ${compactValue(entry.output, maxWidth)}`,
        maxWidth,
      )
    case 'tool-error':
      return truncateTaskLine(
        `tool error ${String(entry.toolName ?? 'unknown')}: ${compactValue(entry.error, maxWidth)}`,
        maxWidth,
      )
    case 'reasoning':
      return truncateTaskLine(`reasoning: ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'assistant':
      return truncateTaskLine(`assistant: ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'user':
      return truncateTaskLine(`prompt: ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'system':
      return null
    default:
      return truncateTaskLine(`${type}: ${compactValue(entry, maxWidth)}`, maxWidth)
  }
}

async function readTranscriptLines(task: TaskRecord, maxLines: number, maxWidth: number): Promise<string[]> {
  if (!task.transcriptPath) {
    return []
  }

  try {
    const entries = await readRawJsonlTailEntries<Record<string, unknown>>(task.transcriptPath, maxLines * 3)
    return entries
      .map((entry) => formatTranscriptEntry(entry, maxWidth))
      .filter((line): line is string => Boolean(line))
      .slice(-maxLines)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function WorkflowDetail({
  snapshot,
  lineWidth,
}: {
  snapshot: WorkflowSnapshot
  lineWidth: number
}) {
  const phaseNames = [
    ...new Set([
      ...snapshot.phases,
      ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
      ...snapshot.agents.map((agent) => agent.phase).filter((phase): phase is string => Boolean(phase)),
    ]),
  ]

  return (
    <box flexDirection="column" gap={0}>
      <text
        fg={theme.statusFg}
        attributes={TextAttributes.DIM}
        content={truncateTaskLine(
          `${snapshot.doneCount}/${snapshot.agentCount} agents / ${snapshot.runningCount} running / ${snapshot.errorCount} failed`,
          lineWidth,
        )}
      />

      {phaseNames.length > 0 ? (
        <>
          <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Phases" />
          {phaseNames.slice(-8).map((phase) => {
            const agents = snapshot.agents.filter((agent) => agent.phase === phase)
            const done = agents.filter((agent) => agent.status === 'done').length
            const running = agents.filter((agent) => agent.status === 'running').length
            const errors = agents.filter((agent) => agent.status === 'error').length
            const skipped = agents.filter((agent) => agent.status === 'skipped').length
            const complete = done + errors + skipped === agents.length
            const marker = errors > 0 ? 'err' : running > 0 || snapshot.currentPhase === phase ? 'run' : complete ? 'ok' : 'new'
            const color = errors > 0
              ? theme.errorFg
              : skipped > 0
                ? theme.warningFg
              : complete
                ? theme.successFg
                : running > 0
                  ? theme.headerAccent
                  : theme.infoFg
            return (
              <text
                key={phase}
                fg={color}
                content={truncateTaskLine(
                  `${marker} ${phase} ${done}/${agents.length}${running ? ` / ${running} running` : ''}${errors ? ` / ${errors} failed` : ''}${skipped ? ` / ${skipped} skipped` : ''}`,
                  lineWidth,
                )}
              />
            )
          })}
        </>
      ) : null}

      {snapshot.agents.length > 0 ? (
        <>
          <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Subagents" />
          {snapshot.agents.slice(-12).map((agent) => (
            <text
              key={`${agent.id}-${agent.label}`}
              fg={getWorkflowAgentStatusColor(agent.status)}
              attributes={agent.status === 'running' ? TextAttributes.BOLD : undefined}
              content={truncateTaskLine(
                `#${agent.id} ${agent.status.padEnd(7)} ${agent.label}${agent.resultPreview ? ` - ${agent.resultPreview}` : ''}`,
                lineWidth,
              )}
            />
          ))}
        </>
      ) : null}

      {snapshot.logs.length > 0 ? (
        <>
          <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Logs" />
          {snapshot.logs.slice(-4).map((log, index) => (
            <text key={`${index}-${log}`} fg={theme.statusFg} content={truncateTaskLine(log, lineWidth)} />
          ))}
        </>
      ) : null}
    </box>
  )
}

function DetailSection({
  title,
  lines,
  first = false,
}: {
  title: string
  lines: string[]
  first?: boolean
}) {
  if (lines.length === 0) {
    return null
  }

  return (
    <box flexDirection="column" gap={0} marginTop={first ? 1 : 2}>
      <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content={title} />
      {lines.map((line, index) => (
        <text key={`${title}-${index}`} fg={theme.statusFg} content={line} />
      ))}
    </box>
  )
}

function TaskDetail({
  task,
  preview,
  lineWidth,
}: {
  task: TaskRecord
  preview: TaskPreview
  lineWidth: number
}) {
  const workflowSnapshot = getWorkflowSnapshot(task)
  const progress = task.error ?? task.progressSummary

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text
          fg={theme.headingFg}
          attributes={TextAttributes.BOLD}
          content={truncateTaskLine(formatTaskTitle(task.title), Math.max(12, lineWidth - 14))}
        />
        <text fg={getStatusColor(task.status)} content={task.status} />
      </box>

      <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={truncateTaskLine(task.id, lineWidth)} />
      <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={truncateTaskLine(metadataText(task), lineWidth)} />

      {progress ? (
        <text
          fg={task.error ? theme.errorFg : theme.statusFg}
          content={truncateTaskLine(progress, lineWidth)}
        />
      ) : null}

      {workflowSnapshot ? <WorkflowDetail snapshot={workflowSnapshot} lineWidth={lineWidth} /> : null}

      <DetailSection title="Transcript" lines={preview.transcriptLines} first />
      <DetailSection title="Output" lines={preview.outputLines} />

      {preview.error ? (
        <text fg={theme.errorFg} content={truncateTaskLine(preview.error, lineWidth)} />
      ) : null}

      {task.outputPath ? (
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={truncateTaskLine(`output ${task.outputPath}`, lineWidth)} />
      ) : null}
      {task.transcriptPath ? (
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={truncateTaskLine(`transcript ${task.transcriptPath}`, lineWidth)} />
      ) : null}
    </box>
  )
}

function GoalDetail({
  goal,
  lineWidth,
}: {
  goal: string | null
  lineWidth: number
}) {
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Goal" />
      <text
        fg={goal ? theme.assistantFg : theme.statusFg}
        attributes={goal ? undefined : TextAttributes.DIM}
        content={truncateTaskLine(goal ?? 'No active goal.', lineWidth)}
      />
    </box>
  )
}

export function TaskDrawer({
  activeTasks,
  recentTasks,
  selectedTaskIndex,
  goal,
  terminalWidth,
  terminalHeight,
  onClose,
}: {
  activeTasks: TaskRecord[]
  recentTasks: TaskRecord[]
  selectedTaskIndex: number
  goal: string | null
  terminalWidth: number
  terminalHeight: number
  onClose: () => void
}) {
  const tasks = useMemo(() => [...activeTasks, ...recentTasks], [activeTasks, recentTasks])
  const taskCount = tasks.length
  const bodyHeight = getTaskBodyHeight(terminalHeight, taskCount, Boolean(goal))
  const panelWidth = Math.min(116, Math.max(1, terminalWidth - 2))
  const wide = panelWidth >= 92
  const leftWidth = wide ? Math.min(42, Math.max(30, Math.floor(panelWidth * 0.36))) : Math.max(24, panelWidth - 8)
  const leftPaneHeight = wide ? bodyHeight : Math.max(4, Math.floor(bodyHeight * 0.45))
  const detailPaneHeight = wide ? bodyHeight : Math.max(1, bodyHeight - leftPaneHeight - 1)
  const listWidth = Math.max(24, leftWidth - 4)
  const detailWidth = wide
    ? Math.max(30, panelWidth - leftWidth - 8)
    : Math.max(24, panelWidth - 8)
  const normalizedSelectedIndex = taskCount > 0
    ? Math.min(Math.max(selectedTaskIndex, 0), taskCount - 1)
    : -1
  const selectedTask = normalizedSelectedIndex >= 0 ? tasks[normalizedSelectedIndex] ?? null : null
  const [preview, setPreview] = useState<TaskPreview>(emptyPreview)

  useEffect(() => {
    let cancelled = false

    if (!selectedTask) {
      setPreview(emptyPreview)
      return
    }

    const load = async () => {
      try {
        const [output, transcriptLines] = await Promise.all([
          readTaskOutputTail(selectedTask.id, 64 * 1024),
          readTranscriptLines(selectedTask, 12, detailWidth),
        ])
        if (cancelled) {
          return
        }
        setPreview({
          taskId: selectedTask.id,
          outputLines: formatPreviewLines(output, 12, detailWidth),
          transcriptLines,
          error: null,
        })
      } catch (error) {
        if (cancelled) {
          return
        }
        setPreview({
          taskId: selectedTask.id,
          outputLines: [],
          transcriptLines: [],
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    void load()
    const refresh = selectedTask.status === 'running' || selectedTask.status === 'pending'
      ? setInterval(() => {
          void load()
        }, 1000)
      : null

    return () => {
      cancelled = true
      if (refresh) {
        clearInterval(refresh)
      }
    }
  }, [detailWidth, selectedTask?.id, selectedTask?.progressSummary, selectedTask?.status])

  const runningCount = activeTasks.filter((task) => task.status === 'running').length
  const pendingCount = activeTasks.filter((task) => task.status === 'pending').length
  const workflowCount = tasks.filter((task) => task.kind === 'workflow').length
  const agentCount = tasks.filter((task) => task.kind === 'agent').length
  const activitySummary = (() => {
    if (taskCount === 0) {
      return goal ? 'goal active' : 'no activity'
    }
    if (agentCount === taskCount) {
      return `${agentCount} agent ${agentCount === 1 ? 'task' : 'tasks'}`
    }
    if (workflowCount === taskCount) {
      return `${workflowCount} workflow ${workflowCount === 1 ? 'task' : 'tasks'}`
    }

    const parts: string[] = []
    if (runningCount > 0) {
      parts.push(`${runningCount} running`)
    }
    if (pendingCount > 0) {
      parts.push(`${pendingCount} pending`)
    }
    if (workflowCount > 0) {
      parts.push(`${workflowCount} workflow${workflowCount === 1 ? '' : 's'}`)
    }
    if (agentCount > 0) {
      parts.push(`${agentCount} agent${agentCount === 1 ? '' : 's'}`)
    }
    return parts.length > 0 ? parts.join(' / ') : `${taskCount} tasks`
  })()

  const renderTask = (task: TaskRecord, index: number, tone: 'active' | 'recent') => {
    const selected = index === normalizedSelectedIndex
    const fg = selected
      ? theme.selectedFg
      : tone === 'active'
        ? getStatusColor(task.status)
        : theme.statusFg
    const summary = task.progressSummary ?? task.error

    return (
      <box
        key={task.id}
        flexDirection="column"
        minHeight={summary ? 2 : 1}
        paddingX={1}
        backgroundColor={selected ? theme.selectedBg : theme.background}
      >
        <text
          fg={fg}
          attributes={selected || tone === 'active' ? TextAttributes.BOLD : TextAttributes.DIM}
          content={truncateTaskLine(
            `${selected ? '*' : ' '} ${getStatusMarker(task.status).padEnd(3)} ${task.kind.padEnd(8)} ${formatTaskTitle(task.title)}`,
            listWidth,
          )}
        />
        {summary ? (
          <text
            fg={selected ? theme.selectedFg : theme.statusFg}
            attributes={TextAttributes.DIM}
            content={truncateTaskLine(`    ${summary}`, listWidth)}
          />
        ) : null}
      </box>
    )
  }

  return (
    <PopupOverlay size="xlarge" zIndex={90} onClose={onClose}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={2} flexShrink={1}>
            <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Agent activity" />
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={truncateTaskLine(activitySummary, Math.max(12, detailWidth - 18))}
            />
          </box>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
        </box>
      </box>

      <box
        flexDirection={wide ? 'row' : 'column'}
        width="100%"
        paddingLeft={1}
        paddingRight={1}
      >
        <box
          flexDirection="column"
          width={wide ? leftWidth : '100%'}
          height={leftPaneHeight}
          border={wide ? ['right'] : undefined}
          paddingRight={wide ? 1 : 0}
          backgroundColor={theme.background}
          style={{ borderColor: theme.bodyBorder }}
        >
          {goal ? (
            <box flexDirection="column" paddingLeft={3} paddingRight={3} paddingBottom={1}>
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Goal" />
              <text fg={theme.statusFg} content={truncateTaskLine(goal, listWidth)} />
            </box>
          ) : null}

          <scrollbox
            height={goal ? Math.max(1, leftPaneHeight - 3) : leftPaneHeight}
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
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No task records yet." />
            ) : null}
            {activeTasks.length > 0 ? (
              <>
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Active" />
                {activeTasks.map((task, index) => renderTask(task, index, 'active'))}
              </>
            ) : taskCount > 0 ? (
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No active tasks." />
            ) : null}
            {recentTasks.length > 0 ? (
              <>
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Recent" />
                {recentTasks.map((task, index) => renderTask(task, activeTasks.length + index, 'recent'))}
              </>
            ) : null}
          </scrollbox>
        </box>

        <box
          flexDirection="column"
          flexGrow={1}
          paddingLeft={wide ? 2 : 0}
          paddingTop={wide ? 0 : 1}
          backgroundColor={theme.background}
        >
          <scrollbox
            height={detailPaneHeight}
            scrollY
            focused
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
            {selectedTask ? (
              <TaskDetail
                task={selectedTask}
                preview={preview.taskId === selectedTask.id ? preview : emptyPreview}
                lineWidth={detailWidth}
              />
            ) : (
              <GoalDetail goal={goal} lineWidth={detailWidth} />
            )}
          </scrollbox>
        </box>
      </box>

      <box
        paddingTop={1}
        paddingLeft={4}
        paddingRight={4}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <FooterHint title="Up/Down" label="move" />
          <FooterHint title="Home/End" label="jump" />
        </box>
        <box flexDirection="row" gap={2}>
          <FooterHint title="Ctrl+B" label="close" />
          <FooterHint title="Esc" label="close" />
        </box>
      </box>
    </PopupOverlay>
  )
}
