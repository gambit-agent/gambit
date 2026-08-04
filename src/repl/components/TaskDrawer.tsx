import { TextAttributes } from '@opentui/core'
import { useEffect, useMemo, useState } from 'react'

import { readRawJsonlTailEntries } from '../../session/jsonl'
import { readTaskOutputTail } from '../../tasks/task-output'
import type { TaskRecord, TaskStatus } from '../../tasks/task-types'
import { PopupOverlay } from '../../ui/components/PopupOverlay'
import { theme } from '../../ui/theme'
import type { WorkflowAgentStatus, WorkflowSnapshot } from '../../workflows/workflow-display'
import { formatDuration, formatTaskTitle, truncateTaskLine } from '../repl-format'
import {
  filterTaskGroups,
  getTaskDrawerCounts,
  getTaskProgress,
  makeProgressBar,
  type TaskDrawerDetailMode,
  type TaskDrawerFilter,
  type TaskDrawerFocus,
} from './task-drawer-model'

interface TaskPreview {
  taskId: string | null
  outputLines: string[]
  transcriptLines: string[]
  error: string | null
}

export interface TaskDrawerProps {
  activeTasks: TaskRecord[]
  recentTasks: TaskRecord[]
  selectedTaskIndex: number
  filter: TaskDrawerFilter
  focus: TaskDrawerFocus
  detailMode: TaskDrawerDetailMode
  goal: string | null
  terminalWidth: number
  terminalHeight: number
  onFilterChange: (filter: TaskDrawerFilter) => void
  onDetailModeChange: (mode: TaskDrawerDetailMode) => void
  onClose: () => void
}

const emptyPreview: TaskPreview = {
  taskId: null,
  outputLines: [],
  transcriptLines: [],
  error: null,
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

function getTaskBodyHeight(terminalHeight: number, taskCount: number): number {
  const desiredHeight = Math.min(26, Math.max(14, taskCount * 2 + 8))
  const maxHeight = Math.max(8, terminalHeight - 10)
  return Math.min(desiredHeight, maxHeight)
}

function FooterHint({ title, label }: { title: string; label: string }) {
  return (
    <text>
      <span fg={theme.headerAccent} attributes={TextAttributes.BOLD}>{title}</span>
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
      return theme.infoFg
    case 'pending':
      return theme.warningAccent
  }
}

function getStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'DONE'
    case 'failed':
      return 'FAILED'
    case 'cancelled':
      return 'CANCELLED'
    case 'running':
      return 'RUNNING'
    case 'pending':
      return 'QUEUED'
  }
}

function getStatusGlyph(status: TaskStatus, spinnerFrame: number): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'failed':
      return '×'
    case 'cancelled':
      return '⊘'
    case 'running':
      return spinnerFrames[spinnerFrame] ?? spinnerFrames[0]
    case 'pending':
      return '○'
  }
}

