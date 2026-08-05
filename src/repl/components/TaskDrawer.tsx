import { useEffect, useMemo, useState } from 'react'
import { TextAttributes } from '@opentui/core'

import type { TaskKind, TaskRecord, TaskStatus } from '../../tasks/task-types'
import { readTaskOutputTail } from '../../tasks/task-output'
import type { WorkflowAgentStatus, WorkflowSnapshot } from '../../workflows/workflow-display'
import { PopupOverlay } from '../../ui/components/PopupOverlay'
import { theme } from '../../ui/theme'
import { RESPONSE_SPINNER_INTERVAL_MS, responseSpinnerFrames } from '../../config'
import { readRawJsonlTailEntries } from '../../session/jsonl'
import { formatDuration, formatTaskTitle, isActiveTaskStatus, truncateTaskLine } from '../repl-format'

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

// ---------------------------------------------------------------------------
// Pure presentation helpers (exported for tests)
// ---------------------------------------------------------------------------

export function getStatusGlyph(status: TaskStatus, spinnerFrame?: string): string {
  switch (status) {
    case 'running':
      return spinnerFrame ?? '◉'
    case 'pending':
      return '◌'
    case 'completed':
      return '✓'
    case 'failed':
      return '×'
    case 'cancelled':
      return '◦'
  }
}

export function getKindBadge(kind: TaskKind): string {
  switch (kind) {
    case 'workflow':
      return 'wf'
    case 'agent':
      return 'ag'
    case 'shell':
      return 'sh'
  }
}

export interface TaskStatusCounts {
  running: number
  pending: number
  failed: number
  completed: number
}

export function summarizeTasks(tasks: readonly TaskRecord[]): TaskStatusCounts {
  const counts: TaskStatusCounts = { running: 0, pending: 0, failed: 0, completed: 0 }
  for (const task of tasks) {
    if (task.status === 'running') {
      counts.running += 1
    } else if (task.status === 'pending') {
      counts.pending += 1
    } else if (task.status === 'failed') {
      counts.failed += 1
    } else if (task.status === 'completed') {
      counts.completed += 1
    }
  }
  return counts
}

export function buildProgressBar(done: number, total: number, width: number): { filled: string; empty: string } {
  const safeWidth = Math.max(0, width)
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const filledCount = Math.round(safeWidth * ratio)
  return { filled: '█'.repeat(filledCount), empty: '░'.repeat(safeWidth - filledCount) }
}

