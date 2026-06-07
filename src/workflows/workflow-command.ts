import type { ConversationMessage } from '../conversation/conversation-types'

export type WorkflowCommand =
  | { action: 'help' }
  | { action: 'clear' }
  | { action: 'stop' }
  | { action: 'edit'; change: string }
  | { action: 'run'; task: string }

export function parseWorkflowCommand(argument: string): WorkflowCommand {
  const trimmed = argument.trim()
  if (!trimmed || trimmed === '?' || /^help$/i.test(trimmed)) {
    return { action: 'help' }
  }

  const firstSpace = trimmed.indexOf(' ')
  const head = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)
  const tail = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()
  const normalizedHead = head.toLowerCase()

  if (normalizedHead === 'clear' && !tail) {
    return { action: 'clear' }
  }
  if ((normalizedHead === 'stop' || normalizedHead === 'cancel') && !tail) {
    return { action: 'stop' }
  }
  if (normalizedHead === 'edit') {
    return { action: 'edit', change: tail }
  }
  if (normalizedHead === 'run') {
    return { action: 'run', task: tail }
  }

  return { action: 'run', task: trimmed }
}

export function formatWorkflowCommandHelp(): string {
  return [
    'Workflow commands',
    '',
    '- /workflow <task> - Create and run a dynamic multi-agent workflow.',
    '- /workflow edit <change> - Revise and rerun the most recent workflow script.',
    '- /workflow clear - Remove completed workflow result messages from this conversation.',
    '- /workflow stop - Show how to stop an active workflow run.',
    '',
    'Active workflows run inside the current generation. Press Ctrl+C to abort the active run.',
  ].join('\n')
}

export function clearWorkflowMessages(messages: readonly ConversationMessage[]): {
  messages: ConversationMessage[]
  removedCount: number
} {
  const next = messages.filter((message) => !isWorkflowToolMessage(message))
  return {
    messages: next,
    removedCount: messages.length - next.length,
  }
}

export function findLatestWorkflowScript(messages: readonly ConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || !isWorkflowToolMessage(message)) {
      continue
    }
    const args = asRecord(message.metadata?.toolArgs)
    if (typeof args?.script === 'string' && args.script.trim()) {
      return args.script.trim()
    }
  }
  return null
}

function isWorkflowToolMessage(message: ConversationMessage): boolean {
  return message.role === 'tool' && message.metadata?.toolName === 'workflow'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
