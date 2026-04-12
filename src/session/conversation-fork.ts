import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import type { ConversationMessage } from '../conversation/conversation-types'
import { readJsonlEntries } from '../conversation/transcript'
import { writeJsonlEntries } from './jsonl'
import { getConversationDirectory, getConversationTranscriptPath } from './conversation-sessions'

export interface ConversationMeta {
  forkedFrom?: string
  forkPointMessageId?: string
  createdAt: string
}

function getMetaPath(conversationId: string, root: string = workspaceRoot): string {
  return path.join(getConversationDirectory(conversationId, root), 'meta.json')
}

export async function readConversationMeta(
  conversationId: string,
  root: string = workspaceRoot,
): Promise<ConversationMeta | null> {
  try {
    const raw = await readFile(getMetaPath(conversationId, root), 'utf8')
    return JSON.parse(raw) as ConversationMeta
  } catch {
    return null
  }
}

export async function writeConversationMeta(
  conversationId: string,
  meta: ConversationMeta,
  root: string = workspaceRoot,
): Promise<void> {
  const dir = getConversationDirectory(conversationId, root)
  await mkdir(dir, { recursive: true })
  await writeFile(getMetaPath(conversationId, root), JSON.stringify(meta, null, 2), 'utf8')
}

export interface ForkResult {
  conversationId: string
  messageCount: number
}

/**
 * Fork a conversation at a given message ID (or at the end if not specified).
 * Creates a new conversation with all messages up to and including the fork point.
 */
export async function forkConversation(
  sourceConversationId: string,
  options: { atMessageId?: string; root?: string } = {},
): Promise<ForkResult> {
  const root = options.root ?? workspaceRoot
  const transcriptPath = getConversationTranscriptPath(sourceConversationId, root)

  const allEntries = await readJsonlEntries<ConversationMessage & { kind?: string }>(transcriptPath)
  const messages = allEntries.filter((e) => e.kind !== 'turn') as ConversationMessage[]

  let forkedMessages: ConversationMessage[]
  let forkPointId: string | undefined

  if (options.atMessageId) {
    const idx = messages.findIndex((m) => m.id === options.atMessageId)
    if (idx === -1) {
      throw new Error(`Message ${options.atMessageId} not found in conversation ${sourceConversationId}`)
    }
    forkedMessages = messages.slice(0, idx + 1)
    forkPointId = options.atMessageId
  } else {
    forkedMessages = [...messages]
    forkPointId = messages[messages.length - 1]?.id
  }

  const newConversationId = randomUUID()
  const newDir = getConversationDirectory(newConversationId, root)
  await mkdir(newDir, { recursive: true })

  const newTranscriptPath = getConversationTranscriptPath(newConversationId, root)
  await writeJsonlEntries(
    newTranscriptPath,
    forkedMessages.map((m) => ({ kind: 'message', ...m })),
  )

  await writeConversationMeta(newConversationId, {
    forkedFrom: sourceConversationId,
    forkPointMessageId: forkPointId,
    createdAt: new Date().toISOString(),
  }, root)

  return {
    conversationId: newConversationId,
    messageCount: forkedMessages.length,
  }
}

/**
 * Build a tree view of all conversations showing fork relationships.
 */
export async function buildConversationTree(
  root: string = workspaceRoot,
): Promise<string> {
  const { listConversationSessions } = await import('./conversation-sessions')
  const sessions = await listConversationSessions(root)

  if (sessions.length === 0) {
    return 'No conversations found.'
  }

  const metaMap = new Map<string, ConversationMeta | null>()
  for (const session of sessions) {
    metaMap.set(session.conversationId, await readConversationMeta(session.conversationId, root))
  }

  const children = new Map<string, string[]>()
  const roots: string[] = []

  for (const session of sessions) {
    const meta = metaMap.get(session.conversationId)
    const parentId = meta?.forkedFrom
    if (parentId && sessions.some((s) => s.conversationId === parentId)) {
      const existing = children.get(parentId) ?? []
      existing.push(session.conversationId)
      children.set(parentId, existing)
    } else {
      roots.push(session.conversationId)
    }
  }

  const sessionMap = new Map(sessions.map((s) => [s.conversationId, s]))

  const lines: string[] = []

  function render(id: string, prefix: string, isLast: boolean): void {
    const session = sessionMap.get(id)
    if (!session) return

    const connector = prefix === '' ? '' : isLast ? '└── ' : '├── '
    const shortId = id.slice(0, 8)
    const title = session.title.length > 50 ? `${session.title.slice(0, 47)}...` : session.title
    const msgs = `${session.messageCount} msgs`
    lines.push(`${prefix}${connector}${shortId} ${title} (${msgs})`)

    const kids = children.get(id) ?? []
    for (let i = 0; i < kids.length; i++) {
      const childPrefix = prefix === '' ? '' : prefix + (isLast ? '    ' : '│   ')
      render(kids[i]!, childPrefix, i === kids.length - 1)
    }
  }

  for (let i = 0; i < roots.length; i++) {
    render(roots[i]!, '', i === roots.length - 1)
  }

  return lines.join('\n')
}