export function formatClock(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function formatRelativeTime(value: string | undefined, now: number = Date.now()): string | null {
  if (!value) {
    return null
  }
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) {
    return null
  }
  const deltaSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`
  }
  const minutes = Math.floor(deltaSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  return `${Math.floor(hours / 24)}d ago`
}

export function baseName(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}

// ---------------------------------------------------------------------------
// Status colors
// ---------------------------------------------------------------------------

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

function getWorkflowAgentGlyph(status: WorkflowAgentStatus, spinnerFrame: string): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'error':
      return '×'
    case 'running':
      return spinnerFrame
    case 'queued':
      return '◌'
    case 'skipped':
      return '◦'
  }
}

// ---------------------------------------------------------------------------
// Task data helpers
// ---------------------------------------------------------------------------

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

/** Right-hand time column for a task row: elapsed for active work, relative finish time otherwise. */
function taskTimeColumn(task: TaskRecord): string {
  if (isActiveTaskStatus(task.status)) {
    if (task.status === 'pending' && !task.startedAt) {
      return 'queued'
    }
    return getElapsed(task) ?? ''
  }
  return formatRelativeTime(task.finishedAt) ?? ''
}

// ---------------------------------------------------------------------------
// Preview loading
// ---------------------------------------------------------------------------

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
        `→ ${String(entry.toolName ?? 'unknown')} ${compactValue(entry.input, maxWidth)}`,
        maxWidth,
      )
    case 'tool-result':
      return truncateTaskLine(
        `← ${String(entry.toolName ?? 'unknown')} ${compactValue(entry.output, maxWidth)}`,
        maxWidth,
      )
    case 'tool-error':
      return truncateTaskLine(
        `× ${String(entry.toolName ?? 'unknown')} ${compactValue(entry.error, maxWidth)}`,
        maxWidth,
      )
    case 'reasoning':
      return truncateTaskLine(`~ ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'assistant':
      return truncateTaskLine(`▸ ${compactValue(entry.content, maxWidth)}`, maxWidth)
    case 'user':
      return truncateTaskLine(`▸ ${compactValue(entry.content, maxWidth)}`, maxWidth)
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

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function RuleLine({ width }: { width: number }) {
  return (
    <text
      fg={theme.statusFg}
      wrapMode="none"
      content={'─'.repeat(Math.max(0, width))}
    />
  )
}

function SectionHeader({ label, count, width }: { label: string; count: number; width: number }) {
  const head = `${label} ${count}`
  return (
    <text wrapMode="none">
      <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{label}</span>
      <span fg={theme.statusFg}>{` ${count} `}</span>
      <span fg={theme.statusFg}>{'─'.repeat(Math.max(0, width - head.length - 1))}</span>
    </text>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span bg={color} fg="#0d0d0d" attributes={TextAttributes.BOLD}>
      {` ${label} `}
    </span>
  )
}

/** Inset "mini terminal" box used for output / transcript tails. */
function TailBox({ title, hint, path, lines, width }: {
  title: string
  hint?: string
  path?: string
  lines: string[]
  width: number
}) {
  if (lines.length === 0) {
    return null
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text wrapMode="none">
          <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{title}</span>
          {hint ? <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${hint}`}</span> : null}
        </text>
        {path ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} wrapMode="none" content={baseName(path)} />
        ) : null}
      </box>
      <box flexDirection="column" backgroundColor={theme.codeBlockBg} paddingX={1} marginTop={1}>
        {lines.map((line, index) => (
          <text key={`${title}-${index}`} fg={theme.codeBlockFg} wrapMode="none" content={line} />
        ))}
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Workflow detail
// ---------------------------------------------------------------------------

function WorkflowDetail({ snapshot, lineWidth, spinnerFrame }: {
  snapshot: WorkflowSnapshot
  lineWidth: number
  spinnerFrame: string
}) {
  const phaseNames = [
    ...new Set([
      ...snapshot.phases,
      ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
      ...snapshot.agents.map((agent) => agent.phase).filter((phase): phase is string => Boolean(phase)),
    ]),
  ]

  const bar = buildProgressBar(snapshot.doneCount, Math.max(snapshot.agentCount, 1), Math.min(28, Math.max(10, lineWidth - 38)))

  return (
    <box flexDirection="column" gap={0} marginTop={1}>
      <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Progress" />
      <box flexDirection="row" width="100%">
        <text wrapMode="none">
          <span fg={theme.successFg}>{bar.filled}</span>
          <span fg={theme.statusFg}>{bar.empty}</span>
          <span fg={theme.assistantFg}>{`  ${snapshot.doneCount}/${snapshot.agentCount} agents`}</span>
          {snapshot.runningCount > 0 ? <span fg={theme.headerAccent}>{` · ${snapshot.runningCount} running`}</span> : null}
          {snapshot.errorCount > 0 ? <span fg={theme.errorFg}>{` · ${snapshot.errorCount} failed`}</span> : null}
        </text>
      </box>

      {phaseNames.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Phases" />
          {phaseNames.slice(-6).map((phase) => {
            const agents = snapshot.agents.filter((agent) => agent.phase === phase)
            const done = agents.filter((agent) => agent.status === 'done').length
            const running = agents.filter((agent) => agent.status === 'running').length
            const errors = agents.filter((agent) => agent.status === 'error').length
            const skipped = agents.filter((agent) => agent.status === 'skipped').length
            const complete = agents.length > 0 && done + errors + skipped === agents.length
            const glyph = agents.length === 0
              ? '◌'
              : errors > 0
                ? '×'
                : running > 0 || snapshot.currentPhase === phase
                  ? spinnerFrame
                  : complete
                    ? '✓'
                    : '◌'
            const color = agents.length === 0
              ? theme.infoFg
              : errors > 0
                ? theme.errorFg
                : skipped > 0
                  ? theme.warningFg
                  : complete
                    ? theme.successFg
                    : running > 0
                      ? theme.headerAccent
                      : theme.infoFg
            const desc = agents.length === 0
              ? 'queued'
              : `${done}/${agents.length}${running ? ` · ${running} running` : ''}${errors ? ` · ${errors} failed` : ''}${skipped ? ` · ${skipped} skipped` : ''}`
            return (
              <text key={phase} wrapMode="none">
                <span fg={color} attributes={glyph === '×' ? TextAttributes.BOLD : undefined}>{glyph}</span>
                <span fg={theme.assistantFg}>{` ${phase}`.padEnd(12).slice(0, 12)}</span>
                <span fg={theme.statusFg}>{truncateTaskLine(desc, Math.max(8, lineWidth - 14))}</span>
              </text>
            )
          })}
        </box>
      ) : null}

      {snapshot.agents.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          <text wrapMode="none">
            <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{'Subagents '}</span>
            <span fg={theme.statusFg}>{'─ latest '.padEnd(Math.max(12, Math.min(24, lineWidth - 20)), '─')}</span>
          </text>
          {snapshot.agents.slice(-6).map((agent) => {
            const glyph = getWorkflowAgentGlyph(agent.status, spinnerFrame)
            const color = getWorkflowAgentStatusColor(agent.status)
            const desc = agent.error
              ? `failed: ${agent.error}`
              : agent.status === 'running'
                ? 'running'
                : (agent.resultPreview ?? agent.status)
            return (
              <text key={`${agent.id}-${agent.label}`} wrapMode="none">
                <span fg={color} attributes={agent.status === 'error' ? TextAttributes.BOLD : undefined}>{glyph}</span>
                <span fg={theme.statusFg}>{` #${agent.id}`.padEnd(5).slice(0, 5)}</span>
                <span fg={theme.assistantFg} attributes={agent.status === 'running' ? TextAttributes.BOLD : undefined}>
                  {`${truncateTaskLine(agent.label, 20).padEnd(20)}`}
                </span>
                <span fg={theme.statusFg}>{` ${truncateTaskLine(desc, Math.max(8, lineWidth - 30))}`}</span>
              </text>
            )
          })}
        </box>
      ) : null}

      {snapshot.logs.length > 0 ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Logs" />
          {snapshot.logs.slice(-3).map((log, index) => (
            <text key={`${index}-${log}`} fg={theme.statusFg} attributes={TextAttributes.DIM} wrapMode="none" content={truncateTaskLine(log, lineWidth)} />
          ))}
        </box>
      ) : null}
    </box>
  )
}

