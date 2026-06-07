import type { ConversationMessage } from '../../conversation/conversation-types'
import { summarizeToolEvent } from '../../lib/toolSummaries'

/** Spinner characters shown while a tool call is in the "started" state. */
export const toolMessageRunningFrames = ['□', '▫', '◻', '▫'] as const

/** Interval (ms) between spinner frame updates. */
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

function getToolActionVerb(toolName: string): string {
  switch (toolName) {
    case 'readFile':
    case 'readTaskOutput':
    case 'read-mcp-resource':
      return 'Read'
    case 'searchFiles':
      return 'Searched'
    case 'writeFile':
    case 'patchFile':
    case 'writeMemory':
    case 'add-mcp-server':
    case 'remove-mcp-server':
    case 'toggle-mcp-server':
      return 'Edited'
    case 'listTasks':
    case 'getTaskStatus':
    case 'waitForTasks':
    case 'list-mcp-resources':
    case 'list-mcp-tools':
    case 'list-mcp-servers':
      return 'Explored'
    case 'executeShell':
    case 'slashCommand':
    case 'workflow':
    case 'call-mcp-tool':
      return 'Ran'
    case 'activateSkill':
      return 'Activated'
    case 'spawnAgent':
    case 'runAgents':
      return 'Delegated'
    case 'cancelTask':
      return 'Canceled'
    default:
      return 'Used'
  }
}

/**
 * Render a single-line status string for a tool message in the REPL.
 * Returns an optional animated indicator plus a human-readable text line.
 */
export function formatToolMessageLine(
  message: ConversationMessage,
  animationFrame = 0,
): { indicator: string | null; text: string } {
  const toolName = message.metadata?.toolName ?? 'tool'
  const toolStatus = formatToolStatus(message.metadata?.toolStatus) ?? 'done'

  const summary = summarizeToolEvent({
    toolName,
    status: message.metadata?.toolStatus,
    args: message.metadata?.toolArgs,
    result: message.metadata?.toolResult,
    artifactPath: message.metadata?.toolArtifactPath,
  })

  const detail = summary.detail ?? summary.headline ?? toolName

  return {
    indicator: toolStatus === 'running' ? getRunningIndicator(animationFrame) : null,
    text: `${getToolActionVerb(toolName)}: ${detail}`,
  }
}
