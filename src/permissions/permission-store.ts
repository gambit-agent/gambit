import { generateId } from '../lib/id'

import { workspaceRoot } from '../config'
import { isRecord, readJsonlEntries, writeJsonlEntries } from '../session/jsonl'
import { getPermissionStorePath } from '../session/session-paths'
import type {
  EnqueuePermissionRequestInput,
  PermissionDecision,
  PermissionRequestRecord,
  PermissionRequestState,
  ResolvePermissionRequestInput,
} from './permission-types'

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === 'allow' || value === 'deny' || value === 'ask'
}

function isPermissionState(value: unknown): value is PermissionRequestState {
  return value === 'queued' || value === 'dequeued' || value === 'resolved'
}

function parsePermissionRequestRecord(value: unknown): PermissionRequestRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const { id, subject, decision, state, createdAt, dequeuedAt, resolvedAt, metadata } = value

  if (typeof id !== 'string' || !id.trim()) {
    return null
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return null
  }
  if (!isPermissionDecision(decision)) {
    return null
  }
  if (!isPermissionState(state)) {
    return null
  }
  if (typeof createdAt !== 'string' || !createdAt.trim()) {
    return null
  }
  if (dequeuedAt !== undefined && typeof dequeuedAt !== 'string') {
    return null
  }
  if (resolvedAt !== undefined && typeof resolvedAt !== 'string') {
    return null
  }
  if (metadata !== undefined && !isRecord(metadata)) {
    return null
  }

  return {
    id,
    subject,
    decision,
    state,
    createdAt,
    dequeuedAt,
    resolvedAt,
    metadata: metadata as Record<string, unknown> | undefined,
  }
}

async function readPermissionRecords(): Promise<PermissionRequestRecord[]> {
  return readJsonlEntries(getPermissionStorePath(workspaceRoot), parsePermissionRequestRecord)
}

async function writePermissionRecords(records: readonly PermissionRequestRecord[]): Promise<void> {
  await writeJsonlEntries(getPermissionStorePath(workspaceRoot), records)
}

export async function listPermissionRequests(): Promise<PermissionRequestRecord[]> {
  return readPermissionRecords()
}

export async function enqueuePermissionRequest(
  input: EnqueuePermissionRequestInput,
): Promise<PermissionRequestRecord> {
  const subject = input.subject.trim()
  if (!subject) {
    throw new Error('Permission request subject must not be empty.')
  }

  const record: PermissionRequestRecord = {
    id: generateId(),
    subject,
    decision: input.decision ?? 'ask',
    state: 'queued',
    createdAt: new Date().toISOString(),
    metadata: input.metadata,
  }

  const records = await readPermissionRecords()
  records.push(record)
  await writePermissionRecords(records)
  return record
}

export async function dequeuePermissionRequest(): Promise<PermissionRequestRecord | null> {
  const records = await readPermissionRecords()
  const index = records.findIndex((request) => request.state === 'queued')
  if (index === -1) {
    return null
  }

  const current = records[index]
  if (!current) {
    return null
  }
  const nextRequest: PermissionRequestRecord = {
    ...current,
    state: 'dequeued',
    dequeuedAt: new Date().toISOString(),
  }

  records[index] = nextRequest
  await writePermissionRecords(records)
  return nextRequest
}

export async function resolvePermissionRequest(
  id: string,
  input: ResolvePermissionRequestInput,
): Promise<PermissionRequestRecord | null> {
  const records = await readPermissionRecords()
  const index = records.findIndex((request) => request.id === id)
  if (index === -1) {
    return null
  }

  const current = records[index]
  if (!current) {
    return null
  }
  const nextRequest: PermissionRequestRecord = {
    ...current,
    decision: input.decision,
    state: 'resolved',
    resolvedAt: new Date().toISOString(),
  }

  records[index] = nextRequest
  await writePermissionRecords(records)
  return nextRequest
}

export async function listQueuedPermissionRequests(): Promise<PermissionRequestRecord[]> {
  const records = await readPermissionRecords()
  return records.filter((request) => request.state === 'queued')
}