// ---------------------------------------------------------------------------
// Task detail pane
// ---------------------------------------------------------------------------

function TaskDetail({ task, preview, lineWidth, spinnerFrame }: {
  task: TaskRecord
  preview: TaskPreview
  lineWidth: number
  spinnerFrame: string
}) {
  const workflowSnapshot = getWorkflowSnapshot(task)
  const progress = task.error ?? task.progressSummary
  const statusLabel = task.status.toUpperCase()
  const elapsed = getElapsed(task)
  const startedClock = formatClock(task.startedAt)
  const contextParts = [getKindBadge(task.kind), `id ${task.id.slice(0, 6)}`]
  if (startedClock) {
    contextParts.push(`started ${startedClock}`)
  }
  const role = task.metadata?.agentRole
  if (typeof role === 'string') {
    contextParts.push(role)
  }

  const titleWidth = Math.max(12, lineWidth - statusLabel.length - (elapsed ? elapsed.length : 0) - 6)
  const outputLines = preview.outputLines.slice(-5)
  const transcriptLines = preview.transcriptLines.slice(-5)
  const cancellable = isActiveTaskStatus(task.status)

  return (
    <box flexDirection="column" gap={0}>
      <text wrapMode="none">
        <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>
          {truncateTaskLine(formatTaskTitle(task.title), titleWidth)}
        </span>
        <span>{'  '}</span>
        <Chip label={statusLabel} color={getStatusColor(task.status)} />
        {elapsed ? <span fg={theme.assistantFg}>{`  ${elapsed}`}</span> : null}
      </text>

      <text
        fg={theme.statusFg}
        attributes={TextAttributes.DIM}
        wrapMode="none"
        content={truncateTaskLine(contextParts.join(' · '), lineWidth)}
      />

      {progress ? (
        <text
          fg={task.error ? theme.errorFg : theme.assistantFg}
          wrapMode="none"
          content={truncateTaskLine(progress, lineWidth)}
        />
      ) : null}

      {workflowSnapshot ? (
        <WorkflowDetail snapshot={workflowSnapshot} lineWidth={lineWidth} spinnerFrame={spinnerFrame} />
      ) : null}

      <TailBox
        title="Output"
        hint="· tail"
        path={task.outputPath}
        lines={outputLines}
        width={lineWidth}
      />
      <TailBox
        title="Transcript"
        hint="· tail"
        path={task.transcriptPath}
        lines={transcriptLines}
        width={lineWidth}
      />

      {preview.error ? (
        <text fg={theme.errorFg} wrapMode="none" content={truncateTaskLine(preview.error, lineWidth)} />
      ) : null}

      {task.outputPath ? (
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          wrapMode="none"
          content={truncateTaskLine(`output ${task.outputPath}`, lineWidth)}
        />
      ) : null}
      {task.transcriptPath ? (
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          wrapMode="none"
          content={truncateTaskLine(`transcript ${task.transcriptPath}`, lineWidth)}
        />
      ) : null}

      {cancellable ? (
        <text wrapMode="none" marginTop={1}>
          <span fg={theme.headerAccent} attributes={TextAttributes.BOLD}>x</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{' cancel task'}</span>
        </text>
      ) : null}
    </box>
  )
}

