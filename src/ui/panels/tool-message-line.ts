import type { ConversationMessage } from '../../conversation/conversation-types'
import { formatCompactToolSummary } from '../../lib/toolSummaries'

export const toolMessageRunningFrames = ['□', '▫', '◻', '▫'] as const
export const toolMessageRunningIntervalMs = 120

function formatToolStatus(value?: 'started' | 'completed' | 'failed'): string | null {
  switch (value) {
    case 'started':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

function getRunningIndicator(frameIndex: number): string {
  const frameCount = toolMessageRunningFrames.length
  const normalizedIndex = ((frameIndex % frameCount) + frameCount) % frameCount
  return toolMessageRunningFrames[normalizedIndex] ?? toolMessageRunningFrames[0]
}

export function formatToolMessageLine(
  message: ConversationMessage,
  animationFrame = 0,
): { indicator: string | null; text: string } {
  const toolName = message.metadata?.toolName ?? 'tool'
  const toolStatus = formatToolStatus(message.metadata?.toolStatus) ?? 'done'
  const compactSummary = formatCompactToolSummary({
    toolName,
    status: message.metadata?.toolStatus,
    args: message.metadata?.toolArgs,
    result: message.metadata?.toolResult,
    artifactPath: message.metadata?.toolArtifactPath,
  })

  return {
    indicator: toolStatus === 'running' ? getRunningIndicator(animationFrame) : null,
    text: `Tool · ${toolName} · ${toolStatus}${compactSummary ? ` · ${compactSummary}` : ''}`,
  }
}
