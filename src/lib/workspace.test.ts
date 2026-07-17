import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { resolveWorkspacePath } from './workspace'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gambit-workspace-'))
  setWorkspaceRootForTesting(root)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await rm(root, { recursive: true, force: true })
})

test('rejects sibling paths that only share a string prefix', () => {
  const sibling = `${root}-sibling/file.txt`

  expect(() => resolveWorkspacePath(sibling)).toThrow('Access denied')
})

test('allows paths inside the workspace root', () => {
  expect(resolveWorkspacePath('src/index.ts')).toBe(path.join(root, 'src', 'index.ts'))
})