function EmptyDetail({ goal, lineWidth }: { goal: string | null; lineWidth: number }) {
  return (
    <box flexDirection="column" gap={0}>
      {goal ? (
        <box flexDirection="column">
          <text fg={theme.headingFg} attributes={TextAttributes.BOLD} content="Goal" />
          <text fg={theme.assistantFg} wrapMode="none" content={truncateTaskLine(goal, lineWidth)} />
        </box>
      ) : null}
      <text fg={theme.headingFg} marginTop={goal ? 1 : 0} content="No background tasks yet." />
      <text
        fg={theme.statusFg}
        attributes={TextAttributes.DIM}
        wrapMode="none"
        content={truncateTaskLine('Work the agent runs in the background will appear here.', lineWidth)}
      />
    </box>
  )
}

// ---------------------------------------------------------------------------
// Task list rows
// ---------------------------------------------------------------------------

function TaskRow({ task, selected, tone, width, spinnerFrame }: {
  task: TaskRecord
  selected: boolean
  tone: 'active' | 'recent'
  width: number
  spinnerFrame: string
}) {
  const glyph = getStatusGlyph(task.status, spinnerFrame)
  const glyphColor = getStatusColor(task.status)
  const badge = getKindBadge(task.kind)
  const time = taskTimeColumn(task).slice(0, 12)
  const summary = task.error ?? task.progressSummary

  const prefixLength = 7 // bar + space + glyph + space + badge + space
  const titleWidth = Math.max(4, width - prefixLength - time.length - 1)
  const title = truncateTaskLine(formatTaskTitle(task.title), titleWidth)
  const pad = ' '.repeat(Math.max(1, width - prefixLength - title.length - time.length))

  const titleFg = selected ? theme.selectedFg : tone === 'active' ? theme.headingFg : theme.statusFg
  const titleAttrs = selected || tone === 'active' ? TextAttributes.BOLD : TextAttributes.DIM

  return (
    <box
      flexDirection="column"
      minHeight={summary ? 2 : 1}
      backgroundColor={selected ? theme.selectedBg : undefined}
    >
      <text wrapMode="none">
        <span fg={theme.selectedFg}>{selected ? '▌' : ' '}</span>
        <span>{' '}</span>
        <span fg={glyphColor} attributes={task.status === 'failed' ? TextAttributes.BOLD : undefined}>{glyph}</span>
        <span>{' '}</span>
        <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{badge}</span>
        <span>{' '}</span>
        <span fg={titleFg} attributes={titleAttrs}>{title}</span>
        <span>{pad}</span>
        <span fg={task.status === 'running' ? theme.headerAccent : theme.statusFg} attributes={task.status === 'running' ? undefined : TextAttributes.DIM}>
          {time}
        </span>
      </text>
      {summary ? (
        <text wrapMode="none">
          <span>{'   '}</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{'└ '}</span>
          <span fg={selected ? theme.assistantFg : theme.statusFg} attributes={selected ? undefined : TextAttributes.DIM}>
            {truncateTaskLine(summary, Math.max(8, width - 5))}
          </span>
        </text>
      ) : null}
    </box>
  )
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

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
  const counts = useMemo(() => summarizeTasks(tasks), [tasks])
  const bodyHeight = getTaskBodyHeight(terminalHeight, taskCount, Boolean(goal))
  const panelWidth = Math.min(116, Math.max(1, terminalWidth - 2))
  // Rounded frame border (2) + inner horizontal padding (2)
  const contentWidth = Math.max(24, panelWidth - 4)
  const wide = panelWidth >= 92
  const leftWidth = wide ? Math.min(44, Math.max(32, Math.floor(contentWidth * 0.38))) : contentWidth
  const leftPaneHeight = wide ? bodyHeight : Math.max(4, Math.floor(bodyHeight * 0.45))
  const detailPaneHeight = wide ? bodyHeight : Math.max(1, bodyHeight - leftPaneHeight - 1)
  // Left pane: 1 col right border + 1 col padding
  const listWidth = Math.max(20, leftWidth - 2)
  const detailWidth = wide
    ? Math.max(28, contentWidth - leftWidth - 2)
    : Math.max(24, contentWidth)
  const normalizedSelectedIndex = taskCount > 0
    ? Math.min(Math.max(selectedTaskIndex, 0), taskCount - 1)
    : -1
  const selectedTask = normalizedSelectedIndex >= 0 ? tasks[normalizedSelectedIndex] ?? null : null
  const [preview, setPreview] = useState<TaskPreview>(emptyPreview)
  const [spinnerFrame, setSpinnerFrame] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerFrame((current) => (current + 1) % responseSpinnerFrames.length)
    }, RESPONSE_SPINNER_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const spinnerGlyph = responseSpinnerFrames[spinnerFrame] ?? '◉'

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
          readTranscriptLines(selectedTask, 8, detailWidth),
        ])
        if (cancelled) {
          return
        }
        setPreview({
          taskId: selectedTask.id,
          outputLines: formatPreviewLines(output, 5, detailWidth - 4),
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

  return (
    <PopupOverlay size="xlarge" zIndex={90} onClose={onClose} frameTitle=" Background tasks ">
      <box flexDirection="column" paddingX={1} width="100%">
        {/* header: live counts + goal */}
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text wrapMode="none">
            <span fg={theme.headerAccent}>{spinnerGlyph}</span>
            <span fg={theme.assistantFg}>{` ${counts.running} running`}</span>
            <span>{'   '}</span>
            <span fg={theme.infoFg}>{'◌'}</span>
            <span fg={theme.assistantFg}>{` ${counts.pending} queued`}</span>
            <span>{'   '}</span>
            <span fg={theme.errorFg} attributes={TextAttributes.BOLD}>{'×'}</span>
            <span fg={theme.assistantFg}>{` ${counts.failed} failed`}</span>
            <span>{'   '}</span>
            <span fg={theme.successFg}>{'✓'}</span>
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${counts.completed} done`}</span>
          </text>
          {goal ? (
            <text wrapMode="none">
              <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{'goal: '}</span>
              <span fg={theme.assistantFg}>{truncateTaskLine(goal, Math.max(10, contentWidth - 44))}</span>
            </text>
          ) : null}
        </box>

        <RuleLine width={contentWidth} />

        <box flexDirection={wide ? 'row' : 'column'} width="100%">
          {/* task list */}
          <box
            flexDirection="column"
            width={wide ? leftWidth : '100%'}
            height={leftPaneHeight}
            border={wide ? ['right'] : undefined}
            paddingRight={wide ? 1 : 0}
            style={{ borderColor: theme.bodyBorder }}
          >
            <scrollbox
              scrollY
              style={{
                rootOptions: {
                  flexGrow: 1,
                  flexShrink: 1,
                  minHeight: 0,
                  backgroundColor: theme.panel,
                },
                contentOptions: {
                  flexDirection: 'column',
                  gap: 0,
                  backgroundColor: theme.panel,
                },
              }}
            >
              {taskCount === 0 ? (
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No background tasks yet." />
              ) : null}
              {activeTasks.length > 0 ? (
                <>
                  <SectionHeader label="ACTIVE" count={activeTasks.length} width={listWidth} />
                  {activeTasks.map((task, index) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      selected={index === normalizedSelectedIndex}
                      tone="active"
                      width={listWidth}
                      spinnerFrame={spinnerGlyph}
                    />
                  ))}
                </>
              ) : taskCount > 0 ? (
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No active tasks." />
              ) : null}
              {activeTasks.length > 0 && recentTasks.length > 0 ? <text content=" " /> : null}
              {recentTasks.length > 0 ? (
                <>
                  <SectionHeader label="RECENT" count={recentTasks.length} width={listWidth} />
                  {recentTasks.map((task, index) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      selected={activeTasks.length + index === normalizedSelectedIndex}
                      tone="recent"
                      width={listWidth}
                      spinnerFrame={spinnerGlyph}
                    />
                  ))}
                </>
              ) : null}
            </scrollbox>
          </box>

          {/* detail pane */}
          <box
            flexDirection="column"
            flexGrow={1}
            height={detailPaneHeight}
            paddingLeft={wide ? 2 : 0}
            paddingTop={wide ? 0 : 1}
          >
            <scrollbox
              scrollY
              focused
              style={{
                rootOptions: {
                  flexGrow: 1,
                  flexShrink: 1,
                  minHeight: 0,
                  backgroundColor: theme.panel,
                },
                contentOptions: {
                  flexDirection: 'column',
                  gap: 0,
                  backgroundColor: theme.panel,
                },
              }}
            >
              {selectedTask ? (
                <TaskDetail
                  task={selectedTask}
                  preview={preview.taskId === selectedTask.id ? preview : emptyPreview}
                  lineWidth={detailWidth}
                  spinnerFrame={spinnerGlyph}
                />
              ) : (
                <EmptyDetail goal={goal} lineWidth={detailWidth} />
              )}
            </scrollbox>
          </box>
        </box>

        <RuleLine width={contentWidth} />

        {/* footer */}
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text wrapMode="none">
            <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{'↑↓'}</span>
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{' navigate'}</span>
            <span>{'   '}</span>
            <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{'home/end'}</span>
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{' jump'}</span>
            {selectedTask && isActiveTaskStatus(selectedTask.status) ? (
              <>
                <span>{'   '}</span>
                <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{'x'}</span>
                <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{' cancel'}</span>
              </>
            ) : null}
          </text>
          <text wrapMode="none">
            <span fg={theme.headingFg} attributes={TextAttributes.BOLD}>{'esc /^b'}</span>
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{' close'}</span>
          </text>
        </box>
      </box>
    </PopupOverlay>
  )
}
