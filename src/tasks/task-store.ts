import { generateId } from '../lib/id'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import {
  appendJsonlEntry,
  isRecord,
  readJsonlEntries,
  writeJsonlEntries,
} from '../session/jsonl'
import {
  getTaskDirectory,
  getTaskOutputPath,
  getTaskStorePath,
  getTaskTranscriptPath,
} from '../session/session-paths'
import type { CreateTaskInput, TaskRecord, TaskStatus, UpdateTaskInput } from './task-types'

const interruptedTaskSummary = 'Task was interrupted when Gambit exited.'
const abandonedTaskSummary = 'Task did not start before Gambit exited.'

function isTaskKind(value: unknown): value is TaskRecord['kind'] {
  return value === 'shell' || value === 'agent'
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

function parseTaskRecord(value: unknown): TaskRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const {
    id,
    kind,
    title,
    status,
    background,
    createdAt,
    startedAt,
    finishedAt,
    progressSummary,
    outputPath,
    transcriptPath,
    error,
    metadata,
  } = value

  if (typeof id !== 'string' || !id.trim()) {
    return null
  }
  if (!isTaskKind(kind)) {
    return null
  }
  if (typeof title !== 'string' || !title.trim()) {
    return null
  }
  if (!isTaskStatus(status)) {
    return null
  }
  if (typeof background !== 'boolean') {
    return null
  }
  if (typeof createdAt !== 'string' || !createdAt.trim()) {
    return null
  }
  if (startedAt !== undefined && typeof startedAt !== 'string') {
    return null
  }
  if (finishedAt !== undefined && typeof finishedAt !== 'string') {
    return null
  }
  if (progressSummary !== undefined && typeof progressSummary !== 'string') {
    return null
  }
  if (outputPath !== undefined && typeof outputPath !== 'string') {
    return null
  }
  if (transcriptPath !== undefined && typeof transcriptPath !== 'string') {
    return null
  }
  if (error !== undefined && typeof error !== 'string') {
    return null
  }
  if (metadata !== undefined && !isRecord(metadata)) {
    return null
  }

  return {
    id,
    kind,
    title,
    status,
    background,
    createdAt,
    startedAt,
    finishedAt,
    progressSummary,
    outputPath,
    transcriptPath,
    error,
    metadata: metadata as Record<string, unknown> | undefined,
  }
}

async function readTaskRecords(): Promise<TaskRecord[]> {
  return readJsonlEntries(getTaskStorePath(workspaceRoot), parseTaskRecord)
}

async function writeTaskRecords(records: readonly TaskRecord[]): Promise<void> {
  await writeJsonlEntries(getTaskStorePath(workspaceRoot), records)
}

async function ensureTaskDirectories(
  taskId: string,
  outputPath: string,
  transcriptPath: string,
): Promise<void> {
  await mkdir(getTaskDirectory(taskId, workspaceRoot), { recursive: true })
  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(path.dirname(transcriptPath), { recursive: true })
}

export async function listTasks(): Promise<TaskRecord[]> {
  return readTaskRecords()
}

export async function reconcileInterruptedTasks(
  cancelledAt: string = new Date().toISOString(),
): Promise<TaskRecord[]> {
  const tasks = await readTaskRecords()
  let changed = false

  const nextTasks = tasks.map((task) => {
    if (task.status !== 'pending' && task.status !== 'running') {
      return task
    }

    changed = true
    return {
      ...task,
      status: 'cancelled' as const,
      finishedAt: task.finishedAt ?? cancelledAt,
      progressSummary: task.status === 'running' ? interruptedTaskSummary : abandonedTaskSummary,
    }
  })

  if (changed) {
    await writeTaskRecords(nextTasks)
  }

  return nextTasks
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const tasks = await readTaskRecords()
  return tasks.find((task) => task.id === id) ?? null
}

export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const title = input.title.trim()
  if (!title) {
    throw new Error('Task title must not be empty.')
  }

  const id = generateId()
  const createdAt = new Date().toISOString()
  const outputPath = input.outputPath ?? getTaskOutputPath(id, 'output.txt', workspaceRoot)
  const transcriptPath = input.transcriptPath ?? getTaskTranscriptPath(id, workspaceRoot)
  const record: TaskRecord = {
    id,
    kind: input.kind,
    title,
    status: input.status ?? 'pending',
    background: input.background,
    createdAt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    progressSummary: input.progressSummary,
    outputPath,
    transcriptPath,
    error: input.error,
    metadata: input.metadata,
  }

  await ensureTaskDirectories(id, outputPath, transcriptPath)
  await appendJsonlEntry(getTaskStorePath(workspaceRoot), record)
  return record
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<TaskRecord | null> {
  const tasks = await readTaskRecords()
  const index = tasks.findIndex((task) => task.id === id)
  if (index === -1) {
    return null
  }

  const current = tasks[index]
  if (!current) {
    return null
  }
  const nextTask: TaskRecord = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    kind: patch.kind ?? current.kind,
    title:
      patch.title !== undefined
        ? (() => {
            const nextTitle = patch.title.trim()
            if (!nextTitle) {
              throw new Error('Task title must not be empty.')
            }
            return nextTitle
          })()
        : current.title,
    background: patch.background ?? current.background,
    status: patch.status ?? current.status,
    startedAt: patch.startedAt === null ? undefined : patch.startedAt ?? current.startedAt,
    finishedAt: patch.finishedAt === null ? undefined : patch.finishedAt ?? current.finishedAt,
    progressSummary:
      patch.progressSummary === null ? undefined : patch.progressSummary ?? current.progressSummary,
    outputPath: patch.outputPath === null ? undefined : patch.outputPath ?? current.outputPath,
    transcriptPath: patch.transcriptPath === null ? undefined : patch.transcriptPath ?? current.transcriptPath,
    error: patch.error === null ? undefined : patch.error ?? current.error,
    metadata: patch.metadata === null ? undefined : patch.metadata ?? current.metadata,
  }

  tasks[index] = nextTask
  await writeTaskRecords(tasks)
  return nextTask
}

export async function removeTask(id: string): Promise<TaskRecord | null> {
  const tasks = await readTaskRecords()
  const index = tasks.findIndex((task) => task.id === id)
  if (index === -1) {
    return null
  }

  const [removed] = tasks.splice(index, 1)
  await writeTaskRecords(tasks)
  return removed ?? null
}
