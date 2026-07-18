import type { AtifSubagentTrajectoryRef } from '../trajectory/atif-types'

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
    toolStatus?: 'started' | 'completed' | 'failed' | 'cancelled'
    toolArtifactPath?: string
    /** ATIF subagent trajectory references attached to a tool result. */
    subagentTrajectoryRefs?: AtifSubagentTrajectoryRef[]
    reasoningStartedAt?: string
    reasoningFinishedAt?: string
    reasoningDurationMs?: number
    /** Display-only reasoning text; excluded from content replayed to the model. */
    reasoningText?: string
    memoryContext?: boolean
    /** Marks a hidden message produced by context compaction. */
    compactionSummary?: boolean
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
  /** Set when the turn was aborted by the user before the model finished. */
  interrupted?: boolean
  /** Model finish reason when the turn ended abnormally (e.g. 'length'). */
  finishReason?: string
}
