import { useEffect, useMemo, useState } from 'react'
import { TextAttributes } from '@opentui/core'

import { RESPONSE_SPINNER_INTERVAL_MS, responseSpinnerFrames } from '../../config'
import type { TaskRecord, TaskStatus } from '../../tasks/task-types'
import { readTaskOutputTail } from '../../tasks/task-output'
import type { WorkflowAgentStatus, WorkflowSnapshot } from '../../workflows/workflow-display'
import { PopupOverlay } from '../../ui/components/PopupOverlay'
import { theme } from '../../ui/theme'
import { readRawJsonlTailEntries } from '../../session/jsonl'
import { formatDuration, formatTaskTitle, truncateTaskLine } from '../repl-format'
import {
  filterTaskDrawerTasks,
  isTaskCancellable,
  taskDrawerDetailTabs,
  taskDrawerFilters,
  type TaskDrawerDetailTab,
  type TaskDrawerFilter,
  type TaskDrawerPane,
} from '../task-drawer-model'

type ActivityTone = 'tool' | 'success' | 'error' | 'reasoning' | 'assistant' | 'prompt' | 'muted'

interface ActivityLine {
  marker: string
  label: string
  content: string
  tone: ActivityTone
}

interface TaskPreview {
  taskId: string | null
  outputLines: string[]
  transcriptLines: ActivityLine[]
  error: string | null
}

const emptyPreview: TaskPreview = {
  taskId: null,
  outputLines: [],
  transcriptLines: [],
  error: null,
}

function getTaskBodyHeight(terminalHeight: number, taskCount: number, hasGoal: boolean): number {
  const desiredHeight = Math.min(28, Math.max(hasGoal ? 16 : 14, taskCount * 3 + 8))
  const maxHeight = Math.max(10, terminalHeight - 10)
  return Math.min(desiredHeight, maxHeight)
}

