import { expect, test } from 'bun:test'

import type { SlashCommandDefinition } from '../lib/slashCommands'
import { formatInteractiveHelp, formatUnknownSlashCommandMessage } from './help'

function command(overrides: Partial<SlashCommandDefinition>): SlashCommandDefinition {
  return {
    id: 'review',
    name: 'review',
    namespace: null,
    scope: 'project',
    description: 'Review changes',
    allowedTools: [],
    disableModelInvocation: false,
    filePath: '/tmp/review.md',
    relativePath: 'review.md',
    body: 'Review',
    ...overrides,
  }
}

test('formats interactive help with built-in and custom slash commands', () => {
  const help = formatInteractiveHelp([
    command({ id: 'review', name: 'review' }),
    command({
      id: 'local',
      name: 'local',
      description: 'Local only',
      disableModelInvocation: true,
    }),
  ])

  expect(help).toContain('/help - Show this help message.')
  expect(help).toContain('/review - Review changes [project]')
  expect(help).toContain('/local - Local only [project] (user-only)')
})

test('formats unknown slash command guidance without using the error panel', () => {
  const message = formatUnknownSlashCommandMessage('helo', [
    command({ id: 'mcp', name: 'mcp' }),
  ])

  expect(message).toContain('Unknown slash command: /helo')
  expect(message).toContain('Type /help to see all commands.')
  expect(message).toContain('/mcp')
})
