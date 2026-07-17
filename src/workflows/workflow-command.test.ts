import { expect, test } from 'bun:test'

import {
  clearWorkflowMessages,
  findLatestWorkflowScript,
  formatWorkflowCommandHelp,
  parseWorkflowCommand,
} from './workflow-command'
import type { ConversationMessage } from '../conversation/conversation-types'

function message(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 'message-1',
    role: 'tool',
    content: '',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

test('parseWorkflowCommand handles help, clear, stop, edit, and run', () => {
  expect(parseWorkflowCommand('')).toEqual({ action: 'help' })
  expect(parseWorkflowCommand('help')).toEqual({ action: 'help' })
  expect(parseWorkflowCommand('clear')).toEqual({ action: 'clear' })
  expect(parseWorkflowCommand('stop')).toEqual({ action: 'stop' })
  expect(parseWorkflowCommand('cancel')).toEqual({ action: 'stop' })
  expect(parseWorkflowCommand('edit add reviewer phase')).toEqual({
    action: 'edit',
    change: 'add reviewer phase',
  })
  expect(parseWorkflowCommand('run verify claims')).toEqual({
    action: 'run',
    task: 'verify claims',
  })
  expect(parseWorkflowCommand('clear flaky tests')).toEqual({
    action: 'run',
    task: 'clear flaky tests',
  })
})

test('formatWorkflowCommandHelp explains lifecycle commands', () => {
  const help = formatWorkflowCommandHelp()

  expect(help).toContain('/workflow <task>')
  expect(help).toContain('/workflow edit <change>')
  expect(help).toContain('Press Ctrl+C')
})

test('clearWorkflowMessages removes workflow tool messages only', () => {
  const workflow = message({
    id: 'workflow',
    metadata: { toolName: 'workflow' },
  })
  const shell = message({
    id: 'shell',
    metadata: { toolName: 'executeShell' },
  })
  const user = message({ id: 'user', role: 'user', content: 'hello' })

  const result = clearWorkflowMessages([workflow, shell, user])

  expect(result.removedCount).toBe(1)
  expect(result.messages.map((item) => item.id)).toEqual(['shell', 'user'])
})

test('findLatestWorkflowScript returns the newest workflow script', () => {
  const messages = [
    message({
      id: 'first',
      metadata: { toolName: 'workflow', toolArgs: { script: 'first script' } },
    }),
    message({
      id: 'second',
      metadata: { toolName: 'workflow', toolArgs: { script: 'second script' } },
    }),
  ]

  expect(findLatestWorkflowScript(messages)).toBe('second script')
})
