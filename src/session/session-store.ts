import { mkdir } from 'node:fs/promises'

import { isRecord, readJsonlEntries, appendJsonlEntry } from './jsonl'
import { getCurrentSessionDirectory, getSessionTranscriptPath } from './session-paths'

export type TranscriptRole = 'system' | 'user' | 'assistant' | 'tool'

export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
}

function parseTranscriptEntry(value: unknown): TranscriptEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const { id, role, content, timestamp, metadata } = value
  if (typeof id !== 'string' || !id.trim()) {
    return null
  }
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
    return null
  }
  if (typeof content !== 'string') {
    return null
  }
  if (typeof timestamp !== 'string' || !timestamp.trim()) {
    return null
  }
  if (metadata !== undefined && !isRecord(metadata)) {
    return null
  }

  return {
    id,
    role,
    content,
    timestamp,
    metadata: metadata as Record<string, unknown> | undefined,
  }
}

export async function ensureSessionStore(): Promise<void> {
  await mkdir(getCurrentSessionDirectory(), { recursive: true })
}

export async function appendTranscriptEntry(entry: TranscriptEntry): Promise<void> {
  if (!entry.content.trim()) {
    return
  }

  await ensureSessionStore()
  await appendJsonlEntry(getSessionTranscriptPath(), entry)
}

export async function readTranscriptEntries(): Promise<TranscriptEntry[]> {
  await ensureSessionStore()
  return readJsonlEntries(getSessionTranscriptPath(), parseTranscriptEntry)
}
