import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { resolveReadablePath, resolveWorkspacePath } from './workspace'

let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gambit-workspace-'))
  outside = await mkdtemp(path.join(os.tmpdir(), 'gambit-outside-'))
  setWorkspaceRootForTesting(root)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

test('rejects sibling paths that only share a string prefix', () => {
  const sibling = `${root}-sibling/file.txt`

  expect(() => resolveWorkspacePath(sibling)).toThrow('Access denied')
})

test('allows paths inside the workspace root', () => {
  expect(resolveWorkspacePath('src/index.ts')).toBe(path.join(root, 'src', 'index.ts'))
})

test('rejects directory symlinks that escape the workspace root', async () => {
  await symlink(outside, path.join(root, 'link'))

  // Read through the symlink.
  expect(() => resolveWorkspacePath('link/secret.txt')).toThrow('Access denied')
  expect(() => resolveReadablePath('link/secret.txt')).toThrow('Access denied')
})

test('rejects file symlinks pointing at existing files outside the workspace', async () => {
  await writeFile(path.join(outside, 'data.txt'), 'outside data')
  await symlink(path.join(outside, 'data.txt'), path.join(root, 'data-link.txt'))

  expect(() => resolveWorkspacePath('data-link.txt')).toThrow('Access denied')
  expect(() => resolveReadablePath('data-link.txt')).toThrow('Access denied')
})

test('rejects broken symlinks whose write would materialize outside the workspace', async () => {
  // Target does not exist yet: a write through the link would create it outside.
  await symlink(path.join(outside, 'not-yet-created.txt'), path.join(root, 'broken-link.txt'))

  expect(() => resolveWorkspacePath('broken-link.txt')).toThrow('Access denied')
})

test('allows benign symlinks that stay inside the workspace', async () => {
  await mkdir(path.join(root, 'real-dir'), { recursive: true })
  await writeFile(path.join(root, 'real-dir', 'file.txt'), 'content')
  await symlink(path.join(root, 'real-dir'), path.join(root, 'alias'))

  // Existing file through an internal symlink (read path).
  expect(resolveWorkspacePath('alias/file.txt')).toBe(path.join(root, 'alias', 'file.txt'))
  expect(resolveReadablePath('alias/file.txt').absolutePath).toBe(path.join(root, 'alias', 'file.txt'))

  // Not-yet-existing file through an internal symlink (write path).
  expect(resolveWorkspacePath('alias/new-file.txt')).toBe(path.join(root, 'alias', 'new-file.txt'))
})
