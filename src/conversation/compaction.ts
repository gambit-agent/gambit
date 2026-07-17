import type { ConversationMessage } from './conversation-types'

/**
 * Rough token estimation: ~4 characters per token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessageTokens(message: ConversationMessage): number {
  let total = estimateTokens(message.content)
  if (message.metadata?.toolArgs) {
    total += estimateTokens(JSON.stringify(message.metadata.toolArgs))
  }
  if (message.metadata?.toolResult) {
    total += estimateTokens(
      typeof message.metadata.toolResult === 'string'
        ? message.metadata.toolResult
        : JSON.stringify(message.metadata.toolResult),
    )
  }
  return total
}

export function estimateContextTokens(messages: ConversationMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += estimateMessageTokens(message)
  }
  return total
}

export interface CompactionOptions {
  /** Maximum tokens before compaction is triggered. Default: 80000 */
  maxTokens?: number
  /** Number of recent messages to keep verbatim. Default: 20 */
  keepRecentCount?: number
  /** Maximum tokens for the summary. Default: 2000 */
  maxSummaryTokens?: number
}

export interface CompactionResult {
  compacted: boolean
  messages: ConversationMessage[]
  summarizedCount: number
  originalTokens: number
  compactedTokens: number
}

const DEFAULT_MAX_TOKENS = 80_000
const DEFAULT_KEEP_RECENT = 20
const DEFAULT_MAX_SUMMARY_TOKENS = 2000

/**
 * Compact a conversation by summarizing older messages while keeping recent ones verbatim.
 * The summary is inserted as a hidden system message at the beginning.
 */
export function compactMessages(
  messages: ConversationMessage[],
  options: CompactionOptions = {},
): CompactionResult {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const keepRecentCount = options.keepRecentCount ?? DEFAULT_KEEP_RECENT
  const maxSummaryChars = (options.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS) * 4

  const visibleMessages = messages.filter((m) => !m.hidden)
  const hiddenMessages = messages.filter((m) => m.hidden)
  const originalTokens = estimateContextTokens(messages)

  // Don't compact if under threshold
  if (originalTokens < maxTokens && visibleMessages.length <= keepRecentCount * 2) {
    return {
      compacted: false,
      messages,
      summarizedCount: 0,
      originalTokens,
      compactedTokens: originalTokens,
    }
  }

  // Split into older (to summarize) and recent (to keep)
  const splitPoint = Math.max(0, visibleMessages.length - keepRecentCount)
  const olderMessages = visibleMessages.slice(0, splitPoint)
  const recentMessages = visibleMessages.slice(splitPoint)

  if (olderMessages.length === 0) {
    return {
      compacted: false,
      messages,
      summarizedCount: 0,
      originalTokens,
      compactedTokens: originalTokens,
    }
  }

  // Build summary of older messages
  const summary = buildConversationSummary(olderMessages, maxSummaryChars)

  const summaryMessage: ConversationMessage = {
    id: `compaction-${Date.now()}`,
    role: 'system',
    content: `[Context compaction] The following is a summary of the earlier conversation:\n\n${summary}\n\n--- End of summary. The recent messages follow verbatim. ---`,
    timestamp: new Date().toISOString(),
    hidden: true,
  }

  const compactedMessages = [...hiddenMessages, summaryMessage, ...recentMessages]
  const compactedTokens = estimateContextTokens(compactedMessages)

  return {
    compacted: true,
    messages: compactedMessages,
    summarizedCount: olderMessages.length,
    originalTokens,
    compactedTokens,
  }
}

function buildConversationSummary(messages: ConversationMessage[], maxChars: number): string {
  const sections: string[] = []

  // Group by user turns
  let currentTurn: ConversationMessage[] = []
  const turns: ConversationMessage[][] = []

  for (const msg of messages) {
    if (msg.role === 'user' && currentTurn.length > 0) {
      turns.push(currentTurn)
      currentTurn = []
    }
    currentTurn.push(msg)
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  for (const turn of turns) {
    const userMsg = turn.find((m) => m.role === 'user')
    const assistantMsg = turn.find((m) => m.role === 'assistant')
    const toolMsgs = turn.filter((m) => m.role === 'tool')

    const parts: string[] = []

    if (userMsg) {
      parts.push(`User: ${truncateText(userMsg.content, 200)}`)
    }

    if (toolMsgs.length > 0) {
      const toolNames = toolMsgs
        .map((m) => m.metadata?.toolName ?? 'tool')
        .filter((v, i, a) => a.indexOf(v) === i)
      parts.push(`Tools used: ${toolNames.join(', ')}`)
    }

    if (assistantMsg) {
      parts.push(`Assistant: ${truncateText(assistantMsg.content, 300)}`)
    }

    if (parts.length > 0) {
      sections.push(parts.join('\n'))
    }
  }

  let summary = sections.join('\n\n')
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars - 3) + '...'
  }

  return summary
}

function truncateText(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return singleLine.slice(0, maxLength - 3) + '...'
}

/**
 * Check if compaction should be triggered based on current context size.
 */
export function shouldAutoCompact(
  messages: ConversationMessage[],
  options: CompactionOptions = {},
): boolean {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const tokens = estimateContextTokens(messages)
  return tokens > maxTokens
}
