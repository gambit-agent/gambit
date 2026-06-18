import { fuzzyFilter } from '../lib/fuzzy'
import { loadSkills, type SkillDefinition } from '../lib/skills'
import { loadSlashCommands, type SlashCommandDefinition } from '../lib/slashCommands'

const slashQueryPattern = /^[A-Za-z0-9._/:-]*$/
const defaultMaxResults = 20

export type SlashCompletionMode = 'command' | 'skill'
export type SlashCompletionKind = 'built-in' | 'command' | 'skill'

export interface ActiveSlashCompletion {
  start: number
  end: number
  query: string
  mode: SlashCompletionMode
}

export interface SlashCompletionMatch {
  key: string
  kind: SlashCompletionKind
  label: string
  description: string
  insertText: string
  score: number
}

export interface ReplaceSlashCompletionResult {
  value: string
  cursorOffset: number
}

interface BuiltInSlashCommand {
  name: string
  argumentHint?: string
  description: string
}

export const builtInSlashCommands: BuiltInSlashCommand[] = [
  { name: 'help', description: 'Show this help message.' },
  { name: 'clear', description: 'Start a fresh conversation.' },
  { name: 'goal', argumentHint: '[set|run|clear] <goal>', description: 'Manage or run the conversation goal.' },
  { name: 'workflow', argumentHint: '[help|clear|stop|edit] <task>', description: 'Create, revise, clear, or stop guidance for dynamic workflows.' },
  { name: 'model', argumentHint: '[query]', description: 'Open the model picker.' },
  { name: 'resume', argumentHint: '[query]', description: 'Open saved conversations.' },
  { name: 'skill', argumentHint: '<name> [prompt]', description: 'Trigger an installed skill for a task.' },
  { name: 'key', argumentHint: '<OPENROUTER_API_KEY>', description: 'Save the OpenRouter API key to the user config.' },
  { name: 'reset', description: 'Start a fresh conversation.' },
  { name: 'mcp', description: 'Open MCP server management.' },
  { name: 'compact', description: 'Compact the current conversation.' },
  { name: 'themes', description: 'Open the color theme picker.' },
  { name: 'fork', argumentHint: '[title]', description: 'Fork the current conversation.' },
  { name: 'tree', description: 'Show the conversation tree.' },
]

export function findActiveSlashCompletion(
  value: string,
  cursorOffset: number = value.length,
): ActiveSlashCompletion | null {
  const boundedOffset = Math.max(0, Math.min(cursorOffset, value.length))
  const firstNonWhitespace = value.search(/\S/)
  if (firstNonWhitespace === -1 || value[firstNonWhitespace] !== '/') {
    return null
  }

  const beforeCursor = value.slice(0, boundedOffset)
  const commandEnd = findTokenEnd(value, firstNonWhitespace)
  if (boundedOffset <= commandEnd) {
    const query = beforeCursor.slice(firstNonWhitespace + 1)
    if (!slashQueryPattern.test(query)) {
      return null
    }

    return {
      start: firstNonWhitespace,
      end: extendTokenEnd(value, boundedOffset),
      query,
      mode: 'command',
    }
  }

  const commandName = value.slice(firstNonWhitespace + 1, commandEnd)
  if (commandName !== 'skill') {
    return null
  }

  const argumentPrefix = value.slice(commandEnd, boundedOffset)
  if (!/^\s+\S*$/.test(argumentPrefix)) {
    return null
  }

  const argumentStart = commandEnd + (argumentPrefix.match(/^\s*/)?.[0].length ?? 0)
  const query = value.slice(argumentStart, boundedOffset)
  if (!slashQueryPattern.test(query)) {
    return null
  }

  return {
    start: argumentStart,
    end: extendTokenEnd(value, boundedOffset),
    query,
    mode: 'skill',
  }
}

