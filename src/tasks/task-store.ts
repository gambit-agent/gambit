import { generateId } from '../lib/id'
import { createSerialQueue } from '../lib/serial-queue'
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
  return value === 'shell' || value === 'agent' || value === 'workflow'
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
    sessionId,
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
  if (sessionId !== undefined && typeof sessionId !== 'string') {
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
    sessionId,
    metadata: metadata as Record<string, unknown> | undefined,
  }
}

async function readTaskRecords(
  storePath: string = getTaskStorePath(workspaceRoot),
): Promise<TaskRecord[]> {
  return readJsonlEntries(storePath, parseTaskRecord)
}

/**
 * Serializes every store mutation. updateTask/removeTask/reconcile are
 * read-all/rewrite-all cycles with realistic concurrent writers (parallel
 * background agents reporting progress); without the queue, interleaved
 * rewrites silently drop each other's updates.
 */
const storeMutationQueue = createSerialQueue()

async function writeTaskRecords(
  records: readonly TaskRecord[],
  storePath: string = getTaskStorePath(workspaceRoot),
): Promise<void> {
  await writeJsonlEntries(storePath, records)
}

async function ensureTaskDirectories(
  taskDirectory: string,
  outputPath: string,
  transcriptPath: string,
): Promise<void> {
  await mkdir(taskDirectory, { recursive: true })
  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(path.dirname(transcriptPath), { recursive: true })
}

export async function listTasks(): Promise<TaskRecord[]> {
  return readTaskRecords()
}

export async function reconcileInterruptedTasks(
  cancelledAt: string = new Date().toISOString(),
): Promise<TaskRecord[]> {
  const storePath = getTaskStorePath(workspaceRoot)
  return storeMutationQueue.run(async () => {
    const tasks = await readTaskRecords(storePath)
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
      await writeTaskRecords(nextTasks, storePath)
    }

    return nextTasks
  })
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
  const taskDirectory = getTaskDirectory(id, workspaceRoot)
  const storePath = getTaskStorePath(workspaceRoot)
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
    sessionId: input.sessionId,
    metadata: input.metadata,
  }

  await ensureTaskDirectories(taskDirectory, outputPath, transcriptPath)
  // The append itself goes through the queue so it cannot land between another
  // mutation's read and rewrite phases (which would drop the new record).
  await storeMutationQueue.run(() => appendJsonlEntry(storePath, record))
  return record
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<TaskRecord | null> {
  const storePath = getTaskStorePath(workspaceRoot)
  return storeMutationQueue.run(() => updateTaskUnlocked(id, patch, storePath))
}

async function updateTaskUnlocked(
  id: string,
  patch: UpdateTaskInput,
  storePath: string,
): Promise<TaskRecord | null> {
  const tasks = await readTaskRecords(storePath)
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
  await writeTaskRecords(tasks, storePath)
  return nextTask
}

export async function removeTask(id: string): Promise<TaskRecord | null> {
  const storePath = getTaskStorePath(workspaceRoot)
  return storeMutationQueue.run(async () => {
    const tasks = await readTaskRecords(storePath)
    const index = tasks.findIndex((task) => task.id === id)
    if (index === -1) {
      return null
    }

    const [removed] = tasks.splice(index, 1)
    await writeTaskRecords(tasks, storePath)
    return removed ?? null
  })
}
