import type { SlashCommandDefinition } from '../lib/slashCommands'

const builtInCommands = [
  ['/help', 'Show this help message.'],
  ['/clear', 'Start a fresh conversation.'],
  ['/goal [set|run|clear] <goal>', 'Manage or run the conversation goal.'],
  ['/model [query]', 'Open the model picker.'],
  ['/resume [query]', 'Open saved conversations.'],
  [':model <model-id>', 'Set the model directly.'],
  [':key <OPENROUTER_API_KEY>', 'Save the OpenRouter API key to the user config.'],
  [':reset', 'Start a fresh conversation.'],
  [':resume [query]', 'Open saved conversations.'],
  [':mcp', 'Open MCP server management.'],
  [':compact', 'Compact the current conversation.'],
  [':fork [title]', 'Fork the current conversation.'],
  [':tree', 'Show the conversation tree.'],
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

export function formatInteractiveHelp(
  commands: SlashCommandDefinition[],
  promptTemplateDescription = '',
): string {
  const customCommands = commands.map(formatCustomCommand)
  const customSection =
    customCommands.length > 0
      ? customCommands.join('\n')
      : '- No project or user slash commands found.'
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
    ...promptTemplateSection,
  ].join('\n')
}

export function formatUnknownSlashCommandMessage(
  name: string,
  commands: SlashCommandDefinition[],
): string {
  const normalizedName = name.replace(/^\//, '').trim()
  const customNames = commands.map((command) => `/${command.id}`)
  const suggestions = ['/help', '/clear', '/goal', '/model', '/resume', ...customNames]
  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 12)

  return [
    `Unknown slash command: /${normalizedName || '<empty>'}`,
    '',
    `Type /help to see all commands. Available: ${uniqueSuggestions.join(', ')}`,
  ].join('\n')
}
