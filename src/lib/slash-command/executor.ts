import { MAX_SHELL_OUTPUT, workspaceRoot } from '../../config'
import { appendTruncationNotice, collectBoundedText } from '../process-output'
import { truncate } from '../text'
import { loadSlashCommands } from './loader'
import { resolveCommand } from './resolver'
import type { SlashCommandDefinition, SlashCommandExecution } from './types'

const INLINE_COMMAND_PATTERN = /!`([^`]+?)`/g
const LINE_COMMAND_PATTERN = /^!\s*(.+)$/

/**
 * Preview of a slash command invocation before execution. Exposes the shell
 * directives (with model-supplied arguments already substituted) so the
 * permission system can surface exactly what would run, and captures the fully
 * resolved body so execution can run exactly what was approved without
 * re-reading the command file from disk.
 */
export interface SlashCommandPreview {
  command: SlashCommandDefinition
  /** Trimmed argument text the preview was resolved with. */
  arguments: string
  /** Command body with $ARGUMENTS/$1... substituted (directives not yet run). */
  resolvedBody: string
  /** Embedded `!` shell directives, with $ARGUMENTS/$1... already substituted. */
  shellDirectives: string[]
}

/**
 * Resolve a slash command and enumerate the shell directives it would execute
 * for the given arguments, without running anything. Returns null only when
 * the command does not exist (execution will surface the precise not-found
 * error). Loader or resolution failures are rethrown so callers fail closed
 * instead of treating an unreadable command as directive-free.
 */
export async function previewSlashCommand(
  identifier: string,
  args: string | undefined,
): Promise<SlashCommandPreview | null> {
  const trimmed = identifier.replace(/^\//, '').trim()
  if (!trimmed) {
    return null
  }

  const commands = await loadSlashCommands()
  const command = resolveCommand(commands, trimmed)
  if (!command) {
    return null
  }

  return buildPreview(command, args)
}

function buildPreview(command: SlashCommandDefinition, args: string | undefined): SlashCommandPreview {
  const argumentText = args?.trim() ?? ''
  const resolvedBody = applyArguments(command.body, argumentText)
  const { commands: shellDirectives } = extractEmbeddedCommands(resolvedBody)
  return { command, arguments: argumentText, resolvedBody, shellDirectives }
}

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

  return executeSlashCommandFromPreview(buildPreview(command, args), options)
}

/**
 * Execute a slash command from a previously captured preview. The preview's
 * resolved body (arguments already substituted) is used verbatim, so the shell
 * directives that run are exactly the ones enumerated at preview time — the
 * command file is never re-read, closing the window where an on-disk edit
 * between permission approval and execution could swap in unapproved commands.
 */
export async function executeSlashCommandFromPreview(
  preview: SlashCommandPreview,
  options: { allowDisabledModelInvocation?: boolean } = {},
): Promise<SlashCommandExecution> {
  const { command } = preview
  if (command.disableModelInvocation && !options.allowDisabledModelInvocation) {
    throw new Error(`Slash command /${command.id} is disabled for model invocation.`)
  }

  const rendered = await renderEmbeddedCommands(preview.resolvedBody)

  return {
    command: `/${command.id}`,
    scope: command.scope,
    namespace: command.namespace,
    arguments: preview.arguments,
    allowedTools: command.allowedTools,
    model: command.model,
    content: rendered.trim(),
  }
}

function applyArguments(template: string, argumentText: string): string {
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

interface ExtractedEmbeddedCommands {
  /** Template with every directive replaced by a unique placeholder token. */
  template: string
  /** Directive commands in execution order (inline first, then line directives). */
  commands: string[]
}

function commandPlaceholder(index: number): string {
  return `\u0000gambit-embedded-command-${index}\u0000`
}

/**
 * Extract every embedded `!` directive from the ORIGINAL command body and
 * replace it with an inert placeholder. Directives are enumerated before any
 * command runs, so shell output can never introduce additional directives and
 * permission previews match execution exactly.
 */
function extractEmbeddedCommands(content: string): ExtractedEmbeddedCommands {
  const commands: string[] = []

  // Pass 1: inline !`command` directives.
  INLINE_COMMAND_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  let cursor = 0
  const parts: string[] = []
  while ((match = INLINE_COMMAND_PATTERN.exec(content)) !== null) {
    const commandText = match[1]
    if (commandText === undefined) {
      continue
    }
    parts.push(content.slice(cursor, match.index))
    parts.push(commandPlaceholder(commands.length))
    commands.push(commandText.trim())
    cursor = match.index + match[0].length
  }
  parts.push(content.slice(cursor))

  // Pass 2: whole-line `! command` directives.
  const lines = parts.join('').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }
    const lineMatch = LINE_COMMAND_PATTERN.exec(line.trim())
    const commandText = lineMatch?.[1]
    if (commandText === undefined) {
      continue
    }
    lines[index] = commandPlaceholder(commands.length)
    commands.push(commandText.trim())
  }

  return { template: lines.join('\n'), commands }
}

async function renderEmbeddedCommands(content: string): Promise<string> {
  const { template, commands } = extractEmbeddedCommands(content)
  if (commands.length === 0) {
    return content
  }

  let rendered = template
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]
    const output = command === undefined ? '' : await formatCommandOutput(command)
    rendered = rendered.split(commandPlaceholder(index)).join(output)
  }
  return rendered
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
    collectBoundedText(process.stdout, MAX_SHELL_OUTPUT),
    collectBoundedText(process.stderr, MAX_SHELL_OUTPUT),
    process.exited,
  ])
  const boundedStdout = appendTruncationNotice(stdout, 'stdout')
  const boundedStderr = appendTruncationNotice(stderr, 'stderr')

  const formatted = [
    '```text',
    `command: ${command}`,
    `exit_code: ${exitCode}`,
    boundedStdout ? `stdout:\n${truncate(boundedStdout, MAX_SHELL_OUTPUT)}` : 'stdout: <empty>',
    boundedStderr ? `stderr:\n${truncate(boundedStderr, MAX_SHELL_OUTPUT)}` : 'stderr: <empty>',
    '```',
  ]
  return `\n${formatted.join('\n')}\n`
}
