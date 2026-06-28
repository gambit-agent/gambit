import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import {
  buildSlashCommandToolDescription,
  executeSlashCommand,
  type SlashCommandDefinition,
  type SlashCommandExecution,
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

  const slashCommandTool: ToolDefinition<typeof slashCommandSchema, SlashCommandExecution> = {
    id: 'slashCommand',
    displayName: 'Slash Command',
    description: buildSlashCommandToolDescription(commands),
    inputSchema: slashCommandSchema,
    execute: async ({ name, arguments: args }) => executeSlashCommand(name, args),
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('slashCommand', context.input, result, context.artifactPath),
  }

  return [bashTool, executeShellTool, slashCommandTool]
}
