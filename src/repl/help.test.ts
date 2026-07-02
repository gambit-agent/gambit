import { expect, test } from 'bun:test'

import type { SlashCommandDefinition } from '../lib/slashCommands'
import type { SkillDefinition } from '../lib/skills'
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

function skill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return {
    name: 'opentui',
    description: 'Build terminal user interfaces',
    scope: 'project',
    filePath: '/tmp/opentui/SKILL.md',
    directoryPath: '/tmp/opentui',
    body: 'Skill body',
    ...overrides,
  }
}

test('formats interactive help with built-in and custom slash commands', () => {
  const help = formatInteractiveHelp(
    [
      command({ id: 'review', name: 'review' }),
      command({
        id: 'local',
        name: 'local',
        description: 'Local only',
        disableModelInvocation: true,
      }),
    ],
    '',
    [skill({ name: 'opentui' })],
  )

  expect(help).toContain('/help - Show this help message.')
  expect(help).toContain('/workflow [help|clear|stop|edit] <task> - Create, revise, clear, or stop guidance for dynamic workflows.')
  expect(help).toContain('/skill <name> [prompt] - Trigger an installed skill for a task.')
  expect(help).not.toContain('/key <OPENROUTER_API_KEY>')
  expect(help).toContain('/mcp - Open MCP server management.')
  expect(help).toContain('/connect [provider] - Connect OpenRouter, OpenAI, ChatGPT Plus/Pro, Anthropic, LM Studio, or Z.AI.')
  expect(help).not.toContain(':key')
  expect(help).not.toContain(':mcp')
  expect(help).toContain('/review - Review changes [project]')
  expect(help).toContain('/local - Local only [project] (user-only)')
  expect(help).toContain('/skill opentui - Build terminal user interfaces [project]')
})

test('formats unknown slash command guidance without using the error panel', () => {
  const message = formatUnknownSlashCommandMessage('helo', [
    command({ id: 'mcp', name: 'mcp' }),
  ])

  expect(message).toContain('Unknown slash command: /helo')
  expect(message).toContain('Type /help to see all commands.')
  expect(message).toContain('/workflow')
  expect(message).toContain('/skill')
  expect(message).not.toContain('/key')
  expect(message).toContain('/mcp')
})