export function replaceActiveSlashCompletion(
  value: string,
  completion: ActiveSlashCompletion,
  match: SlashCompletionMatch,
): ReplaceSlashCompletionResult {
  const nextChar = value[completion.end] ?? ''
  const suffix = nextChar && /\s/.test(nextChar) ? '' : ' '
  const nextValue = `${value.slice(0, completion.start)}${match.insertText}${suffix}${value.slice(completion.end)}`

  return {
    value: nextValue,
    cursorOffset: completion.start + match.insertText.length + suffix.length,
  }
}

export async function getSlashCompletionMatches(
  query: string,
  mode: SlashCompletionMode,
  options: {
    commands?: readonly SlashCommandDefinition[]
    skills?: readonly SkillDefinition[]
    maxResults?: number
  } = {},
): Promise<SlashCompletionMatch[]> {
  const [commands, skills] = await Promise.all([
    options.commands ? Promise.resolve([...options.commands]) : loadSlashCommands(),
    options.skills ? Promise.resolve([...options.skills]) : loadSkills(),
  ])
  return getSlashCompletionMatchesFromCatalog(query, mode, commands, skills, options.maxResults)
}

export function getSlashCompletionMatchesFromCatalog(
  query: string,
  mode: SlashCompletionMode,
  commands: readonly SlashCommandDefinition[],
  skills: readonly SkillDefinition[],
  maxResults: number = defaultMaxResults,
): SlashCompletionMatch[] {
  const items = mode === 'skill'
    ? skills.map(skillToCompletion)
    : [
        ...builtInSlashCommands.map(builtInToCompletion),
        ...commands.map(commandToCompletion),
        ...skills.map(skillToSlashCommandCompletion),
      ]

  return fuzzyFilter(query.replace(/^\//, ''), items, buildSearchText, maxResults)
    .map((result) => ({
      ...result.item,
      score: result.score,
    }))
}

function builtInToCompletion(command: BuiltInSlashCommand): SlashCompletionMatch {
  const argumentHint = command.argumentHint ? ` ${command.argumentHint}` : ''
  return {
    key: `built-in:${command.name}`,
    kind: 'built-in',
    label: `/${command.name}${argumentHint}`,
    description: command.description,
    insertText: `/${command.name}`,
    score: 0,
  }
}

function commandToCompletion(command: SlashCommandDefinition): SlashCompletionMatch {
  const argumentHint = command.argumentHint ? ` ${command.argumentHint}` : ''
  const scopeLabel = command.namespace ? `${command.scope}:${command.namespace}` : command.scope
  const localOnly = command.disableModelInvocation ? ' user-only' : ''
  return {
    key: `command:${command.id}`,
    kind: 'command',
    label: `/${command.id}${argumentHint}`,
    description: `${command.description ?? command.relativePath} [${scopeLabel}${localOnly}]`,
    insertText: `/${command.id}`,
    score: 0,
  }
}

function skillToCompletion(skill: SkillDefinition): SlashCompletionMatch {
  return {
    key: `skill-argument:${skill.name}`,
    kind: 'skill',
    label: skill.name,
    description: `${skill.description} [${skill.scope}]`,
    insertText: skill.name,
    score: 0,
  }
}

function skillToSlashCommandCompletion(skill: SkillDefinition): SlashCompletionMatch {
  return {
    key: `skill:${skill.name}`,
    kind: 'skill',
    label: `/skill ${skill.name}`,
    description: `${skill.description} [${skill.scope}]`,
    insertText: `/skill ${skill.name}`,
    score: 0,
  }
}

function buildSearchText(item: SlashCompletionMatch): string {
  return `${item.label} ${item.kind} ${item.description}`
}

function findTokenEnd(value: string, start: number): number {
  const rest = value.slice(start)
  const whitespaceIndex = rest.search(/\s/)
  return whitespaceIndex === -1 ? value.length : start + whitespaceIndex
}

function extendTokenEnd(value: string, cursorOffset: number): number {
  const afterCursor = value.slice(cursorOffset)
  const suffix = afterCursor.match(/^[^\s]*/)?.[0] ?? ''
  return cursorOffset + suffix.length
}
