import { MAX_AGENT_BATCH_INLINE_OUTPUT_CHARS, MAX_SHELL_OUTPUT, workspaceRoot } from '../../config'
import type { TaskRecord } from '../../tasks/task-types'
import { formatToolSummary, summarizeToolCompletion } from '../../lib/toolSummaries'
import { relativeWorkspacePath, resolveWorkspacePath } from '../../lib/workspace'
import { truncate } from '../../lib/text'

export function summarizeBuiltInToolCompletion(
  toolId: string,
  input: unknown,
  result: unknown,
  artifactPath?: string,
): string {
  return formatToolSummary(summarizeToolCompletion(toolId, input, result, { artifactPath }))
}

export function formatFileChangeResult(message: string, diff: string): string {
  return diff.trim() ? `${message}\n\nDiff:\n\`\`\`diff\n${diff.trimEnd()}\n\`\`\`` : message
}

export function ensureNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${label}" must be a string.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Parameter "${label}" must not be empty.`)
  }

  return trimmed
}

export async function runShell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const process = Bun.spawn(['bash', '-lc', command], {
    cwd: workspaceRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdoutPromise = process.stdout ? new Response(process.stdout).text() : Promise.resolve('')
  const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve('')
  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, process.exited])
  return { stdout, stderr, exitCode }
}

export async function runRipgrepSearch(input: { pattern: string; path?: string; glob?: string }): Promise<string> {
  const pattern = ensureNonEmptyString(input.pattern, 'pattern')
  const searchPath = input.path?.trim() ? relativeWorkspacePath(resolveWorkspacePath(input.path)) : '.'
  const args = ['--line-number', '--no-heading', '--color=never']
  if (input.glob?.trim()) {
    args.push('--glob', input.glob.trim())
  }
  args.push('--', pattern, searchPath)

  const process = Bun.spawn(['rg', ...args], {
    cwd: workspaceRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdoutPromise = process.stdout ? new Response(process.stdout).text() : Promise.resolve('')
  const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve('')
  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, process.exited])
  if (exitCode === 0) {
    return truncate(stdout, MAX_SHELL_OUTPUT)
  }
  if (exitCode === 1) {
    return 'No matches found.'
  }
  throw new Error(stderr.trim() || `rg exited with code ${exitCode}`)
}

export function summarizeTask(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    status: task.status,
    background: task.background,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    progressSummary: task.progressSummary,
    error: task.error,
    metadata: task.metadata,
  }
}

export function formatAgentBatchResult(result: {
  tasks: Array<{ task: TaskRecord; output: string }>
}): string {
  const sections = result.tasks.map(({ task, output }, index) => {
    const header = [
      `## Agent ${index + 1}: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
      task.outputPath ? `Full output: ${task.outputPath}` : null,
      task.error ? `Error: ${task.error}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    const body = truncate(
      output.trim() || task.progressSummary || '(no output)',
      MAX_AGENT_BATCH_INLINE_OUTPUT_CHARS,
    )
    return `${header}\n\n${body}`
  })

  const failed = result.tasks.filter(({ task }) => task.status === 'failed' || task.status === 'cancelled')
  const summary =
    failed.length === 0
      ? `Ran ${result.tasks.length} delegated agent${result.tasks.length === 1 ? '' : 's'} concurrently.`
      : `Ran ${result.tasks.length} delegated agent${result.tasks.length === 1 ? '' : 's'} concurrently; ${failed.length} did not complete successfully.`

  return `${summary}\n\n${sections.join('\n\n---\n\n')}`
}

export function formatShellResult(exitCode: number, stdout: string, stderr: string): string {
  const outputParts = [
    `exit_code: ${exitCode}`,
    stdout ? `stdout:\n${truncate(stdout, MAX_SHELL_OUTPUT)}` : 'stdout: <empty>',
    stderr ? `stderr:\n${truncate(stderr, MAX_SHELL_OUTPUT)}` : 'stderr: <empty>',
  ]
  return outputParts.join('\n\n')
}