function FooterHint({ title, label }: { title: string; label: string }) {
  return (
    <text>
      <strong><span fg={theme.userFg}>{title}</span></strong>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${label}`}</span>
    </text>
  )
}

function StatusChip({ marker, label, color, backgroundColor }: {
  marker: string
  label: string
  color: string
  backgroundColor: string
}) {
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} backgroundColor={backgroundColor}>
      <text fg={color} content={marker} />
      <text><strong><span fg={color}>{label}</span></strong></text>
    </box>
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

function getStatusMarker(status: TaskStatus, spinnerFrame: string = responseSpinnerFrames[0]): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'failed':
      return '×'
    case 'cancelled':
      return '–'
    case 'running':
      return spinnerFrame
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

function formatTranscriptEntry(entry: Record<string, unknown>, maxWidth: number): ActivityLine | null {
  const type = typeof entry.type === 'string' ? entry.type : 'event'
  switch (type) {
    case 'tool-call':
      return {
        marker: '→',
        label: String(entry.toolName ?? 'tool'),
        content: compactValue(entry.input, maxWidth),
        tone: 'tool',
      }
    case 'tool-result':
      return {
        marker: '←',
        label: String(entry.toolName ?? 'tool'),
        content: compactValue(entry.output, maxWidth),
        tone: 'success',
      }
    case 'tool-error':
      return {
        marker: '×',
        label: String(entry.toolName ?? 'tool'),
        content: compactValue(entry.error, maxWidth),
        tone: 'error',
      }
    case 'reasoning':
      return {
        marker: '~',
        label: 'reasoning',
        content: compactValue(entry.content, maxWidth),
        tone: 'reasoning',
      }
    case 'assistant':
      return {
        marker: '▸',
        label: 'assistant',
        content: compactValue(entry.content, maxWidth),
        tone: 'assistant',
      }
    case 'user':
      return {
        marker: '›',
        label: 'prompt',
        content: compactValue(entry.content, maxWidth),
        tone: 'prompt',
      }
    case 'system':
      return null
    default:
      return {
        marker: '·',
        label: type,
        content: compactValue(entry, maxWidth),
        tone: 'muted',
      }
  }
}

async function readTranscriptLines(task: TaskRecord, maxLines: number, maxWidth: number): Promise<ActivityLine[]> {
  if (!task.transcriptPath) {
    return []
  }

  try {
    const entries = await readRawJsonlTailEntries<Record<string, unknown>>(task.transcriptPath, maxLines * 3)
    return entries
      .map((entry) => formatTranscriptEntry(entry, maxWidth))
      .filter((line): line is ActivityLine => Boolean(line))
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
  const progressWidth = Math.max(8, Math.min(24, lineWidth - 22))
  const completedWidth = snapshot.agentCount > 0
    ? Math.round((snapshot.doneCount / snapshot.agentCount) * progressWidth)
    : 0
  const progressBar = `${'█'.repeat(completedWidth)}${'░'.repeat(Math.max(0, progressWidth - completedWidth))}`

  return (
    <box flexDirection="column" gap={0} marginTop={1}>
      <text><strong><span fg={theme.headingFg}>WORKFLOW PROGRESS</span></strong></text>
      <box flexDirection="row" gap={1}>
        <text fg={theme.headerAccent} content={progressBar} />
        <text
          fg={theme.statusFg}
          content={truncateTaskLine(
            `${snapshot.doneCount}/${snapshot.agentCount} done · ${snapshot.runningCount} running · ${snapshot.errorCount} failed`,
            Math.max(12, lineWidth - progressWidth - 1),
          )}
        />
      </box>

      {phaseNames.length > 0 ? (
        <>
          <text><strong><span fg={theme.headingFg}>PHASES</span></strong></text>
          {phaseNames.slice(-8).map((phase) => {
            const agents = snapshot.agents.filter((agent) => agent.phase === phase)
            const done = agents.filter((agent) => agent.status === 'done').length
            const running = agents.filter((agent) => agent.status === 'running').length
            const errors = agents.filter((agent) => agent.status === 'error').length
            const skipped = agents.filter((agent) => agent.status === 'skipped').length
            const complete = done + errors + skipped === agents.length
            const marker = errors > 0 ? '×' : running > 0 || snapshot.currentPhase === phase ? '●' : complete ? '✓' : '○'
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
          <text><strong><span fg={theme.headingFg}>SUBAGENTS</span></strong></text>
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
          <text><strong><span fg={theme.headingFg}>LATEST</span></strong></text>
          {snapshot.logs.slice(-4).map((log, index) => (
            <text key={`${index}-${log}`} fg={theme.statusFg} content={truncateTaskLine(log, lineWidth)} />
          ))}
        </>
      ) : null}
    </box>
  )
}

function getActivityToneColor(tone: ActivityTone): string {
  switch (tone) {
    case 'success':
      return theme.successFg
    case 'error':
      return theme.errorFg
    case 'reasoning':
      return theme.headerAccent
    case 'assistant':
      return theme.assistantFg
    case 'prompt':
      return theme.infoFg
    case 'tool':
      return theme.toolFg
    case 'muted':
      return theme.statusFg
  }
}

function ActivityTimeline({ lines, lineWidth }: { lines: ActivityLine[]; lineWidth: number }) {
  if (lines.length === 0) {
    return (
      <box flexDirection="column" gap={0} marginTop={1}>
        <text><strong><span fg={theme.headingFg}>LIVE ACTIVITY</span></strong></text>
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Waiting for task activity…" />
      </box>
    )
  }

  const labelWidth = Math.min(14, Math.max(8, Math.floor(lineWidth * 0.22)))
  const contentWidth = Math.max(12, lineWidth - labelWidth - 4)

  return (
    <box flexDirection="column" gap={0} marginTop={1}>
      <text><strong><span fg={theme.headingFg}>LIVE ACTIVITY</span></strong></text>
      {lines.map((line, index) => {
        const color = getActivityToneColor(line.tone)
        return (
          <box key={`${line.label}-${index}`} flexDirection="row" gap={1}>
            <text fg={color} content={line.marker} />
            <text
              fg={color}
              attributes={TextAttributes.BOLD}
              content={truncateTaskLine(line.label, labelWidth).padEnd(labelWidth)}
            />
            <text fg={theme.assistantFg} content={truncateTaskLine(line.content, contentWidth)} />
          </box>
        )
      })}
    </box>
  )
}

function OutputDetail({ task, preview, lineWidth }: {
  task: TaskRecord
  preview: TaskPreview
  lineWidth: number
}) {
  return (
    <box flexDirection="column" gap={0}>
      <box
        flexDirection="column"
        minHeight={6}
        border
        borderStyle="rounded"
        borderColor={theme.bodyBorder}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.codeBlockBg}
      >
        <text><strong><span fg={theme.codeBlockAccent}>OUTPUT TAIL</span></strong></text>
        {preview.outputLines.length > 0 ? (
          preview.outputLines.map((line, index) => (
            <text key={`${index}-${line}`} fg={theme.codeBlockFg} content={truncateTaskLine(line, lineWidth - 4)} />
          ))
        ) : (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No output captured yet." />
        )}
      </box>
      {task.outputPath ? (
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={truncateTaskLine(task.outputPath, lineWidth)}
        />
      ) : null}
    </box>
  )
}

function DetailValue({ label, value, lineWidth }: { label: string; value: string; lineWidth: number }) {
  const labelWidth = 12
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.statusFg} content={label.padEnd(labelWidth)} />
      <text fg={theme.assistantFg} content={truncateTaskLine(value, Math.max(12, lineWidth - labelWidth - 1))} />
    </box>
  )
}

function MetadataDetail({ task, lineWidth }: { task: TaskRecord; lineWidth: number }) {
  const role = typeof task.metadata?.agentRole === 'string' ? task.metadata.agentRole : null
  return (
    <box flexDirection="column" gap={0}>
      <text><strong><span fg={theme.headingFg}>TASK DETAILS</span></strong></text>
      <DetailValue label="ID" value={task.id} lineWidth={lineWidth} />
      <DetailValue label="KIND" value={task.kind} lineWidth={lineWidth} />
      <DetailValue label="STATUS" value={task.status} lineWidth={lineWidth} />
      {role ? <DetailValue label="ROLE" value={role} lineWidth={lineWidth} /> : null}
      <DetailValue label="CREATED" value={task.createdAt} lineWidth={lineWidth} />
      {task.startedAt ? <DetailValue label="STARTED" value={task.startedAt} lineWidth={lineWidth} /> : null}
      {task.finishedAt ? <DetailValue label="FINISHED" value={task.finishedAt} lineWidth={lineWidth} /> : null}
      {task.outputPath ? <DetailValue label="OUTPUT" value={task.outputPath} lineWidth={lineWidth} /> : null}
      {task.transcriptPath ? <DetailValue label="TRANSCRIPT" value={task.transcriptPath} lineWidth={lineWidth} /> : null}
    </box>
  )
}

function TaskDetail({
  task,
  preview,
  lineWidth,
  detailTab,
}: {
  task: TaskRecord
  preview: TaskPreview
  lineWidth: number
  detailTab: TaskDrawerDetailTab
}) {
  const workflowSnapshot = getWorkflowSnapshot(task)
  const progress = task.error ?? task.progressSummary

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between" width="100%" gap={2}>
        <text><strong><span fg={theme.headingFg}>{truncateTaskLine(formatTaskTitle(task.title), Math.max(12, lineWidth - 18))}</span></strong></text>
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.background}>
          <text><strong><span fg={getStatusColor(task.status)}>{`● ${task.status.toUpperCase()}`}</span></strong></text>
        </box>
      </box>

      <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={truncateTaskLine(`${metadataText(task)} · ${task.id}`, lineWidth)} />

      {progress ? (
        <box marginTop={1} paddingLeft={1} paddingRight={1} backgroundColor={task.error ? theme.errorBg : theme.reasoningBg}>
          <text fg={task.error ? theme.errorFg : theme.assistantFg} content={truncateTaskLine(progress, lineWidth - 2)} />
        </box>
      ) : null}

      <box flexDirection="row" gap={2} marginTop={1} border={['bottom']} borderColor={theme.bodyBorder}>
        {taskDrawerDetailTabs.map((tab) => (
          <text key={tab}>
            {tab === detailTab ? (
              <strong><span fg={theme.headerAccent}>{tab.toUpperCase()}</span></strong>
            ) : (
              <span fg={theme.statusFg}>{tab.toUpperCase()}</span>
            )}
          </text>
        ))}
      </box>

      <box flexDirection="column" marginTop={1}>
        {detailTab === 'activity' ? (
          <>
            {workflowSnapshot ? <WorkflowDetail snapshot={workflowSnapshot} lineWidth={lineWidth} /> : null}
            <ActivityTimeline lines={preview.transcriptLines} lineWidth={lineWidth} />
          </>
        ) : detailTab === 'output' ? (
          <OutputDetail task={task} preview={preview} lineWidth={lineWidth} />
        ) : (
          <MetadataDetail task={task} lineWidth={lineWidth} />
        )}
      </box>

      {preview.error ? <text fg={theme.errorFg} content={truncateTaskLine(preview.error, lineWidth)} /> : null}
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
  filter,
  focusPane,
  detailTab,
  goal,
  terminalWidth,
  terminalHeight,
  onClose,
}: {
  activeTasks: TaskRecord[]
  recentTasks: TaskRecord[]
  selectedTaskIndex: number
  filter: TaskDrawerFilter
  focusPane: TaskDrawerPane
  detailTab: TaskDrawerDetailTab
  goal: string | null
  terminalWidth: number
  terminalHeight: number
  onClose: () => void
}) {
  const tasks = useMemo(
    () => filterTaskDrawerTasks(activeTasks, recentTasks, filter),
    [activeTasks, filter, recentTasks],
  )
  const taskCount = tasks.length
  const bodyHeight = getTaskBodyHeight(terminalHeight, taskCount, Boolean(goal))
  const panelWidth = Math.min(116, Math.max(1, terminalWidth - 2))
  const wide = panelWidth >= 92
  const leftWidth = wide ? Math.min(40, Math.max(32, Math.floor(panelWidth * 0.35))) : Math.max(24, panelWidth - 6)
  const leftPaneHeight = wide ? bodyHeight : Math.max(6, Math.floor(bodyHeight * 0.44))
  const detailPaneHeight = wide ? bodyHeight : Math.max(1, bodyHeight - leftPaneHeight - 1)
  const listWidth = Math.max(24, leftWidth - 5)
  const detailWidth = wide
    ? Math.max(30, panelWidth - leftWidth - 7)
    : Math.max(24, panelWidth - 6)
  const normalizedSelectedIndex = taskCount > 0
    ? Math.min(Math.max(selectedTaskIndex, 0), taskCount - 1)
    : -1
  const selectedTask = normalizedSelectedIndex >= 0 ? tasks[normalizedSelectedIndex] ?? null : null
  const [preview, setPreview] = useState<TaskPreview>(emptyPreview)
  const [spinnerFrameIndex, setSpinnerFrameIndex] = useState(0)

  useEffect(() => {
    if (!activeTasks.some((task) => task.status === 'running')) {
      setSpinnerFrameIndex(0)
      return
    }

    const intervalId = setInterval(() => {
      setSpinnerFrameIndex((current) => (current + 1) % responseSpinnerFrames.length)
    }, RESPONSE_SPINNER_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [activeTasks])

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
  const allTaskCount = activeTasks.length + recentTasks.length
  const visibleActiveTasks = filter === 'history' ? [] : activeTasks
  const visibleRecentTasks = filter === 'active' ? [] : recentTasks
  const spinnerFrame = responseSpinnerFrames[spinnerFrameIndex] ?? responseSpinnerFrames[0]

  const renderTask = (task: TaskRecord, tone: 'active' | 'recent') => {
    const index = tasks.findIndex((candidate) => candidate.id === task.id)
    const selected = index === normalizedSelectedIndex
    const summary = task.progressSummary ?? task.error
    const elapsed = getElapsed(task)
    const statusColor = getStatusColor(task.status)
    const titleColor = selected ? theme.selectedFg : tone === 'active' ? theme.headingFg : theme.assistantFg

    return (
      <box
        key={task.id}
        flexDirection="column"
        minHeight={summary ? 3 : 2}
        paddingLeft={1}
        paddingRight={1}
        border={selected ? ['left'] : undefined}
        borderColor={selected ? theme.headerAccent : undefined}
        backgroundColor={selected ? theme.selectedBg : theme.background}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1} flexShrink={1}>
            <text fg={statusColor} content={getStatusMarker(task.status, spinnerFrame)} />
            <text><strong><span fg={titleColor}>{truncateTaskLine(formatTaskTitle(task.title), Math.max(12, listWidth - 9))}</span></strong></text>
          </box>
          {elapsed ? <text fg={theme.statusFg} content={truncateTaskLine(elapsed, 7)} /> : null}
        </box>
        <text
          fg={statusColor}
          attributes={TextAttributes.DIM}
          content={truncateTaskLine(`${task.kind.toUpperCase()} · ${task.status}`, listWidth - 1)}
        />
        {summary ? (
          <text
            fg={selected ? theme.assistantFg : theme.statusFg}
            attributes={TextAttributes.DIM}
            content={truncateTaskLine(summary, listWidth - 1)}
          />
        ) : null}
      </box>
    )
  }

  return (
    <PopupOverlay size="xlarge" zIndex={90} onClose={onClose} framed centered>
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.header}
        border={['bottom']}
        borderColor={theme.headerBorder}
      >
        <box flexDirection="column" flexShrink={1}>
          <text><strong><span fg={theme.headingFg}>Background tasks</span></strong></text>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Live workspace activity" />
        </box>
        {wide ? (
          <box flexDirection="row" alignItems="center" gap={1}>
            <StatusChip marker={spinnerFrame} label={`${runningCount} RUNNING`} color={theme.headerAccent} backgroundColor={theme.reasoningBg} />
            <StatusChip marker="○" label={`${pendingCount} QUEUED`} color={theme.infoFg} backgroundColor={theme.systemBg} />
            <StatusChip marker="✓" label={`${recentTasks.length} RECENT`} color={theme.successFg} backgroundColor={theme.successBg} />
          </box>
        ) : (
          <text fg={theme.statusFg} content={`${runningCount} run · ${pendingCount} queued`} />
        )}
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
      </box>

      {goal ? (
        <box
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.background}
          border={['bottom']}
          borderColor={theme.bodyBorder}
        >
          <text><strong><span fg={theme.headerAccent}>ACTIVE GOAL</span></strong></text>
          <text fg={theme.assistantFg} content={truncateTaskLine(goal, Math.max(24, panelWidth - 8))} />
        </box>
      ) : null}

      <box
        flexDirection={wide ? 'row' : 'column'}
        width="100%"
        backgroundColor={theme.background}
      >
        <box
          flexDirection="column"
          width={wide ? leftWidth : '100%'}
          height={leftPaneHeight}
          border={wide ? ['right'] : undefined}
          borderColor={focusPane === 'list' ? theme.headerAccent : theme.bodyBorder}
          backgroundColor={theme.background}
        >
          <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1} border={['bottom']} borderColor={theme.bodyBorder}>
            {taskDrawerFilters.map((candidate) => {
              const count = candidate === 'all'
                ? allTaskCount
                : candidate === 'active'
                  ? activeTasks.length
                  : recentTasks.length
              return (
                <text key={candidate}>
                  {candidate === filter ? (
                    <strong><span fg={theme.headerAccent}>{`${candidate.toUpperCase()} ${count}`}</span></strong>
                  ) : (
                    <span fg={theme.statusFg}>{`${candidate.toUpperCase()} ${count}`}</span>
                  )}
                </text>
              )
            })}
          </box>

          <scrollbox
            height={Math.max(1, leftPaneHeight - 2)}
            scrollY
            focused={focusPane === 'list'}
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
              <text
                fg={theme.statusFg}
                attributes={TextAttributes.DIM}
                content={filter === 'active' ? 'No active tasks.' : filter === 'history' ? 'No task history.' : 'No task records yet.'}
              />
            ) : null}
            {visibleActiveTasks.length > 0 ? (
              <>
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`ACTIVE ${visibleActiveTasks.length}`} />
                {visibleActiveTasks.map((task) => renderTask(task, 'active'))}
              </>
            ) : null}
            {visibleRecentTasks.length > 0 ? (
              <>
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`HISTORY ${visibleRecentTasks.length}`} />
                {visibleRecentTasks.map((task) => renderTask(task, 'recent'))}
              </>
            ) : null}
          </scrollbox>
        </box>

        <box
          flexDirection="column"
          flexGrow={1}
          paddingLeft={wide ? 2 : 1}
          paddingRight={1}
          paddingTop={wide ? 0 : 1}
          backgroundColor={theme.background}
        >
          <scrollbox
            height={detailPaneHeight}
            scrollY
            focused={focusPane === 'detail'}
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
                detailTab={detailTab}
              />
            ) : (
              <GoalDetail goal={goal} lineWidth={detailWidth} />
            )}
          </scrollbox>
        </box>
      </box>

      <box
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={theme.header}
        border={['top']}
        borderColor={theme.headerBorder}
      >
        <box flexDirection="row" gap={2}>
          <FooterHint title="↑↓" label={focusPane === 'list' ? 'select' : 'scroll'} />
          <FooterHint title="Tab" label="pane" />
          <FooterHint title="F" label="filter" />
          {wide ? <FooterHint title="Enter" label="expand" /> : null}
        </box>
        <box flexDirection="row" gap={2}>
          {isTaskCancellable(selectedTask) ? <FooterHint title="C" label="cancel" /> : null}
          <FooterHint title="A/O/D" label="view" />
          <FooterHint title="Ctrl+B/Esc" label="close" />
        </box>
      </box>
    </PopupOverlay>
  )
}
