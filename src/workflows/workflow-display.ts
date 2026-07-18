import type { WorkflowMeta } from './workflow-types'

export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped'

export interface WorkflowAgentSnapshot {
  id: number
  label: string
  phase?: string
  prompt: string
  status: WorkflowAgentStatus
  resultPreview?: string
  error?: string
}

export interface WorkflowSnapshot {
  name: string
  description?: string
  phases: string[]
  currentPhase?: string
  logs: string[]
  agents: WorkflowAgentSnapshot[]
  agentCount: number
  runningCount: number
  doneCount: number
  errorCount: number
  durationMs?: number
  result?: unknown
}

export interface WorkflowDisplayOptions {
  maxAgents?: number
  maxLogs?: number
  showResultPreviews?: boolean
}

export function createWorkflowSnapshot(meta: WorkflowMeta): WorkflowSnapshot {
  return {
    name: meta.name,
    description: meta.description,
    phases: [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
  }
}

export function recomputeWorkflowSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  const runningCount = snapshot.agents.filter((agent) => agent.status === 'running').length
  const doneCount = snapshot.agents.filter((agent) => agent.status === 'done').length
  const errorCount = snapshot.agents.filter((agent) => agent.status === 'error').length
  return { ...snapshot, agentCount: snapshot.agents.length, runningCount, doneCount, errorCount }
}

export function renderWorkflowLines(snapshot: WorkflowSnapshot, options: WorkflowDisplayOptions = {}): string[] {
  const maxAgents = options.maxAgents ?? 8
  const maxLogs = options.maxLogs ?? 2
  const showResultPreviews = options.showResultPreviews ?? false
  const state =
    snapshot.errorCount > 0
      ? `, ${snapshot.errorCount} errors`
      : snapshot.runningCount > 0
        ? `, ${snapshot.runningCount} running`
        : ''
  const lines = [`Workflow: ${snapshot.name} (${snapshot.doneCount}/${snapshot.agentCount} done${state})`]

  const agentPhaseNames = snapshot.agents
    .map((agent) => agent.phase)
    .filter((phase): phase is string => Boolean(phase))
  const phaseNames = unique([
    ...snapshot.phases,
    ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
    ...agentPhaseNames,
  ])
  const rendered = new Set<WorkflowAgentSnapshot>()

  for (const phase of phaseNames) {
    const agents = snapshot.agents.filter((agent) => agent.phase === phase)
    if (agents.length === 0 && snapshot.currentPhase !== phase) {
      continue
    }
    for (const agent of agents) {
      rendered.add(agent)
    }
    const done = agents.filter((agent) => agent.status === 'done').length
    const running = agents.filter((agent) => agent.status === 'running').length
    const errors = agents.filter((agent) => agent.status === 'error').length
    const skipped = agents.filter((agent) => agent.status === 'skipped').length
    const complete = agents.length > 0 && done + errors + skipped === agents.length
    const marker = running > 0 || (!complete && snapshot.currentPhase === phase) ? '>' : complete ? 'x' : '-'
    lines.push(
      `  ${marker} ${phase} ${done}/${agents.length}${running ? `, ${running} running` : ''}${errors ? `, ${errors} errors` : ''}${skipped ? `, ${skipped} skipped` : ''}`,
    )

    const visibleAgents = agents.slice(-maxAgents)
    for (const agent of visibleAgents) {
      const result = showResultPreviews && agent.resultPreview ? ` - ${agent.resultPreview}` : ''
      lines.push(`    #${agent.id} ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${result}`)
    }
    if (agents.length > visibleAgents.length) {
      lines.push(`    ... ${agents.length - visibleAgents.length} earlier agents`)
    }
  }

  const unphased = snapshot.agents.filter((agent) => !rendered.has(agent))
  if (unphased.length) {
    lines.push('  Unphased')
    for (const agent of unphased.slice(-maxAgents)) {
      const result = showResultPreviews && agent.resultPreview ? ` - ${agent.resultPreview}` : ''
      lines.push(`    #${agent.id} ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${result}`)
    }
  }

  const visibleLogs = snapshot.logs.slice(-maxLogs)
  if (visibleLogs.length) {
    if (lines.length > 1) {
      lines.push('')
    }
    for (const log of visibleLogs) {
      lines.push(`  log: ${log}`)
    }
  }
  return lines
}

export function renderWorkflowText(
  snapshot: WorkflowSnapshot,
  completed = false,
  options: WorkflowDisplayOptions = {},
): string {
  const header = completed ? 'Workflow completed' : 'Workflow running'
  return [header, ...renderWorkflowLines(snapshot, options)].join('\n')
}

export function preview(value: unknown, max = 80): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) {
    return ''
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function statusIcon(status: WorkflowAgentStatus): string {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'done':
      return 'done'
    case 'error':
      return 'error'
    case 'skipped':
      return 'skipped'
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function shorten(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}
