import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { getConversationDirectory } from './conversation-paths'

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
