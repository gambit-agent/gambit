import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting } from '../config'
import { createTask, getTask } from './task-store'
import { TaskRuntime } from './task-runtime'

describe('task runtime', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-task-runtime-'))
    setWorkspaceRootForTesting(root)
  })

  test('initialize cancels incomplete tasks from a previous session', async () => {
    const runningTask = await createTask({
      kind: 'shell',
      title: 'Long running shell command',
      background: true,
      status: 'running',
      startedAt: '2026-04-01T00:00:00.000Z',
      progressSummary: 'Running shell command',
    })
    const pendingTask = await createTask({
      kind: 'agent',
      title: 'Queued agent task',
      background: true,
      status: 'pending',
    })
    const completedTask = await createTask({
      kind: 'shell',
      title: 'Finished shell command',
      background: false,
      status: 'completed',
      startedAt: '2026-04-01T00:00:00.000Z',
      finishedAt: '2026-04-01T00:00:05.000Z',
      progressSummary: 'Shell command completed',
    })

    const runtime = new TaskRuntime()
    await runtime.initialize()

    await expect(getTask(runningTask.id)).resolves.toMatchObject({
      id: runningTask.id,
      status: 'cancelled',
      progressSummary: 'Task was interrupted when Gambit exited.',
    })
    expect((await getTask(runningTask.id))?.finishedAt).toBeTruthy()

    await expect(getTask(pendingTask.id)).resolves.toMatchObject({
      id: pendingTask.id,
      status: 'cancelled',
      progressSummary: 'Task did not start before Gambit exited.',
    })
    expect((await getTask(pendingTask.id))?.finishedAt).toBeTruthy()

    await expect(getTask(completedTask.id)).resolves.toMatchObject({
      id: completedTask.id,
      status: 'completed',
      progressSummary: 'Shell command completed',
      finishedAt: '2026-04-01T00:00:05.000Z',
    })

    expect(runtime.getSnapshot().tasks).toHaveLength(3)
  })

  test('cancelTask aborts a registered running task', async () => {
    const runtime = new TaskRuntime()
    await runtime.initialize()
    const task = await createTask({
      kind: 'agent',
      title: 'Running child agent',
      background: true,
      status: 'running',
    })
    const controller = new AbortController()
    runtime.registerController(task.id, controller)

    const cancelled = await runtime.cancelTask(task.id)

    expect(controller.signal.aborted).toBe(true)
    expect(cancelled).toMatchObject({
      id: task.id,
      status: 'cancelled',
      progressSummary: 'Task was cancelled.',
    })
  })

  test('waitForTasks resolves when watched tasks become terminal', async () => {
    const runtime = new TaskRuntime()
    await runtime.initialize()
    const task = await runtime.createTask({
      kind: 'shell',
      title: 'Long running task',
      background: true,
      status: 'running',
      startedAt: new Date().toISOString(),
    })

    const waitPromise = runtime.waitForTasks([task.id])
    await runtime.updateTask(task.id, {
      status: 'completed',
      finishedAt: new Date().toISOString(),
      progressSummary: 'done',
    })

    await expect(waitPromise).resolves.toMatchObject([
      {
        id: task.id,
        status: 'completed',
        progressSummary: 'done',
      },
    ])
  })

  test('waitForTasks rejects missing task ids instead of hanging', async () => {
    const runtime = new TaskRuntime()
    await runtime.initialize()

    await expect(runtime.waitForTasks(['missing-task'])).rejects.toThrow('Task not found: missing-task')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
})
