import type { ConversationSessionSummary } from '../session/conversation-sessions'

export const sessionTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g
const oscPattern = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g
const controlCharsPattern = /[\u0000-\u001f\u007f-\u009f]/g

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return `${tokens}`
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }
  parts.push(`${seconds}s`)

  return parts.join(' ')
}

export function formatSessionTimestamp(value: string | null): string {
  if (!value) {
    return 'unknown'
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return 'unknown'
  }

  return sessionTimestampFormatter.format(timestamp)
}

export function describeSessionOption(summary: ConversationSessionSummary, isCurrent: boolean): string {
  const parts = [
    summary.conversationId.slice(0, 8),
    `updated ${formatSessionTimestamp(summary.updatedAt)}`,
    `${summary.messageCount} msgs`,
  ]

  if (isCurrent) {
    parts.push('current')
  }

  if (summary.preview) {
    parts.push(summary.preview)
  }

  return parts.join(' · ')
}

export function sanitizeTaskText(value: string): string {
  return value
    .replace(oscPattern, '')
    .replace(ansiPattern, '')
    .replace(controlCharsPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatTaskTitle(value: string): string {
  return sanitizeTaskText(value)
}

export function truncateTaskLine(value: string, maxLength: number): string {
  const normalized = sanitizeTaskText(value)
  if (normalized.length <= maxLength) {
    return normalized
  }
  if (maxLength <= 1) {
    return normalized.slice(0, maxLength)
  }
  return `${normalized.slice(0, maxLength - 1)}…`
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength)
  }

  const keep = maxLength - 1
  const start = Math.ceil(keep / 2)
  const end = Math.floor(keep / 2)
  return `${value.slice(0, start)}…${value.slice(value.length - end)}`
}

export function isActiveTaskStatus(status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'): boolean {
  return status === 'pending' || status === 'running'
}
