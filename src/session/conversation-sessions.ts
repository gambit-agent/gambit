import { readdir } from 'node:fs/promises'
import path from 'node:path'

import type { ConversationMessage } from '../conversation/conversation-types'
import { readJsonlEntries } from '../conversation/transcript'
import { workspaceRoot } from '../config'
import { readConversationMeta } from './conversation-meta'
import { getConversationsDirectory, getConversationTranscriptPath } from './conversation-paths'

interface TranscriptMessageRecord extends ConversationMessage {
  kind?: string
}

export interface ConversationSessionSummary {
  conversationId: string
  directory: string
  transcriptPath: string
  title: string
  preview: string | null
  createdAt: string | null
  updatedAt: string | null
  messageCount: number
  forkedFrom?: string
}

function normalizeSnippet(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function getMeaningfulMessages(records: TranscriptMessageRecord[]): TranscriptMessageRecord[] {
  return records.filter((record) => {
    if (record.kind === 'turn') {
      return false
    }
    if (typeof record.content !== 'string' || !record.content.trim()) {
      return false
    }
    if (record.hidden) {
      return false
    }
    return true
  })
}

function buildSummary(
  conversationId: string,
  transcriptPath: string,
  records: TranscriptMessageRecord[],
): ConversationSessionSummary | null {
  const messages = getMeaningfulMessages(records)
  if (messages.length === 0) {
    return null
  }

  const firstUserMessage = messages.find((message) => message.role === 'user')
  const latestMessage = messages[messages.length - 1] ?? null
  const createdAt = messages[0]?.timestamp ?? null
  const updatedAt = latestMessage?.timestamp ?? createdAt
  const preview = latestMessage ? normalizeSnippet(latestMessage.content, 120) : null

  return {
    conversationId,
    directory: path.dirname(transcriptPath),
    transcriptPath,
    title: firstUserMessage?.content?.trim()
      ? normalizeSnippet(firstUserMessage.content, 80)
      : `Session ${conversationId.slice(0, 8)}`,
    preview,
    createdAt,
    updatedAt,
    messageCount: messages.length,
  }
}

async function readSessionSummary(
  conversationId: string,
  root: string = workspaceRoot,
): Promise<ConversationSessionSummary | null> {
  const transcriptPath = getConversationTranscriptPath(conversationId, root)
  const records = await readJsonlEntries<TranscriptMessageRecord>(transcriptPath)
  const summary = buildSummary(conversationId, transcriptPath, records)
  if (!summary) return null

  const meta = await readConversationMeta(conversationId, root)
  if (meta?.forkedFrom) {
    summary.forkedFrom = meta.forkedFrom
  }

  return summary
}

export async function listConversationSessions(root: string = workspaceRoot): Promise<ConversationSessionSummary[]> {
  let entries

  try {
    entries = await readdir(getConversationsDirectory(root), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => readSessionSummary(entry.name, root)),
  )

  return summaries
    .filter((summary): summary is ConversationSessionSummary => summary !== null)
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? '')
      const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? '')
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
    })
}

export async function getConversationSessionSummary(
  conversationId: string,
  root: string = workspaceRoot,
): Promise<ConversationSessionSummary | null> {
  return readSessionSummary(conversationId, root)
}

export async function getLatestConversationSession(
  root: string = workspaceRoot,
): Promise<ConversationSessionSummary | null> {
  const sessions = await listConversationSessions(root)
  return sessions[0] ?? null
}
