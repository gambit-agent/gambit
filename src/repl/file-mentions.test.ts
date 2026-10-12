import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { setWorkspaceRootForTesting, workspaceRoot } from '../config'

import {
  expandFileMentions,
  findActiveFileMention,
  getFileMentionMatches,
  replaceActiveFileMention,
} from './file-mentions'

const originalWorkspaceRoot = workspaceRoot
let tempRoot: string | null = null

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

async function createTempWorkspace(): Promise<string> {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-file-mentions-'))
  return tempRoot
}

describe('file mentions', () => {
  test('finds the active mention at the cursor', () => {
    expect(findActiveFileMention('review @src/repl', 'review @src/repl'.length)).toEqual({
      start: 7,
      end: 16,
      query: 'src/repl',
    })
    expect(findActiveFileMention('email a@b.test', 'email a@b.test'.length)).toBeNull()
  })

  test('replaces the active mention and places the cursor after the inserted path', () => {
    const mention = findActiveFileMention('review @src/re', 'review @src/re'.length)
    expect(mention).not.toBeNull()

    const result = replaceActiveFileMention('review @src/re', mention!, 'src/repl/ReplScreen.tsx')
    expect(result.value).toBe('review @src/repl/ReplScreen.tsx ')
    expect(result.cursorOffset).toBe(result.value.length)
  })

  test('expands exact file mentions into bounded file context', async () => {
    const root = await createTempWorkspace()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'app.ts'), 'export const value = 1\n', 'utf8')

    const result = await expandFileMentions('review @src/app.ts, please', {
      rootPath: root,
      workspaceFiles: ['src/app.ts'],
    })

    expect(result.files.map((file) => file.path)).toEqual(['src/app.ts'])
    expect(result.content).toContain('<file path="src/app.ts">')
    expect(result.content).toContain('export const value = 1')
  })

  test('leaves prompt templates alone when no mentioned file exists', async () => {
    const root = await createTempWorkspace()
    const result = await expandFileMentions('@template arg', {
      rootPath: root,
      workspaceFiles: ['src/app.ts'],
    })

    expect(result.files).toEqual([])
    expect(result.content).toBe('@template arg')
  })

  test('treats backslash queries as invalid and lists all files', async () => {
    const root = await createTempWorkspace()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'app.ts'), 'test', 'utf8')
    setWorkspaceRootForTesting(root)
    const matches = await getFileMentionMatches('src\\foo')
    const baseline = await getFileMentionMatches('')
    expect(matches).toEqual(baseline)
    expect(baseline.map((match) => match.path)).toEqual(['src/app.ts'])
  })

  test('scans the supplied root when no file list is provided', async () => {
    const root = await createTempWorkspace()
    await writeFile(path.join(root, 'local.txt'), 'local context', 'utf8')
    const result = await expandFileMentions('review @local.txt', { rootPath: root })
    expect(result.files.map((file) => file.content)).toEqual(['local context'])
  })

  test('omits deleted files while expanding the remaining mentions', async () => {
    const root = await createTempWorkspace()
    await writeFile(path.join(root, 'present.txt'), 'still here', 'utf8')
    const result = await expandFileMentions('review @deleted.txt and @present.txt', {
      rootPath: root,
      workspaceFiles: ['deleted.txt', 'present.txt'],
    })
    expect(result.omitted).toEqual(['deleted.txt'])
    expect(result.files.map((file) => file.path)).toEqual(['present.txt'])
  })

  test('omits directories that replaced a listed file', async () => {
    const root = await createTempWorkspace()
    await mkdir(path.join(root, 'replaced.txt'))
    const result = await expandFileMentions('review @replaced.txt', {
      rootPath: root,
      workspaceFiles: ['replaced.txt'],
    })
    expect(result.files).toEqual([])
    expect(result.omitted).toEqual(['replaced.txt'])
    expect(result.content).toBe('review @replaced.txt')
  })

  test('enforces the byte budget across files and marks truncated context', async () => {
    const root = await createTempWorkspace()
    await writeFile(path.join(root, 'first.txt'), '123456')
    await writeFile(path.join(root, 'second.txt'), 'abcdef')
    const result = await expandFileMentions('review @first.txt @second.txt', {
      rootPath: root,
      workspaceFiles: ['first.txt', 'second.txt'],
      maxFileBytes: 4,
      maxTotalBytes: 6,
    })
    expect(result.files).toEqual([
      { path: 'first.txt', content: '1234', truncated: true },
      { path: 'second.txt', content: 'ab', truncated: true },
    ])
  })
})
