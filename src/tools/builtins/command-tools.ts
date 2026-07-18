import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import {
  buildSlashCommandToolDescription,
  executeSlashCommand,
  executeSlashCommandFromPreview,
  previewSlashCommand,
  type SlashCommandDefinition,
  type SlashCommandExecution,
  type SlashCommandPreview,
} from '../../lib/slashCommands'
import {
  executeShellSchema,
  slashCommandSchema,
} from './schemas'
import {
  formatShellResult,
  runShellInDirectory,
  runShell,
  summarizeBuiltInToolCompletion,
} from './utils'
import { relativeWorkspacePath, resolveWorkspacePath } from '../../lib/workspace'

export function createCommandTools(commands: SlashCommandDefinition[]): AnyToolDefinition[] {
  const executeShellTool: ToolDefinition<typeof executeShellSchema, string> = {
    id: 'executeShell',
    displayName: 'Execute Shell',
    description:
      'Compatibility alias for bash. Run a bash command from the workspace root for inspections, tests, builds, or other CLI work.',
    inputSchema: executeShellSchema,
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('executeShell', context.input, result, context.artifactPath),
    execute: async ({ command, background, timeoutMs, workdir, cwd }, context) => {
      if (typeof command !== 'string') {
        throw new Error('Parameter "command" must be a string.')
      }

      const trimmedCommand = command.trim()
      if (!trimmedCommand) {
        return 'No command provided.'
      }

      const requestedWorkdir = workdir?.trim() || cwd?.trim() || ''
      const resolvedCwd = requestedWorkdir ? resolveWorkspacePath(requestedWorkdir) : (context.cwd ?? context.workspaceRoot)
      const relativeCwd = relativeWorkspacePath(resolvedCwd)

      if (context.shellTaskRunner) {
        const result = await context.shellTaskRunner.run(trimmedCommand, {
          background: background ?? false,
          timeoutMs,
          cwd: resolvedCwd,
          // Background tasks must outlive the turn: linking them to the turn's
          // cancellation signal would kill them on ESC or the next turn.
          signal: background ? undefined : context.signal,
        })
        if (background) {
          return [
            `task_id: ${result.task.id}`,
            'status: started',
            `command: ${trimmedCommand}`,
            `cwd: ${relativeCwd}`,
          ].join('\n')
        }
        return result.formattedOutput
      }

      const result = requestedWorkdir ? await runShellInDirectory(trimmedCommand, resolvedCwd) : await runShell(trimmedCommand)
      return formatShellResult(result.exitCode ?? 0, result.stdout, result.stderr)
    },
    getPermissionRequest: ({ command, background, workdir, cwd }) => ({
      subject: `Execute shell command: ${command}`,
      metadata: { command, background: background ?? false, cwd: workdir ?? cwd ?? null },
    }),
  }

  const bashTool: ToolDefinition<typeof executeShellSchema, string> = {
    ...executeShellTool,
    id: 'bash',
    displayName: 'Bash',
    hiddenFromModel: false,
    description:
      'Run terminal commands with bash -lc; prefer read/grep/glob/edit/write tools for file operations.',
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('bash', context.input, result, context.artifactPath),
  }

  // Previews captured at permission time, keyed by (name, arguments) and
  // consumed by the matching execute call. Executing from the captured
  // preview guarantees the shell directives that run are exactly the ones the
  // user approved, even if the command file changes on disk in between.
  const approvedPreviews = new Map<string, SlashCommandPreview>()
  const previewKey = (name: string, args: string | undefined) =>
    JSON.stringify([name.replace(/^\//, '').trim(), args?.trim() ?? ''])

  const slashCommandTool: ToolDefinition<typeof slashCommandSchema, SlashCommandExecution> = {
    id: 'slashCommand',
    displayName: 'Slash Command',
    description: buildSlashCommandToolDescription(commands),
    inputSchema: slashCommandSchema,
    execute: async ({ name, arguments: args }) => {
      const key = previewKey(name, args)
      const approved = approvedPreviews.get(key)
      if (approved) {
        approvedPreviews.delete(key)
        return executeSlashCommandFromPreview(approved)
      }
      // No captured preview (e.g. no permission engine in this context):
      // resolve from disk as before.
      return executeSlashCommand(name, args)
    },
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('slashCommand', context.input, result, context.artifactPath),
    getPermissionRequest: async ({ name, arguments: args }) => {
      // Resolve the command body and enumerate its embedded `!` shell
      // directives with the model-supplied arguments already substituted, so
      // the user approves the exact commands that would run. Directive-free
      // (pure prompt) commands need no permission gate.
      let preview: SlashCommandPreview | null
      try {
        preview = await previewSlashCommand(name, args)
      } catch {
        // Fail closed: if the command cannot be previewed we cannot rule out
        // embedded shell directives, so require approval (plan mode denies,
        // normal mode asks) instead of silently skipping the gate.
        const displayName = name.replace(/^\//, '').trim() || name
        return {
          subject: `Run slash command /${displayName} (could not preview embedded shell commands)`,
          metadata: {
            commandName: `/${displayName}`,
            arguments: args?.trim() ?? '',
            hasShellDirectives: true,
            previewFailed: true,
          },
        }
      }
      if (!preview) {
        // Unknown command: execute() throws without running anything.
        return null
      }

      // Capture the resolved preview (even when directive-free) so execute
      // runs what was inspected here rather than re-reading the file — a file
      // that gains directives after approval cannot run them unapproved.
      approvedPreviews.set(previewKey(name, args), preview)

      if (preview.shellDirectives.length === 0) {
        return null
      }

      const directiveList = preview.shellDirectives.map((directive) => `  - ${directive}`).join('\n')
      return {
        subject: `Run slash command /${preview.command.id} with embedded shell commands:\n${directiveList}`,
        metadata: {
          commandName: `/${preview.command.id}`,
          arguments: args?.trim() ?? '',
          shellDirectives: preview.shellDirectives,
          hasShellDirectives: true,
        },
      }
    },
  }

  return [bashTool, executeShellTool, slashCommandTool]
}
