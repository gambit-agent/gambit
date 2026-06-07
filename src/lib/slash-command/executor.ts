import { MAX_SHELL_OUTPUT, workspaceRoot } from '../../config'
import { truncate } from '../text'
import { loadSlashCommands } from './loader'
import { resolveCommand } from './resolver'
import type { SlashCommandExecution } from './types'

const INLINE_COMMAND_PATTERN = /!`([^`]+?)`/g

export async function executeSlashCommand(
  identifier: string,
  args: string | undefined,
  options: { allowDisabledModelInvocation?: boolean } = {},
): Promise<SlashCommandExecution> {
  const trimmed = identifier.replace(/^\//, '').trim()
  if (!trimmed) {
    throw new Error('Slash command name cannot be empty.')
  }

  const commands = await loadSlashCommands()
  const command = resolveCommand(commands, trimmed)
  if (!command) {
    throw new Error(`Slash command not found: /${trimmed}`)
  }

  if (command.disableModelInvocation && !options.allowDisabledModelInvocation) {
    throw new Error(`Slash command /${command.id} is disabled for model invocation.`)
  }

  const argumentText = args?.trim() ?? ''
  const contentWithArgs = applyArguments(command.body, argumentText)
  const rendered = await renderEmbeddedCommands(contentWithArgs)

  return {
    command: `/${command.id}`,
    scope: command.scope,
    namespace: command.namespace,
    arguments: argumentText,
    allowedTools: command.allowedTools,
    model: command.model,
    content: rendered.trim(),
  }
}

export function applyArguments(template: string, argumentText: string): string {
  if (!template.includes('$')) {
    return template
  }

  const positional = parseArguments(argumentText)
  let result = template.replace(/\$ARGUMENTS/g, argumentText)

  result = result.replace(/\$(\d+)/g, (match, index) => {
    const position = Number.parseInt(index, 10) - 1
    if (Number.isNaN(position) || position < 0) {
      return match
    }
    return positional[position] ?? ''
  })

  return result
}

function parseArguments(argumentText: string): string[] {
  const args: string[] = []
  if (!argumentText) {
    return args
  }

  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(argumentText)) !== null) {
    if (match[1] !== undefined) {
      args.push(match[1])
    } else if (match[2] !== undefined) {
      args.push(match[2])
    } else if (match[3] !== undefined) {
      args.push(match[3])
    }
  }
  return args
}

async function renderEmbeddedCommands(content: string): Promise<string> {
  const withInlineCommands = await replaceInlineCommands(content)
  return replaceLineCommands(withInlineCommands)
}

async function replaceInlineCommands(content: string): Promise<string> {
  INLINE_COMMAND_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  let cursor = 0
  const parts: string[] = []

  while ((match = INLINE_COMMAND_PATTERN.exec(content)) !== null) {
    const fullMatch = match[0]
    const commandText = match[1]
    if (commandText === undefined) {
      continue
    }

    const start = match.index
    const end = start + fullMatch.length
    parts.push(content.slice(cursor, start))
    parts.push(await formatCommandOutput(commandText.trim()))
    cursor = end
  }

  parts.push(content.slice(cursor))
  return parts.join('')
}

async function replaceLineCommands(content: string): Promise<string> {
  const lines = content.split(/\r?\n/)
  let mutated = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }
    const match = /^!\s*(.+)$/.exec(line.trim())
    if (!match) {
      continue
    }
    const commandText = match[1]
    if (commandText === undefined) {
      continue
    }

    mutated = true
    lines[index] = await formatCommandOutput(commandText.trim())
  }

  return mutated ? lines.join('\n') : content
}

async function formatCommandOutput(command: string): Promise<string> {
  if (!command) {
    return ''
  }

  const process = Bun.spawn(['bash', '-lc', command], {
    cwd: workspaceRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    process.stdout ? new Response(process.stdout).text() : Promise.resolve(''),
    process.stderr ? new Response(process.stderr).text() : Promise.resolve(''),
    process.exited,
  ])

  const formatted = [
    '```text',
    `command: ${command}`,
    `exit_code: ${exitCode}`,
    stdout ? `stdout:\n${truncate(stdout, MAX_SHELL_OUTPUT)}` : 'stdout: <empty>',
    stderr ? `stderr:\n${truncate(stderr, MAX_SHELL_OUTPUT)}` : 'stderr: <empty>',
    '```',
  ]
  return `\n${formatted.join('\n')}\n`
}
