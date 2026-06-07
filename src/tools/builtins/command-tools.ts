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
  runShell,
  summarizeBuiltInToolCompletion,
} from './utils'

export function createCommandTools(commands: SlashCommandDefinition[]): AnyToolDefinition[] {
  const executeShellTool: ToolDefinition<typeof executeShellSchema, string> = {
    id: 'executeShell',
    displayName: 'Execute Shell',
    description:
      'Run a bash command from the workspace root for inspections, tests, builds, or other CLI work. Use background for long-running commands and task tools for follow-up status/output.',
    inputSchema: executeShellSchema,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('executeShell', context.input, result, context.artifactPath),
    execute: async ({ command, background, timeoutMs }, context) => {
      if (typeof command !== 'string') {
        throw new Error('Parameter "command" must be a string.')
      }

      const trimmedCommand = command.trim()
      if (!trimmedCommand) {
        return 'No command provided.'
      }

      if (context.shellTaskRunner) {
        const result = await context.shellTaskRunner.run(trimmedCommand, { background: background ?? false, timeoutMs })
        if (background) {
          return [
            `task_id: ${result.task.id}`,
            'status: started',
            `command: ${trimmedCommand}`,
          ].join('\n')
        }
        return result.formattedOutput
      }

      const result = await runShell(trimmedCommand)
      return formatShellResult(result.exitCode ?? 0, result.stdout, result.stderr)
    },
    getPermissionRequest: ({ command, background }) => ({
      subject: `Execute shell command: ${command}`,
      metadata: { command, background: background ?? false },
    }),
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

  return [executeShellTool, slashCommandTool]
}