function getWorkflowAgentStatusColor(status: WorkflowAgentStatus): string {
  switch (status) {
    case 'done':
      return theme.successFg
    case 'error':
      return theme.errorFg
    case 'running':
      return theme.infoFg
    case 'queued':
      return theme.warningAccent
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

function getStartedAt(task: TaskRecord): string {
  if (!task.startedAt) {
    return '—'
  }
  const started = new Date(task.startedAt)
  if (!Number.isFinite(started.getTime())) {
    return '—'
  }
  return started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
        `→ ${String(entry.toolName ?? 'tool')} ${compactValue(entry.input, maxWidth)}`,
        maxWidth,
      )
    case 'tool-result':
      return truncateTaskLine(
        `← ${String(entry.toolName ?? 'tool')} ${compactValue(entry.output, maxWidth)}`,
        maxWidth,
      )
    case 'tool-error':
      return truncateTaskLine(
        `× ${String(entry.toolName ?? 'tool')} ${compactValue(entry.error, maxWidth)}`,
        maxWidth,
      )
    case 'reasoning':
      return truncateTaskLine(`~ ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'assistant':
      return truncateTaskLine(`▸ ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'user':
      return truncateTaskLine(`? ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'system':
      return null
    default:
      return truncateTaskLine(`· ${type} ${compactValue(entry, maxWidth)}`, maxWidth)
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

function WorkflowDetail({ snapshot, lineWidth }: { snapshot: WorkflowSnapshot; lineWidth: number }) {
  const phaseNames = [
    ...new Set([
      ...snapshot.phases,
      ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
      ...snapshot.agents.map((agent) => agent.phase).filter((phase): phase is string => Boolean(phase)),
    ]),
  ]

  return (
    <box flexDirection="column" gap={0} marginTop={1}>
      <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
        {truncateTaskLine(
          `${snapshot.doneCount}/${snapshot.agentCount} agents  ·  ${snapshot.runningCount} running  ·  ${snapshot.errorCount} failed`,
          lineWidth,
        )}
      </text>

      {phaseNames.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.statusFg} attributes={TextAttributes.BOLD}>PHASES</text>
          {phaseNames.slice(-8).map((phase) => {
            const agents = snapshot.agents.filter((agent) => agent.phase === phase)
            const done = agents.filter((agent) => agent.status === 'done').length
            const running = agents.filter((agent) => agent.status === 'running').length
            const errors = agents.filter((agent) => agent.status === 'error').length
            const skipped = agents.filter((agent) => agent.status === 'skipped').length
            const complete = done + errors + skipped === agents.length
            const marker = errors > 0 ? '×' : running > 0 || snapshot.currentPhase === phase ? '◉' : complete ? '✓' : '○'
            const color = errors > 0
              ? theme.errorFg
              : complete
                ? theme.successFg
                : running > 0
                  ? theme.infoFg
                  : theme.warningAccent
            return (
              <text key={phase} fg={color}>
                {truncateTaskLine(
                  `${marker} ${phase}  ${done}/${agents.length}${running ? `  ·  ${running} running` : ''}${errors ? `  ·  ${errors} failed` : ''}`,
                  lineWidth,
                )}
              </text>
            )
          })}
        </box>
      ) : null}

      {snapshot.agents.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.statusFg} attributes={TextAttributes.BOLD}>SUBAGENTS</text>
          {snapshot.agents.slice(-10).map((agent) => (
            <text
              key={`${agent.id}-${agent.label}`}
              fg={getWorkflowAgentStatusColor(agent.status)}
              attributes={agent.status === 'running' ? TextAttributes.BOLD : undefined}
            >
              {truncateTaskLine(
                `#${agent.id}  ${agent.status.padEnd(7)}  ${agent.label}${agent.resultPreview ? `  ·  ${agent.resultPreview}` : ''}`,
                lineWidth,
              )}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  )
}

function DetailTabs({
  mode,
  onChange,
}: {
  mode: TaskDrawerDetailMode
  onChange: (mode: TaskDrawerDetailMode) => void
}) {
  return (
    <box flexDirection="row" gap={2} paddingTop={1} border={['bottom']} borderColor={theme.bodyBorder}>
      <box onMouseUp={() => onChange('live')}>
        <text fg={mode === 'live' ? theme.headerAccent : theme.statusFg} attributes={mode === 'live' ? TextAttributes.BOLD : TextAttributes.DIM}>
          LIVE OUTPUT
        </text>
      </box>
      <box onMouseUp={() => onChange('details')}>
        <text fg={mode === 'details' ? theme.headerAccent : theme.statusFg} attributes={mode === 'details' ? TextAttributes.BOLD : TextAttributes.DIM}>
          DETAILS
        </text>
      </box>
    </box>
  )
}

function getLiveLineColor(line: string): string {
  if (line.startsWith('×') || /\b(error|failed|failure)\b/i.test(line)) {
    return theme.errorFg
  }
  if (line.startsWith('✓') || /\b(pass|passed|complete|completed)\b/i.test(line)) {
    return theme.successFg
  }
  if (line.startsWith('→') || line.startsWith('←')) {
    return theme.infoFg
  }
  return theme.assistantFg
}

