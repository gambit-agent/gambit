import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'

import { MAX_SHELL_OUTPUT, workspaceRoot } from '../config'
import { appendTruncationNotice, collectBoundedText } from '../lib/process-output'
import { appendTaskOutput, writeTaskOutput } from './task-output'
import type { TaskRecord } from './task-types'
import { TaskRuntime } from './task-runtime'

/**
 * Terminate a process and every descendant on Windows.
 *
 * `taskkill /T /F` is unconditionally forceful — Windows has no console-app
 * equivalent of the SIGTERM grace period — so the POSIX SIGTERM/SIGKILL
 * escalation collapses into a single call here. Repeat calls on an
 * already-dead tree are harmless no-ops.
 */
function killWindowsProcessTree(pid: number): void {
  try {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    // taskkill exits non-zero when the tree is already gone; nothing to do.
    killer.on('error', () => {})
  } catch {
    // Spawning the killer failed; the process may already have exited.
  }
}

export interface ShellTaskResult {
  task: TaskRecord
  stdout: string
  stderr: string
  exitCode: number | null
  formattedOutput: string
  /** True when the command was killed because it exceeded its timeout (rather than user abort). */
  timedOut: boolean
}

export interface ShellTaskRunOptions {
  background: boolean
  timeoutMs?: number
  cwd?: string
  /**
   * External cancellation signal (e.g. turn cancellation) that aborts the
   * command. Ignored for background tasks, which must outlive the turn and are
   * stopped through task management instead.
   */
  signal?: AbortSignal
}

/** Default timeout applied to foreground shell commands when none is provided. */
export const DEFAULT_FOREGROUND_SHELL_TIMEOUT_MS = 10 * 60_000

/** Grace period between SIGTERM and SIGKILL when tearing down a process group. */
const KILL_ESCALATION_GRACE_MS = 2_000
/** How long to keep draining stdio after the shell exits before giving up on the pipes. */
const OUTPUT_DRAIN_GRACE_MS = 250

function formatTimeoutDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return `${ms / 60_000}m`
  }
  if (ms >= 1_000 && ms % 1_000 === 0) {
    return `${ms / 1_000}s`
  }
  return `${ms}ms`
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

  async run(command: string, options: ShellTaskRunOptions): Promise<ShellTaskResult> {
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

    const effectiveTimeoutMs =
      options.timeoutMs && options.timeoutMs > 0
        ? options.timeoutMs
        : options.background
          ? null
          : DEFAULT_FOREGROUND_SHELL_TIMEOUT_MS
    // Track WHY the controller aborted so a timeout expiry can be reported
    // distinctly from a user/turn cancellation.
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    if (effectiveTimeoutMs !== null) {
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, effectiveTimeoutMs)
    }

    // Only foreground runs are linked to the caller's cancellation signal.
    // Background tasks must survive turn aborts (ESC / next turn) and are
    // stopped only through their own task-management path.
    const externalSignal = options.background ? undefined : options.signal
    const onExternalAbort = () => controller.abort()
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    const runProcess = async (): Promise<ShellTaskResult> => {
      // Spawn detached so the shell becomes the leader of a new process group;
      // aborting kills the whole group (including grandchildren), not just the
      // direct bash process.
      const child = spawn('bash', ['-lc', trimmedCommand], {
        cwd: options.cwd ?? workspaceRoot,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const killProcessGroup = (signal: NodeJS.Signals) => {
        const pid = child.pid
        if (typeof pid !== 'number') {
          return
        }
        // Windows has no process groups: process.kill(-pid) throws, and killing
        // only the direct bash child leaves grandchildren holding the stdout and
        // stderr write-ends open, so collectBoundedText never resolves and the
        // cancelled turn hangs. taskkill /T terminates the whole tree.
        if (process.platform === 'win32') {
          killWindowsProcessTree(pid)
          return
        }
        try {
          process.kill(-pid, signal)
        } catch {
          try {
            child.kill(signal)
          } catch {
            // Process already exited.
          }
        }
      }

      let escalation: ReturnType<typeof setTimeout> | null = null
      const onAbort = () => {
        killProcessGroup('SIGTERM')
        escalation = setTimeout(() => {
          // Kill the whole group even if the direct shell already exited, so
          // grandchildren that ignore SIGTERM cannot linger and hold the pipes.
          killProcessGroup('SIGKILL')
        }, KILL_ESCALATION_GRACE_MS)
        escalation.unref?.()
      }
      if (controller.signal.aborted) {
        onAbort()
      } else {
        controller.signal.addEventListener('abort', onAbort, { once: true })
      }

      // 'exit' fires as soon as the shell itself is gone. 'close' additionally
      // waits for every stdio pipe to close, which never happens while a
      // surviving grandchild holds a write end — the cause of cancelled turns
      // hanging on Windows, where the msys grandchild outlives taskkill /T.
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => resolve(code))
      })

      // Once the shell has exited, give buffered output a brief window to drain
      // and then stop reading rather than waiting on pipes nobody will close.
      const stopCollecting = new AbortController()
      let drain: ReturnType<typeof setTimeout> | null = null
      void exited.then(
        () => {
          drain = setTimeout(() => stopCollecting.abort(), OUTPUT_DRAIN_GRACE_MS)
          drain.unref?.()
        },
        () => stopCollecting.abort(),
      )

      try {
        const stdoutStream = child.stdout
          ? (Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>)
          : null
        const stderrStream = child.stderr
          ? (Readable.toWeb(child.stderr) as unknown as ReadableStream<Uint8Array>)
          : null
        const collectOptions = { stopSignal: stopCollecting.signal }
        const [stdout, stderr, exitCode] = await Promise.all([
          collectBoundedText(stdoutStream, MAX_SHELL_OUTPUT, collectOptions),
          collectBoundedText(stderrStream, MAX_SHELL_OUTPUT, collectOptions),
          exited,
        ])
        const boundedStdout = appendTruncationNotice(stdout, 'stdout')
        const boundedStderr = appendTruncationNotice(stderr, 'stderr')

        const wasCancelled = controller.signal.aborted
        const timeoutNotice =
          timedOut && effectiveTimeoutMs !== null
            ? `[Command timed out after ${formatTimeoutDuration(effectiveTimeoutMs)}. Pass timeoutMs for longer commands or use background:true.]`
            : null
        const baseOutput = formatShellResult(exitCode, boundedStdout, boundedStderr)
        const formattedOutput = timeoutNotice
          ? `${baseOutput}\n\n${timeoutNotice}`
          : wasCancelled
            ? `${baseOutput}\n\ncancelled: true`
            : baseOutput
        await writeTaskOutput(createdTask.id, formattedOutput)

        const updatedTask = await this.taskRuntime.updateTask(createdTask.id, {
          status: wasCancelled ? 'cancelled' : exitCode === 0 ? 'completed' : 'failed',
          finishedAt: new Date().toISOString(),
          progressSummary: timeoutNotice
            ? `Shell command timed out after ${formatTimeoutDuration(effectiveTimeoutMs ?? 0)}`
            : wasCancelled
              ? 'Shell command cancelled'
              : exitCode === 0
                ? 'Shell command completed'
                : `Shell command failed with ${exitCode}`,
          error: timeoutNotice ?? (wasCancelled ? null : exitCode === 0 ? null : `Shell exited with code ${exitCode}`),
        })

        return {
          task: updatedTask ?? createdTask,
          stdout: boundedStdout,
          stderr: boundedStderr,
          exitCode,
          formattedOutput,
          timedOut,
        }
      } finally {
        controller.signal.removeEventListener('abort', onAbort)
        if (drain) {
          clearTimeout(drain)
        }
        if (escalation) {
          clearTimeout(escalation)
        }
        if (timeout) {
          clearTimeout(timeout)
        }
        externalSignal?.removeEventListener('abort', onExternalAbort)
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
        timedOut: false,
      }
    }

    return runProcess()
  }
}
