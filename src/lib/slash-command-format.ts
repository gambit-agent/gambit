import type { SlashCommandExecution } from './slashCommands'

export function formatSlashCommandMessage(execution: SlashCommandExecution): string {
  const scopeLabel = execution.namespace ? `${execution.scope}:${execution.namespace}` : execution.scope
  const header: string[] = [`Command · ${execution.command}`, `Scope · ${scopeLabel}`]

  if (execution.arguments) {
    header.push(`Arguments · ${execution.arguments}`)
  }
  if (execution.allowedTools.length > 0) {
    header.push(`Allowed tools · ${execution.allowedTools.join(', ')}`)
  }
  if (execution.model) {
    header.push(`Preferred model · ${execution.model}`)
  }

  const headerBlock = header.join('\n')
  return execution.content ? `${headerBlock}\n\n${execution.content}` : headerBlock
}