function TaskDetail({
  task,
  preview,
  lineWidth,
  mode,
  spinnerFrame,
  onModeChange,
}: {
  task: TaskRecord
  preview: TaskPreview
  lineWidth: number
  mode: TaskDrawerDetailMode
  spinnerFrame: number
  onModeChange: (mode: TaskDrawerDetailMode) => void
}) {
  const workflowSnapshot = getWorkflowSnapshot(task)
  const progress = getTaskProgress(task)
  const liveLines = preview.outputLines.length > 0 ? preview.outputLines : preview.transcriptLines

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={theme.headingFg} attributes={TextAttributes.BOLD}>
          {truncateTaskLine(formatTaskTitle(task.title), Math.max(12, lineWidth - 20))}
        </text>
        <text fg={getStatusColor(task.status)} attributes={TextAttributes.BOLD}>
          {`${getStatusGlyph(task.status, spinnerFrame)} ${getStatusLabel(task.status)}`}
        </text>
      </box>

      <box flexDirection="row" gap={3} paddingTop={1}>
        <text fg={theme.statusFg} attributes={TextAttributes.DIM}>{`TYPE  ${task.kind.toUpperCase()}`}</text>
        <text fg={theme.statusFg} attributes={TextAttributes.DIM}>{`ELAPSED  ${getElapsed(task) ?? '—'}`}</text>
        <text fg={theme.statusFg} attributes={TextAttributes.DIM}>{`STARTED  ${getStartedAt(task)}`}</text>
      </box>

      {progress ? (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.bodyBorder}
          paddingX={1}
          marginTop={1}
          backgroundColor={theme.background}
        >
          <text fg={theme.statusFg} attributes={TextAttributes.BOLD}>PROGRESS</text>
          <text fg={theme.infoFg}>
            {`${makeProgressBar(progress, Math.max(8, lineWidth - 18))}  ${progress.completed}/${progress.total}`}
          </text>
        </box>
      ) : null}

      <DetailTabs mode={mode} onChange={onModeChange} />

      {mode === 'live' ? (
        <box flexDirection="column" paddingTop={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
              {task.status === 'running' ? 'latest activity' : 'final activity'}
            </text>
            {task.status === 'running' ? (
              <text fg={theme.infoFg}>{`${spinnerFrames[spinnerFrame] ?? spinnerFrames[0]} following`}</text>
            ) : null}
          </box>
          {liveLines.length > 0 ? liveLines.map((line, index) => (
            <text key={`${index}-${line}`} fg={getLiveLineColor(line)} selectable>
              {truncateTaskLine(line, lineWidth)}
            </text>
          )) : (
            <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
              {task.status === 'running' ? 'Waiting for task output…' : 'No output was recorded.'}
            </text>
          )}
          {preview.error ? <text fg={theme.errorFg}>{truncateTaskLine(preview.error, lineWidth)}</text> : null}
        </box>
      ) : (
        <box flexDirection="column" paddingTop={1}>
          {task.error || task.progressSummary ? (
            <text fg={task.error ? theme.errorFg : theme.assistantFg}>
              {truncateTaskLine(task.error ?? task.progressSummary ?? '', lineWidth)}
            </text>
          ) : null}
          {workflowSnapshot ? <WorkflowDetail snapshot={workflowSnapshot} lineWidth={lineWidth} /> : null}
          <box flexDirection="column" marginTop={1}>
            <text fg={theme.statusFg} attributes={TextAttributes.BOLD}>TASK RECORD</text>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM}>{truncateTaskLine(`id  ${task.id}`, lineWidth)}</text>
            {task.outputPath ? (
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} selectable>
                {truncateTaskLine(`output  ${task.outputPath}`, lineWidth)}
              </text>
            ) : null}
            {task.transcriptPath ? (
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} selectable>
                {truncateTaskLine(`transcript  ${task.transcriptPath}`, lineWidth)}
              </text>
            ) : null}
          </box>
        </box>
      )}
    </box>
  )
}

function EmptyDetail({ goal, filter, lineWidth }: { goal: string | null; filter: TaskDrawerFilter; lineWidth: number }) {
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.headingFg} attributes={TextAttributes.BOLD}>No matching tasks</text>
      <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
        {truncateTaskLine(
          filter === 'all' ? 'No background task records yet.' : `No tasks match the ${filter} filter. Press F to change it.`,
          lineWidth,
        )}
      </text>
      {goal ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.statusFg} attributes={TextAttributes.BOLD}>GOAL</text>
          <text fg={theme.assistantFg}>{truncateTaskLine(goal, lineWidth)}</text>
        </box>
      ) : null}
    </box>
  )
}

function FilterTab({
  filter,
  current,
  label,
  count,
  onSelect,
}: {
  filter: TaskDrawerFilter
  current: TaskDrawerFilter
  label: string
  count: number
  onSelect: (filter: TaskDrawerFilter) => void
}) {
  const selected = filter === current
  return (
    <box paddingX={1} backgroundColor={selected ? theme.reasoningBg : theme.background} onMouseUp={() => onSelect(filter)}>
      <text fg={selected ? theme.headerAccent : theme.statusFg} attributes={selected ? TextAttributes.BOLD : TextAttributes.DIM}>
        {`${label} ${count}`}
      </text>
    </box>
  )
}

function SectionLabel({ label, count, width }: { label: string; count: number; width: number }) {
  const prefix = `${label} ${count} `
  return (
    <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
      {`${prefix}${'─'.repeat(Math.max(0, width - prefix.length))}`}
    </text>
  )
}

