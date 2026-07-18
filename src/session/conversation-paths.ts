import path from 'node:path'

import { workspaceRoot } from '../config'

export function getConversationsDirectory(root: string = workspaceRoot): string {
  return path.join(root, '.gambit', 'conversations')
}

export function getConversationDirectory(conversationId: string, root: string = workspaceRoot): string {
  return path.join(getConversationsDirectory(root), conversationId)
}

export function getConversationTranscriptPath(conversationId: string, root: string = workspaceRoot): string {
  return path.join(getConversationDirectory(conversationId, root), 'transcript.jsonl')
}
