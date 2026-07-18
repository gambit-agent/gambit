import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { DEFAULT_FOREGROUND_SHELL_TIMEOUT_MS, ShellTaskRunner } from './shell-task-runner'
import { TaskRuntime } from './task-runtime'

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isProcessAlive(pid)
}

async function waitForPidFile(filePath: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const pid = Number((await readFile(filePath, 'utf8')).trim())
      if (Number.isFinite(pid) && pid > 0) {
        return pid
      }
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`pid file was not written: ${filePath}`)
}

function killProcessGroupSafely(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

describe('shell task runner', () => {
  let root = ''
  let runtime: TaskRuntime

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-shell-runner-'))
    setWorkspaceRootForTesting(root)
    runtime = new TaskRuntime()
  })

  afterEach(async () => {
    setWorkspaceRootForTesting(originalWorkspaceRoot)
    await rm(root, { recursive: true, force: true })
  })

  test('captures stdout, stderr, and exit code for foreground commands', async () => {
    const runner = new ShellTaskRunner(runtime)
    const result = await runner.run('echo hello-stdout; echo hello-stderr >&2', { background: false })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello-stdout')
    expect(result.stderr).toContain('hello-stderr')
    expect(result.task.status).toBe('completed')
    expect(result.formattedOutput).toContain('exit_code: 0')
  })

  test('applies a default foreground timeout when none is provided', () => {
    expect(DEFAULT_FOREGROUND_SHELL_TIMEOUT_MS).toBe(10 * 60_000)
  })

  test('timeout kills the entire process group, including grandchildren', async () => {
    const runner = new ShellTaskRunner(runtime)
    const startedAt = Date.now()

    // The grandchild `sleep` holds the stdout pipe open; without a group kill
    // the runner would hang until the grandchild exits on its own.
    const result = await runner.run('sleep 60 & echo "grandchild-pid:$!"; wait', {
      background: false,
      timeoutMs: 500,
    })

    expect(Date.now() - startedAt).toBeLessThan(15_000)
    expect(result.task.status).toBe('cancelled')
    expect(result.timedOut).toBe(true)
    expect(result.formattedOutput).toContain('timed out after 500ms')
    expect(result.formattedOutput).not.toContain('cancelled: true')

    const match = result.stdout.match(/grandchild-pid:(\d+)/)
    expect(match).toBeTruthy()
    const grandchildPid = Number(match![1])
    expect(await waitForProcessDeath(grandchildPid, 5_000)).toBe(true)
  }, 30_000)

  test('external abort signal cancels a foreground command and its children', async () => {
    const runner = new ShellTaskRunner(runtime)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)

    const startedAt = Date.now()
    const result = await runner.run('sleep 60 & echo "grandchild-pid:$!"; wait', {
      background: false,
      signal: controller.signal,
    })

    expect(Date.now() - startedAt).toBeLessThan(15_000)
    expect(result.task.status).toBe('cancelled')
    expect(result.timedOut).toBe(false)
    expect(result.formattedOutput).toContain('cancelled: true')
    expect(result.formattedOutput).not.toContain('timed out')

    const match = result.stdout.match(/grandchild-pid:(\d+)/)
    expect(match).toBeTruthy()
    expect(await waitForProcessDeath(Number(match![1]), 5_000)).toBe(true)
  }, 30_000)

  test('already-aborted signal cancels immediately', async () => {
    const runner = new ShellTaskRunner(runtime)
    const controller = new AbortController()
    controller.abort()

    const result = await runner.run('sleep 60', {
      background: false,
      signal: controller.signal,
    })
    expect(result.task.status).toBe('cancelled')
  }, 30_000)

  test('timeout expiry is reported distinctly from user abort', async () => {
    const runner = new ShellTaskRunner(runtime)
    const result = await runner.run('sleep 60', { background: false, timeoutMs: 200 })

    expect(result.task.status).toBe('cancelled')
    expect(result.timedOut).toBe(true)
    expect(result.formattedOutput).toContain(
      '[Command timed out after 200ms. Pass timeoutMs for longer commands or use background:true.]',
    )
    expect(result.formattedOutput).not.toContain('cancelled: true')
    expect(result.task.progressSummary).toContain('timed out')
  }, 30_000)

  test('background tasks ignore the external turn signal', async () => {
    const runner = new ShellTaskRunner(runtime)

    // An already-aborted signal must not prevent a background task from starting.
    const abortedController = new AbortController()
    abortedController.abort()
    const pidFileA = path.join(root, 'bg-pid-a')
    const startedResult = await runner.run(`echo $$ > "${pidFileA}"; sleep 60`, {
      background: true,
      signal: abortedController.signal,
    })
    expect(startedResult.task.status).toBe('running')
    const pidA = await waitForPidFile(pidFileA, 5_000)
    expect(isProcessAlive(pidA)).toBe(true)

    // Aborting the signal after start must not kill a background task.
    const controller = new AbortController()
    const pidFileB = path.join(root, 'bg-pid-b')
    await runner.run(`echo $$ > "${pidFileB}"; sleep 60`, {
      background: true,
      signal: controller.signal,
    })
    const pidB = await waitForPidFile(pidFileB, 5_000)
    expect(isProcessAlive(pidB)).toBe(true)
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(isProcessAlive(pidB)).toBe(true)

    killProcessGroupSafely(pidA)
    killProcessGroupSafely(pidB)
  }, 30_000)
})
