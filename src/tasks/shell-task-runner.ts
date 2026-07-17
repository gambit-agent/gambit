import { MAX_SHELL_OUTPUT, workspaceRoot } from '../config'
import { appendTruncationNotice, collectBoundedText } from '../lib/process-output'
import { appendTaskOutput, writeTaskOutput } from './task-output'
import type { TaskRecord } from './task-types'
import { TaskRuntime } from './task-runtime'

export interface ShellTaskResult {
  task: TaskRecord
  stdout: string
  stderr: string
  exitCode: number | null
  formattedOutput: string
}

function formatShellResult(exitCode: number | null, stdout: string, stderr: string): string {
  return [
    `exit_code: ${exitCode ?? 0}`,
    stdout ? `stdout:\n${stdout}` : 'stdout: <empty>',
    stderr ? `stderr:\n${stderr}` : 'stderr: <empty>',
  ].join('\n\n')
}

export class ShellTaskRunner {
  constructor(private readonly taskRuntime: TaskRuntime) {}

  async run(
    command: string,
    options: { background: boolean; timeoutMs?: number; cwd?: string },
  ): Promise<ShellTaskResult> {
    const trimmedCommand = command.trim()
    if (!trimmedCommand) {
      throw new Error('No command provided.')
    }

    const createdTask = await this.taskRuntime.createTask({
      kind: 'shell',
      title: `Shell · ${trimmedCommand}`,
      background: options.background,
      status: 'running',
      startedAt: new Date().toISOString(),
      progressSummary: 'Running shell command',
      metadata: { command: trimmedCommand, cwd: options.cwd ?? workspaceRoot },
    })

    const controller = new AbortController()
    const unregister = this.taskRuntime.registerController(createdTask.id, controller)
    let timeout: ReturnType<typeof setTimeout> | null = null
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    }

    const runProcess = async (): Promise<ShellTaskResult> => {
      const process = Bun.spawn(['bash', '-lc', trimmedCommand], {
        cwd: options.cwd ?? workspaceRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const onAbort = () => {
        process.kill()
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })

      try {
        const stdoutPromise = collectBoundedText(process.stdout, MAX_SHELL_OUTPUT)
        const stderrPromise = collectBoundedText(process.stderr, MAX_SHELL_OUTPUT)
        const [stdout, stderr, exitCode] = await Promise.all([
          stdoutPromise,
          stderrPromise,
          process.exited,
        ])
        const boundedStdout = appendTruncationNotice(stdout, 'stdout')
        const boundedStderr = appendTruncationNotice(stderr, 'stderr')

        const wasCancelled = controller.signal.aborted
        const formattedOutput = wasCancelled
          ? `${formatShellResult(exitCode, boundedStdout, boundedStderr)}\n\ncancelled: true`
          : formatShellResult(exitCode, boundedStdout, boundedStderr)
        await writeTaskOutput(createdTask.id, formattedOutput)

        const updatedTask = await this.taskRuntime.updateTask(createdTask.id, {
          status: wasCancelled ? 'cancelled' : exitCode === 0 ? 'completed' : 'failed',
          finishedAt: new Date().toISOString(),
          progressSummary: wasCancelled
            ? 'Shell command cancelled'
            : exitCode === 0
              ? 'Shell command completed'
              : `Shell command failed with ${exitCode}`,
          error: wasCancelled ? null : exitCode === 0 ? null : `Shell exited with code ${exitCode}`,
        })

        return {
          task: updatedTask ?? createdTask,
          stdout: boundedStdout,
          stderr: boundedStderr,
          exitCode,
          formattedOutput,
        }
      } finally {
        controller.signal.removeEventListener('abort', onAbort)
        if (timeout) {
          clearTimeout(timeout)
        }
        unregister()
      }
    }

    if (options.background) {
      void runProcess().catch(async (error) => {
        const message = (error as Error).message
        await appendTaskOutput(createdTask.id, `\n${message}`)
        await this.taskRuntime.updateTask(createdTask.id, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          progressSummary: 'Shell command failed',
          error: message,
        })
      })

      return {
        task: createdTask,
        stdout: '',
        stderr: '',
        exitCode: null,
        formattedOutput: '',
      }
    }

    return runProcess()
  }
}
