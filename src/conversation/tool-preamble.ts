import type { ClosedAssistantSegment } from './assistant-message-builder'

/** A tool call's stated reason, plus the assistant message it came from. */
export interface ToolPreamble {
  text: string
  sourceId: string
}

/**
 * Longest text still treated as a preamble. Past this the segment is real
 * prose that belongs on screen in its own right, not a one-line note about
 * the tool call that follows.
 */
const MAX_PREAMBLE_CHARS = 200

/** Markdown structure — headings, lists, quotes, fences — is never a preamble. */
const STRUCTURED_PREFIX = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```)/

/**
 * Read the assistant text that ran immediately before a tool call as that
 * call's stated reason.
 *
 * Deliberately conservative: anything that fails these checks stays a normal
 * assistant message, because the caller folds a recognised preamble into the
 * tool line and hides the original. Being wrong here would hide content the
 * user needs to read.
 */
export function extractToolPreamble(segment: ClosedAssistantSegment | null): string | null {
  // A segment whose message also renders reasoning has to stay visible.
  if (!segment || segment.hasVisibleReasoning) {
    return null
  }

  const text = segment.text.trim()
  if (!text || text.length > MAX_PREAMBLE_CHARS) {
    return null
  }
  if (text.includes('\n') || STRUCTURED_PREFIX.test(text)) {
    return null
  }

  return text
}
