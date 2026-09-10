import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { getWorkspaceFiles } from './workspace-files'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-workspace-files-'))
  setWorkspaceRootForTesting(tempRoot)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await rm(tempRoot, { recursive: true, force: true })
})

describe('getWorkspaceFiles', () => {
  test('lists only regular files, relative and sorted, skipping excluded directories', async () => {
    await mkdir(path.join(tempRoot, 'src', 'nested', 'empty-dir'), { recursive: true })
    await mkdir(path.join(tempRoot, 'node_modules', 'dep'), { recursive: true })
    await mkdir(path.join(tempRoot, '.git'), { recursive: true })
    await writeFile(path.join(tempRoot, 'src', 'nested', 'b.ts'), 'b', 'utf8')
    await writeFile(path.join(tempRoot, 'src', 'a.ts'), 'a', 'utf8')
    await writeFile(path.join(tempRoot, 'README.md'), 'readme', 'utf8')
    await writeFile(path.join(tempRoot, 'node_modules', 'dep', 'index.js'), 'x', 'utf8')
    await writeFile(path.join(tempRoot, '.git', 'HEAD'), 'ref', 'utf8')

    const files = await getWorkspaceFiles(true)

    expect(files).toEqual(['README.md', path.join('src', 'a.ts'), path.join('src', 'nested', 'b.ts')])
  })

  test('returns the cached listing until a refresh is forced', async () => {
    await writeFile(path.join(tempRoot, 'first.ts'), '1', 'utf8')
    const first = await getWorkspaceFiles(true)
    expect(first).toEqual(['first.ts'])

    await writeFile(path.join(tempRoot, 'second.ts'), '2', 'utf8')
    expect(await getWorkspaceFiles()).toBe(first)
    expect(await getWorkspaceFiles(true)).toEqual(['first.ts', 'second.ts'])
  })
})
