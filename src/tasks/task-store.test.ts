import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting } from '../config'
import { getTaskOutputPath, getTaskStorePath, getTaskTranscriptPath } from '../session/session-paths'
import { createTask, getTask, listTasks, removeTask, updateTask } from './task-store'

describe('task store', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-task-store-'))
    setWorkspaceRootForTesting(root)
  })

  test('creates, updates, lists, and removes task records', async () => {
    const created = await createTask({
      kind: 'shell',
      title: 'Build the project',
      background: true,
      metadata: { source: 'test' },
    })

    expect(created.outputPath).toBe(getTaskOutputPath(created.id, 'output.txt', root))
    expect(created.transcriptPath).toBe(getTaskTranscriptPath(created.id, root))
    expect(await getTask(created.id)).toEqual(created)
    expect(await listTasks()).toHaveLength(1)
    expect(getTaskStorePath(root)).toContain('.gambit')

    const updated = await updateTask(created.id, {
      status: 'running',
      progressSummary: 'halfway there',
    })

    expect(updated).not.toBeNull()
    expect(updated?.status).toBe('running')
    expect(updated?.progressSummary).toBe('halfway there')

    const removed = await removeTask(created.id)
    expect(removed?.id).toBe(created.id)
    expect(await getTask(created.id)).toBeNull()
    expect(await listTasks()).toEqual([])
  })

  test('concurrent updateTask calls do not lose updates', async () => {
    const count = 12
    const tasks: Awaited<ReturnType<typeof createTask>>[] = []
    for (let index = 0; index < count; index += 1) {
      tasks.push(
        await createTask({
          kind: 'shell',
          title: `Task ${index}`,
          background: true,
        }),
      )
    }

    await Promise.all(
      tasks.map((task, index) =>
        updateTask(task.id, {
          status: 'running',
          progressSummary: `progress-${index}`,
        }),
      ),
    )

    const stored = await listTasks()
    expect(stored).toHaveLength(count)
    for (let index = 0; index < count; index += 1) {
      const task = stored.find((record) => record.id === tasks[index]!.id)
      expect(task?.status).toBe('running')
      expect(task?.progressSummary).toBe(`progress-${index}`)
    }
  })

  test('concurrent createTask calls append every record', async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createTask({
          kind: 'agent',
          title: `Parallel ${index}`,
          background: true,
        }),
      ),
    )

    const stored = await listTasks()
    expect(stored).toHaveLength(created.length)
    for (const task of created) {
      expect(stored.some((record) => record.id === task.id)).toBe(true)
    }
  })

  test('rejects empty task titles', async () => {
    await expect(
      createTask({
        kind: 'agent',
        title: '   ',
        background: false,
      }),
    ).rejects.toThrow('Task title must not be empty.')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
})