export function TaskDrawer({
  activeTasks,
  recentTasks,
  selectedTaskIndex,
  filter,
  focus,
  detailMode,
  goal,
  terminalWidth,
  terminalHeight,
  onFilterChange,
  onDetailModeChange,
  onClose,
}: TaskDrawerProps) {
  const allTasks = useMemo(() => [...activeTasks, ...recentTasks], [activeTasks, recentTasks])
  const filtered = useMemo(
    () => filterTaskGroups(activeTasks, recentTasks, filter),
    [activeTasks, filter, recentTasks],
  )
  const counts = useMemo(() => getTaskDrawerCounts(allTasks), [allTasks])
  const taskCount = filtered.tasks.length
  const bodyHeight = getTaskBodyHeight(terminalHeight, allTasks.length)
  const panelWidth = Math.min(114, Math.max(1, terminalWidth - 4))
  const wide = panelWidth >= 90
  const compact = panelWidth < 72
  const leftWidth = wide ? Math.min(42, Math.max(32, Math.floor(panelWidth * 0.38))) : Math.max(24, panelWidth - 4)
  const leftPaneHeight = wide ? bodyHeight : Math.max(6, Math.floor(bodyHeight * 0.48))
  const detailPaneHeight = wide ? bodyHeight : Math.max(2, bodyHeight - leftPaneHeight)
  const listWidth = Math.max(20, leftWidth - 4)
  const detailWidth = wide
    ? Math.max(28, panelWidth - leftWidth - 6)
    : Math.max(20, panelWidth - 6)
  const normalizedSelectedIndex = taskCount > 0
    ? Math.min(Math.max(selectedTaskIndex, 0), taskCount - 1)
    : -1
  const selectedTask = normalizedSelectedIndex >= 0 ? filtered.tasks[normalizedSelectedIndex] ?? null : null
  const [preview, setPreview] = useState<TaskPreview>(emptyPreview)
  const [spinnerFrame, setSpinnerFrame] = useState(0)

  useEffect(() => {
    if (counts.running === 0) {
      setSpinnerFrame(0)
      return
    }
    const interval = setInterval(() => {
      setSpinnerFrame((current) => (current + 1) % spinnerFrames.length)
    }, 120)
    return () => clearInterval(interval)
  }, [counts.running])

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

  const renderTask = (task: TaskRecord, index: number) => {
    const selected = index === normalizedSelectedIndex
    const progress = getTaskProgress(task)
    const summary = task.error ?? task.progressSummary
    const titleWidth = Math.max(8, listWidth - 17)
    const progressWidth = Math.max(6, listWidth - 14)
    const secondary = progress
      ? `${makeProgressBar(progress, progressWidth)} ${progress.completed}/${progress.total}`
      : summary ?? getStatusLabel(task.status).toLowerCase()

    return (
      <box
        key={task.id}
        flexDirection="column"
        minHeight={2}
        paddingLeft={selected ? 1 : 2}
        paddingRight={1}
        border={selected ? ['left'] : undefined}
        borderColor={selected ? theme.headerAccent : undefined}
        backgroundColor={selected ? theme.reasoningBg : theme.background}
      >
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <box flexDirection="row" gap={1} flexGrow={1}>
            <text fg={getStatusColor(task.status)} attributes={TextAttributes.BOLD}>
              {getStatusGlyph(task.status, spinnerFrame)}
            </text>
            <text fg={selected ? theme.headingFg : theme.assistantFg} attributes={selected ? TextAttributes.BOLD : undefined}>
              {truncateTaskLine(formatTaskTitle(task.title), titleWidth)}
            </text>
          </box>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM}>{task.kind.toUpperCase().slice(0, 5)}</text>
          <text fg={getStatusColor(task.status)}>{getElapsed(task) ?? getStatusLabel(task.status)}</text>
        </box>
        <text fg={selected ? theme.selectedFg : theme.statusFg} attributes={TextAttributes.DIM}>
          {truncateTaskLine(`  ${secondary}`, listWidth)}
        </text>
      </box>
    )
  }

  const activeOffset = filtered.activeTasks.length

  return (
    <PopupOverlay size="xlarge" zIndex={90} framed placement="center" onClose={onClose}>
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingX={2}
        paddingY={1}
        border={['bottom']}
        borderColor={theme.bodyBorder}
        backgroundColor={theme.header}
      >
        <text>
          <span fg={theme.headerAccent} attributes={TextAttributes.BOLD}>◆ BACKGROUND TASKS</span>
          {!compact ? (
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>
              {`   ${counts.running} running  ·  ${counts.queued} queued  ·  ${counts.done} finished`}
            </span>
          ) : null}
        </text>
        <text>
          <span fg={theme.headerAccent} attributes={TextAttributes.BOLD}>ESC</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}> CLOSE</span>
        </text>
      </box>

      {goal ? (
        <box paddingX={2} border={['bottom']} borderColor={theme.bodyBorder} backgroundColor={theme.panel}>
          <text>
            <span fg={theme.headerAccent} attributes={TextAttributes.BOLD}>GOAL  </span>
            <span fg={theme.assistantFg}>{truncateTaskLine(goal, Math.max(16, panelWidth - 12))}</span>
          </text>
        </box>
      ) : null}

      <box flexDirection={wide ? 'row' : 'column'} width="100%">
        <box
          flexDirection="column"
          width={wide ? leftWidth : '100%'}
          height={leftPaneHeight}
          border={wide ? ['right'] : ['bottom']}
          borderColor={focus === 'list' ? theme.headerAccent : theme.bodyBorder}
          backgroundColor={theme.background}
        >
          <box flexDirection="row" paddingX={1} border={['bottom']} borderColor={theme.bodyBorder}>
            <FilterTab filter="all" current={filter} label={compact ? 'A' : 'ALL'} count={counts.total} onSelect={onFilterChange} />
            <FilterTab filter="running" current={filter} label={compact ? 'R' : 'RUNNING'} count={counts.running} onSelect={onFilterChange} />
            <FilterTab filter="queued" current={filter} label={compact ? 'Q' : 'QUEUED'} count={counts.queued} onSelect={onFilterChange} />
            <FilterTab filter="done" current={filter} label={compact ? 'D' : 'DONE'} count={counts.done} onSelect={onFilterChange} />
          </box>

          <scrollbox
            height={Math.max(1, leftPaneHeight - 2)}
            scrollY
            focused={focus === 'list'}
            style={{
              rootOptions: { backgroundColor: theme.background },
              contentOptions: { flexDirection: 'column', gap: 0, backgroundColor: theme.background },
            }}
          >
            {filtered.activeTasks.length > 0 ? (
              <>
                <SectionLabel label="ACTIVE NOW" count={filtered.activeTasks.length} width={listWidth} />
                {filtered.activeTasks.map((task, index) => renderTask(task, index))}
              </>
            ) : null}
            {filtered.recentTasks.length > 0 ? (
              <box flexDirection="column" marginTop={filtered.activeTasks.length > 0 ? 1 : 0}>
                <SectionLabel label="RECENT" count={filtered.recentTasks.length} width={listWidth} />
                {filtered.recentTasks.map((task, index) => renderTask(task, activeOffset + index))}
              </box>
            ) : null}
            {taskCount === 0 ? (
              <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                {filter === 'all' ? 'No task records yet.' : `No ${filter} tasks.`}
              </text>
            ) : null}
          </scrollbox>
        </box>

        <box
          flexDirection="column"
          flexGrow={1}
          height={detailPaneHeight}
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          backgroundColor={theme.background}
        >
          <scrollbox
            height={Math.max(1, detailPaneHeight - 1)}
            scrollY
            focused={focus === 'detail'}
            style={{
              rootOptions: { backgroundColor: theme.background },
              contentOptions: { flexDirection: 'column', gap: 0, backgroundColor: theme.background },
            }}
          >
            {selectedTask ? (
              <TaskDetail
                task={selectedTask}
                preview={preview.taskId === selectedTask.id ? preview : emptyPreview}
                lineWidth={detailWidth}
                mode={detailMode}
                spinnerFrame={spinnerFrame}
                onModeChange={onDetailModeChange}
              />
            ) : (
              <EmptyDetail goal={goal} filter={filter} lineWidth={detailWidth} />
            )}
          </scrollbox>
        </box>
      </box>

      <box
        paddingX={2}
        paddingY={1}
        flexDirection="row"
        justifyContent="space-between"
        border={['top']}
        borderColor={theme.bodyBorder}
        backgroundColor={theme.header}
      >
        <box flexDirection="row" gap={2}>
          <FooterHint title="↑↓" label={focus === 'list' ? 'select' : 'scroll'} />
          <FooterHint title="Tab" label="focus pane" />
          <FooterHint title="F" label="filter" />
        </box>
        <box flexDirection="row" gap={2}>
          {!compact && selectedTask && (selectedTask.status === 'running' || selectedTask.status === 'pending') ? (
            <FooterHint title="C" label="cancel" />
          ) : null}
          {!compact ? <FooterHint title="O" label="live" /> : null}
          {!compact ? <FooterHint title="D" label="details" /> : null}
          <FooterHint title="Ctrl+B / Esc" label="close" />
        </box>
      </box>
    </PopupOverlay>
  )
}
