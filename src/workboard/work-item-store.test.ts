import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting } from '../config'
import { getTaskStorePath } from '../session/session-paths'
import { createTask } from '../tasks/task-store'
import { createWorkItem, getWorkItem, listWorkItems, removeWorkItem, updateWorkItem } from './work-item-store'

describe('work item store', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-workboard-store-'))
    setWorkspaceRootForTesting(root)
  })

  test('keeps work items separate from task records', async () => {
    const task = await createTask({
      kind: 'shell',
      title: 'Build',
      background: true,
    })
    const workItem = await createWorkItem({
      title: 'Implement build pipeline',
      description: 'Add the runtime slice store',
      metadata: { source: 'Plan' },
    })

    expect(getTaskStorePath(root)).toContain('.gambit')
    expect(await getWorkItem(workItem.id)).toEqual(workItem)
    expect(await listWorkItems()).toHaveLength(1)
    expect(task.id).not.toBe(workItem.id)

    const updated = await updateWorkItem(workItem.id, {
      status: 'claimed',
      ownerAgentId: 'agent-1',
    })

    expect(updated?.status).toBe('claimed')
    expect(updated?.ownerAgentId).toBe('agent-1')

    const removed = await removeWorkItem(workItem.id)
    expect(removed?.id).toBe(workItem.id)
    expect(await listWorkItems()).toEqual([])
  })

  test('rejects empty work item fields', async () => {
    await expect(
      createWorkItem({
        title: '   ',
        description: 'valid description',
      }),
    ).rejects.toThrow('Work item title must not be empty.')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
})
