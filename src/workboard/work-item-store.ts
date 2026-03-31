import { randomUUID } from 'node:crypto'

import { workspaceRoot } from '../config'
import { isRecord, readJsonlEntries, writeJsonlEntries } from '../session/jsonl'
import { getWorkItemStorePath } from '../session/session-paths'
import type { CreateWorkItemInput, UpdateWorkItemInput, WorkItemRecord, WorkItemStatus } from './work-item-types'

function isWorkItemStatus(value: unknown): value is WorkItemStatus {
  return value === 'pending' || value === 'claimed' || value === 'completed' || value === 'blocked'
}

function parseWorkItemRecord(value: unknown): WorkItemRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const { id, title, description, status, createdAt, ownerAgentId, blockedBy, metadata } = value

  if (typeof id !== 'string' || !id.trim()) {
    return null
  }
  if (typeof title !== 'string' || !title.trim()) {
    return null
  }
  if (typeof description !== 'string' || !description.trim()) {
    return null
  }
  if (!isWorkItemStatus(status)) {
    return null
  }
  if (typeof createdAt !== 'string' || !createdAt.trim()) {
    return null
  }
  if (ownerAgentId !== undefined && typeof ownerAgentId !== 'string') {
    return null
  }
  if (blockedBy !== undefined && (!Array.isArray(blockedBy) || blockedBy.some((entry) => typeof entry !== 'string'))) {
    return null
  }
  if (metadata !== undefined && !isRecord(metadata)) {
    return null
  }

  return {
    id,
    title,
    description,
    status,
    createdAt,
    ownerAgentId,
    blockedBy: blockedBy as string[] | undefined,
    metadata: metadata as Record<string, unknown> | undefined,
  }
}

async function readWorkItems(): Promise<WorkItemRecord[]> {
  return readJsonlEntries(getWorkItemStorePath(workspaceRoot), parseWorkItemRecord)
}

async function writeWorkItems(records: readonly WorkItemRecord[]): Promise<void> {
  await writeJsonlEntries(getWorkItemStorePath(workspaceRoot), records)
}

export async function listWorkItems(): Promise<WorkItemRecord[]> {
  return readWorkItems()
}

export async function getWorkItem(id: string): Promise<WorkItemRecord | null> {
  const workItems = await readWorkItems()
  return workItems.find((item) => item.id === id) ?? null
}

export async function createWorkItem(input: CreateWorkItemInput): Promise<WorkItemRecord> {
  const title = input.title.trim()
  const description = input.description.trim()
  if (!title) {
    throw new Error('Work item title must not be empty.')
  }
  if (!description) {
    throw new Error('Work item description must not be empty.')
  }

  const record: WorkItemRecord = {
    id: randomUUID(),
    title,
    description,
    status: input.status ?? 'pending',
    createdAt: new Date().toISOString(),
    ownerAgentId: input.ownerAgentId,
    blockedBy: input.blockedBy,
    metadata: input.metadata,
  }

  const workItems = await readWorkItems()
  workItems.push(record)
  await writeWorkItems(workItems)
  return record
}

export async function updateWorkItem(
  id: string,
  patch: UpdateWorkItemInput,
): Promise<WorkItemRecord | null> {
  const workItems = await readWorkItems()
  const index = workItems.findIndex((item) => item.id === id)
  if (index === -1) {
    return null
  }

  const current = workItems[index]
  if (!current) {
    return null
  }
  const nextWorkItem: WorkItemRecord = {
    ...current,
    title:
      patch.title !== undefined
        ? (() => {
            const nextTitle = patch.title.trim()
            if (!nextTitle) {
              throw new Error('Work item title must not be empty.')
            }
            return nextTitle
          })()
        : current.title,
    description:
      patch.description !== undefined
        ? (() => {
            const nextDescription = patch.description.trim()
            if (!nextDescription) {
              throw new Error('Work item description must not be empty.')
            }
            return nextDescription
          })()
        : current.description,
    status: patch.status ?? current.status,
    ownerAgentId: patch.ownerAgentId === null ? undefined : patch.ownerAgentId ?? current.ownerAgentId,
    blockedBy: patch.blockedBy === null ? undefined : patch.blockedBy ?? current.blockedBy,
    metadata: patch.metadata === null ? undefined : patch.metadata ?? current.metadata,
  }

  workItems[index] = nextWorkItem
  await writeWorkItems(workItems)
  return nextWorkItem
}

export async function removeWorkItem(id: string): Promise<WorkItemRecord | null> {
  const workItems = await readWorkItems()
  const index = workItems.findIndex((item) => item.id === id)
  if (index === -1) {
    return null
  }

  const [removed] = workItems.splice(index, 1)
  await writeWorkItems(workItems)
  return removed ?? null
}
