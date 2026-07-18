import type { SlashCommandDefinition } from './types'

export function resolveCommand(
  commands: SlashCommandDefinition[],
  identifier: string,
): SlashCommandDefinition | null {
  const exact = commands.find((command) => command.id === identifier)
  if (exact) {
    return exact
  }

  const matches = commands.filter((command) => command.name === identifier)
  if (matches.length === 1) {
    return matches[0] ?? null
  }
  if (matches.length > 1) {
    const options = matches.map((command) => `/${command.id}`).join(', ')
    throw new Error(`Multiple commands match /${identifier}. Specify one of: ${options}`)
  }

  return null
}

export function filterUserConflicts(
  projectCommands: SlashCommandDefinition[],
  userCommands: SlashCommandDefinition[],
): SlashCommandDefinition[] {
  if (projectCommands.length === 0) {
    return userCommands
  }

  const projectNames = new Set(projectCommands.map((command) => command.name))
  return userCommands.filter((command) => !projectNames.has(command.name))
}
