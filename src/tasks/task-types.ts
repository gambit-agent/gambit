export type TaskKind = 'shell' | 'agent' | 'workflow'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface TaskRecord {
  id: string
  kind: TaskKind
  title: string
  status: TaskStatus
  background: boolean
  createdAt: string
  startedAt?: string
  finishedAt?: string
  progressSummary?: string
  outputPath?: string
  transcriptPath?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface CreateTaskInput {
  kind: TaskKind
  title: string
  background: boolean
  status?: TaskStatus
  startedAt?: string
  finishedAt?: string
  progressSummary?: string
  outputPath?: string
  transcriptPath?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface UpdateTaskInput {
  kind?: TaskKind
  title?: string
  status?: TaskStatus
  background?: boolean
  startedAt?: string | null
  finishedAt?: string | null
  progressSummary?: string | null
  outputPath?: string | null
  transcriptPath?: string | null
  error?: string | null
  metadata?: Record<string, unknown> | null
}
