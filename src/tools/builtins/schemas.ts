import { z } from 'zod'

export const readFileSchema = z.object({
  path: z.string().describe('Workspace-relative file path to read.'),
})

export const writeFileSchema = z.object({
  path: z.string().describe('Workspace-relative file path to create or overwrite.'),
  content: z.string().describe('Complete file contents. This overwrites the target file.'),
})

export const patchFileSchema = z.object({
  path: z
    .string()
    .describe('Optional single workspace-relative target path. Omit when the patch modifies multiple files.')
    .optional(),
  patch: z
    .string()
    .describe('Git-style unified diff. Supports update/create/delete/rename and multiple files; apply_patch format is rejected.'),
})

export const executeShellSchema = z.object({
  command: z.string().describe('Command to execute using bash -lc from the workspace root.'),
  background: z.boolean().optional().describe('Run as a background task and return a task_id. Defaults to false.'),
  timeoutMs: z.number().int().positive().optional().describe('Optional timeout in milliseconds for foreground waits.'),
})

export const searchFilesSchema = z.object({
  pattern: z.string().describe('Text or ripgrep-compatible regex pattern to search for.'),
  path: z.string().optional().describe('Optional workspace-relative directory or file to limit the search.'),
  glob: z.string().optional().describe('Optional ripgrep glob, for example "*.ts" or "src/**/*.tsx".'),
})

export const slashCommandSchema = z.object({
  name: z
    .string()
    .describe("Slash command to execute, with or without leading slash. Example: 'context' or 'frontend/context'."),
  arguments: z
    .string()
    .describe('Arguments forwarded to the command; they populate $ARGUMENTS and positional placeholders like $1.')
    .optional(),
})

export const spawnAgentSchema = z.object({
  role: z
    .enum(['default', 'explorer', 'worker'])
    .default('default')
    .describe('Delegated agent role: explorer is read-only, worker can edit/run shell, default has the broad default tool set.'),
  prompt: z.string().describe('Clear prompt for the delegated agent, including objective, relevant files, and constraints.'),
  description: z.string().optional().describe('Short task title shown in task lists and permission prompts.'),
  background: z.boolean().optional().describe('Run in the background and return a task_id. Defaults to false.'),
})

export const runAgentsSchema = z.object({
  agents: z
    .array(
      z.object({
        role: z
          .enum(['default', 'explorer', 'worker'])
          .default('default')
          .describe('Delegated agent role: explorer is read-only, worker can edit/run shell, default has the broad default tool set.'),
        prompt: z.string().describe('Clear prompt for the delegated agent, including objective, relevant files, and constraints.'),
        description: z.string().optional().describe('Short task title shown in task lists and permission prompts.'),
      }),
    )
    .min(1)
    .max(20)
    .describe('Delegated agents to run concurrently and wait for. Use when every result is needed before continuing.'),
})

export const workflowSchema = z.object({
  script: z
    .string()
    .describe(
      [
        'Required raw JavaScript workflow script, with no Markdown fences.',
        "First statement: export const meta = { name: 'short_snake_case', description: 'non-empty description' }.",
        'The orchestrator must be deterministic: Date.now(), new Date(), and Math.random() are unavailable.',
        'Use phase(title), agent(prompt, opts), parallel(thunks), pipeline(items, ...stages), log(message), args, cwd, process.cwd(), and budget.',
        'The workflow must call agent() at least once.',
      ].join(' '),
    ),
  args: z.unknown().optional().describe('Optional JSON value exposed to the workflow script as global args.'),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(16)
    .optional()
    .describe('Maximum number of workflow subagents to run concurrently. Defaults to available CPU minus two, capped at 16.'),
  tokenBudget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional rough token budget for workflow subagent outputs.'),
})

export const readTaskOutputSchema = z.object({
  taskId: z.string().describe('Task id to inspect.'),
})

export const listTasksSchema = z.object({})

export const getTaskStatusSchema = z.object({
  taskId: z.string().describe('Task id to inspect.'),
})

export const waitForTasksSchema = z.object({
  taskIds: z.array(z.string()).min(1).max(50).describe('Task ids to wait for.'),
  timeoutMs: z.number().int().positive().optional().describe('Optional timeout in milliseconds. Omit for no timeout.'),
})

export const cancelTaskSchema = z.object({
  taskId: z.string().describe('Task id to cancel.'),
})

export const writeMemorySchema = z.object({
  type: z.enum(['user', 'feedback', 'project', 'reference']).default('feedback'),
  name: z.string().describe('Stable memory name.'),
  description: z.string().describe('One-line description explaining why this memory matters.'),
  content: z.string().describe('Full memory content to store for future turns.'),
})

export const activateSkillSchema = z.object({
  name: z
    .string()
    .describe('Exact name of the skill to activate. Must match one of the skills listed in the tool description.'),
})
