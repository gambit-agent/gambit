export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ConversationMessage {
  id: string
  parentId?: string
  role: ConversationRole
  content: string
  timestamp: string
  hidden?: boolean
  metadata?: {
    toolCallId?: string
    toolName?: string
    toolArgs?: unknown
    toolResult?: unknown
    toolStatus?: 'started' | 'completed' | 'failed'
    toolArtifactPath?: string
    reasoningStartedAt?: string
    reasoningFinishedAt?: string
    reasoningDurationMs?: number
    memoryContext?: boolean
  }
}

export interface ConversationToolCall {
  toolCallId: string
  toolId: string
  input: unknown
}

export interface ConversationTurnRecord {
  id: string
  startedAt: string
  finishedAt?: string
  userInput: string
  assistantOutput?: string
}
