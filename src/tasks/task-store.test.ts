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
