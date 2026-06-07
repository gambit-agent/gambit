import { slashCommandCharBudget } from '../../config'
import { truncate } from '../text'
import type { SlashCommandDefinition } from './types'

export function buildSlashCommandToolDescription(commands: SlashCommandDefinition[]): string {
  const header =
    'Execute a custom slash command defined in the workspace (.gambit/commands) or ~/.gambit/commands.'

  const eligible = commands.filter((command) => !command.disableModelInvocation && Boolean(command.description))
  if (eligible.length === 0) {
    return `${header}\nNo slash commands with descriptions were found.`
  }

  const lines: string[] = []
  const budget = Math.max(0, slashCommandCharBudget)

  for (const command of eligible) {
    const scopeLabel = command.scope === 'project' ? 'project' : 'user'
    const namespaceLabel = command.namespace ? `${scopeLabel}:${command.namespace}` : scopeLabel
    const argumentHint = command.argumentHint ? ` [args: ${command.argumentHint}]` : ''
    const allowedTools = command.allowedTools.length ? ` [tools: ${command.allowedTools.join(', ')}]` : ''
    lines.push(`/${command.id}${argumentHint} - ${command.description} (${namespaceLabel})${allowedTools}`)
  }

  const full = [header, 'Available commands:', ...lines]
  if (budget === 0) {
    return header
  }

  const assembled = assembleWithBudget(full, budget)
  if (assembled === null) {
    return truncate([header, 'Available commands:', lines[0]].join('\n'), budget)
  }
  return assembled
}

function assembleWithBudget(lines: string[], budget: number): string | null {
  let used = 0
  const included: string[] = []
  let truncated = false

  for (const line of lines) {
    const nextLength = line.length + (included.length === 0 ? 0 : 1)
    if (used + nextLength > budget) {
      truncated = true
      break
    }
    included.push(line)
    used += nextLength
  }

  if (included.length === 0) {
    return null
  }

  if (!truncated) {
    return included.join('\n')
  }

  const note = `\n... (${lines.length - included.length} more commands)`
  const candidate = included.join('\n') + note
  return candidate.length <= budget ? candidate : truncate(candidate, budget)
}
