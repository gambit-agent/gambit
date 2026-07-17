import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot } from '../config'
import {
  appendTaskOutput,
  readTaskOutput,
  readTaskOutputTail,
  readTaskOutputTailResult,
  writeTaskOutput,
} from './task-output'

let root = ''
let originalRoot = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gambit-task-output-'))
  originalRoot = workspaceRoot
  setWorkspaceRootForTesting(root)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalRoot)
  await rm(root, { recursive: true, force: true })
})

test('appends and reads task output tails without rewriting callers', async () => {
  await writeTaskOutput('task-1', 'alpha\n')
  await appendTaskOutput('task-1', 'beta\n')
  await appendTaskOutput('task-1', 'gamma\n')

  expect(await readTaskOutput('task-1')).toBe('alpha\nbeta\ngamma\n')
  expect(await readTaskOutputTail('task-1', 6)).toBe('gamma\n')
  expect(await readTaskOutputTailResult('task-1', 6)).toEqual({
    text: 'gamma\n',
    truncated: true,
  })
})
