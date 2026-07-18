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

const SUMMARY_PREFIX = '[Context compaction] The following is a summary of the earlier conversation:\n\n'
const SUMMARY_SUFFIX = '\n\n--- End of summary. The recent messages follow verbatim. ---'

function isCompactionSummaryMessage(message: ConversationMessage): boolean {
  return message.metadata?.compactionSummary === true || message.id.startsWith('compaction-')
}

/** Extract the raw summary body from a prior compaction-summary message. */
function extractSummaryBody(message: ConversationMessage): string {
  let body = message.content
  if (body.startsWith(SUMMARY_PREFIX)) {
    body = body.slice(SUMMARY_PREFIX.length)
  }
  if (body.endsWith(SUMMARY_SUFFIX)) {
    body = body.slice(0, -SUMMARY_SUFFIX.length)
  }
  return body.trim()
}

/**
 * Move the keep-recent split point so it never severs an assistant tool-call
 * from its tool results. Preferred boundary: the kept window starts at a user
 * message. When no user boundary exists above the start of the conversation
 * (e.g. a single-request agentic session whose only user message is at index
 * 0), fall back to the nearest tool-group-safe boundary at or below the
 * original target: never start the kept window on a tool message, so a tool
 * result is never separated from the assistant message that owns it.
 */
function findSafeSplitPoint(visibleMessages: ConversationMessage[], keepRecentCount: number): number {
  const target = Math.max(0, visibleMessages.length - keepRecentCount)

  let splitPoint = target
  while (splitPoint > 0 && visibleMessages[splitPoint]?.role !== 'user') {
    splitPoint--
  }
  if (splitPoint > 0) {
    return splitPoint
  }

  // No user boundary above index 0: split just before an assistant (or user)
  // message instead, walking back from the target past any tool messages.
  splitPoint = target
  while (splitPoint > 0 && visibleMessages[splitPoint]?.role === 'tool') {
    splitPoint--
  }
  return splitPoint
}

/**
 * Retain hidden messages across compaction, but:
 * - drop prior compaction summaries (the new summary supersedes them; their
 *   content is folded into the new summary)
 * - keep only the most recent hidden memory-context injection
 * Ordering of the retained messages is stable for prompt-cache friendliness.
 */
function partitionHiddenMessages(hiddenMessages: ConversationMessage[]): {
  retained: ConversationMessage[]
  priorSummaries: ConversationMessage[]
} {
  const priorSummaries = hiddenMessages.filter(isCompactionSummaryMessage)
  const memoryContextMessages = hiddenMessages.filter((m) => m.metadata?.memoryContext)
  const latestMemoryContextId = memoryContextMessages[memoryContextMessages.length - 1]?.id
  const retained = hiddenMessages.filter((message) => {
    if (isCompactionSummaryMessage(message)) {
      return false
    }
    if (message.metadata?.memoryContext) {
      return message.id === latestMemoryContextId
    }
    return true
  })
  return { retained, priorSummaries }
}

/**
 * Compact a conversation by summarizing older messages while keeping recent ones verbatim.
 * Compaction triggers on token pressure only. The summary is inserted as a hidden
 * user-role message (a system role would be hoisted into the instructions and bust
 * the provider prompt cache).
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

  const notCompacted: CompactionResult = {
    compacted: false,
    messages,
    summarizedCount: 0,
    originalTokens,
    compactedTokens: originalTokens,
  }

  // Token pressure is the sole trigger: message count alone must never compact.
  if (originalTokens < maxTokens) {
    return notCompacted
  }

  // Split into older (to summarize) and recent (to keep), never mid tool-group.
  const splitPoint = findSafeSplitPoint(visibleMessages, keepRecentCount)
  const olderMessages = visibleMessages.slice(0, splitPoint)
  const recentMessages = visibleMessages.slice(splitPoint)

  if (olderMessages.length === 0) {
    return notCompacted
  }

  const { retained: retainedHidden, priorSummaries } = partitionHiddenMessages(hiddenMessages)

  // Fold prior compaction summaries into the new summary (a new summary
  // supersedes them). Budget so the NEW summary always survives: it gets at
  // least half of the budget, and the prior bodies are truncated oldest-first
  // (from the front) to whatever room remains.
  const priorSummaryBodies = priorSummaries.map(extractSummaryBody).filter(Boolean)
  const newSummaryBudget = priorSummaryBodies.length > 0 ? Math.ceil(maxSummaryChars / 2) : maxSummaryChars
  const newSummary = buildConversationSummary(olderMessages, newSummaryBudget)
  let priorCombined = priorSummaryBodies.join('\n\n')
  if (priorCombined) {
    const separatorLength = 2 // '\n\n' between prior bodies and the new summary
    const priorBudget = maxSummaryChars - newSummary.length - separatorLength
    if (priorCombined.length > priorBudget) {
      priorCombined =
        priorBudget > 3 ? '...' + priorCombined.slice(priorCombined.length - (priorBudget - 3)) : ''
    }
  }
  const summary = [priorCombined, newSummary].filter(Boolean).join('\n\n')

  const summaryMessage: ConversationMessage = {
    id: `compaction-${Date.now()}`,
    role: 'user',
    content: `${SUMMARY_PREFIX}${summary}${SUMMARY_SUFFIX}`,
    timestamp: new Date().toISOString(),
    hidden: true,
    metadata: { compactionSummary: true },
  }

  const compactedMessages = [...retainedHidden, summaryMessage, ...recentMessages]
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
