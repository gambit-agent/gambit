import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot } from '../../config'
import { writeTaskOutput } from '../../tasks/task-output'
import { createTaskTools } from './task-tools'

let root = ''
let originalRoot = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gambit-task-tools-'))
  originalRoot = workspaceRoot
  setWorkspaceRootForTesting(root)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalRoot)
  await rm(root, { recursive: true, force: true })
})

test('readTaskOutput returns bounded recent output', async () => {
  const tool = createTaskTools().find((candidate) => candidate.id === 'readTaskOutput')
  if (!tool) {
    throw new Error('readTaskOutput tool not found')
  }

  await writeTaskOutput('task-1', 'alpha\nbeta\ngamma\n')

  const output = await tool.execute({ taskId: 'task-1', maxBytes: 6 } as never, {} as never)

  expect(output).toBe('[showing last 6 bytes]\ngamma\n')
})
