import type { SlashCommandDefinition } from '../lib/slashCommands'
import type { SkillDefinition } from '../lib/skills'

const builtInCommands = [
  ['/help', 'Show this help message.'],
  ['/clear', 'Start a fresh conversation.'],
  ['/goal [set|run|clear] <goal>', 'Manage or run the conversation goal.'],
  ['/workflow [help|clear|stop|edit] <task>', 'Create, revise, clear, or stop guidance for dynamic workflows.'],
  ['/model [query]', 'Open the model picker.'],
  ['/resume [query]', 'Open saved conversations.'],
  ['/skill <name> [prompt]', 'Trigger an installed skill for a task.'],
  ['/key <OPENROUTER_API_KEY>', 'Save the OpenRouter API key to the user config.'],
  ['/reset', 'Start a fresh conversation.'],
  ['/mcp', 'Open MCP server management.'],
  ['/compact', 'Compact the current conversation.'],
  ['/fork [title]', 'Fork the current conversation.'],
  ['/tree', 'Show the conversation tree.'],
  ['!<command>', 'Run a shell command.'],
  ['# <memory entry>', 'Save a memory entry.'],
  ['@template [args]', 'Run a prompt template.'],
] as const

function formatCustomCommand(command: SlashCommandDefinition): string {
  const scopeLabel = command.namespace ? `${command.scope}:${command.namespace}` : command.scope
  const argumentHint = command.argumentHint ? ` ${command.argumentHint}` : ''
  const description = command.description ? ` - ${command.description}` : ''
  const localOnly = command.disableModelInvocation ? ' (user-only)' : ''
  return `- /${command.id}${argumentHint}${description} [${scopeLabel}]${localOnly}`
}

function formatSkill(skill: SkillDefinition): string {
  return `- /skill ${skill.name} - ${skill.description} [${skill.scope}]`
}

export function formatInteractiveHelp(
  commands: SlashCommandDefinition[],
  promptTemplateDescription = '',
  skills: SkillDefinition[] = [],
): string {
  const customCommands = commands.map(formatCustomCommand)
  const customSection =
    customCommands.length > 0
      ? customCommands.join('\n')
      : '- No project or user slash commands found.'
  const skillCommands = skills.map(formatSkill)
  const skillSection =
    skillCommands.length > 0
      ? skillCommands.join('\n')
      : '- No project or user skills found.'
  const promptTemplateSection = promptTemplateDescription.trim()
    ? [
        '',
        'Prompt templates:',
        promptTemplateDescription,
      ]
    : []

  return [
    'Available commands',
    '',
    'Built-ins:',
    ...builtInCommands.map(([command, description]) => `- ${command} - ${description}`),
    '',
    'Custom slash commands:',
    customSection,
    '',
    'Skills:',
    skillSection,
    ...promptTemplateSection,
  ].join('\n')
}

export function formatUnknownSlashCommandMessage(
  name: string,
  commands: SlashCommandDefinition[],
): string {
  const normalizedName = name.replace(/^\//, '').trim()
  const customNames = commands.map((command) => `/${command.id}`)
  const suggestions = [
    '/help',
    '/clear',
    '/goal',
    '/workflow',
    '/model',
    '/resume',
    '/skill',
    '/key',
    '/reset',
    '/mcp',
    '/compact',
    '/fork',
    '/tree',
    ...customNames,
  ]
  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 12)

  return [
    `Unknown slash command: /${normalizedName || '<empty>'}`,
    '',
    `Type /help to see all commands. Available: ${uniqueSuggestions.join(', ')}`,
  ].join('\n')
}
