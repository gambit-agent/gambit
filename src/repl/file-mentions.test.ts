import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import {
  expandFileMentions,
  findActiveFileMention,
  replaceActiveFileMention,
} from './file-mentions'

let tempRoot: string | null = null

afterEach(async () => {
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
})
