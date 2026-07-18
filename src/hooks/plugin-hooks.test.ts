import { afterEach, beforeEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { HookManager } from './plugin-hooks'

let root: string
let home: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'gambit-hooks-root-'))
  home = await mkdtemp(path.join(tmpdir(), 'gambit-hooks-home-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

test('loads project and opencode-compatible plugins', async () => {
  await mkdir(path.join(root, '.gambit', 'plugins'), { recursive: true })
  await mkdir(path.join(root, '.opencode', 'plugins'), { recursive: true })

  await writeFile(
    path.join(root, '.gambit', 'plugins', 'one.ts'),
    "export default () => ({ event: async () => {} })\n",
  )
  await writeFile(
    path.join(root, '.opencode', 'plugins', 'two.js'),
    "export const Plugin = () => ({ event: async () => {} })\n",
  )

  const manager = await HookManager.load({ root, userHome: home, importSuffix: randomUUID() })

  expect(manager.list().map((plugin) => path.basename(plugin.filePath))).toEqual(['one.ts', 'two.js'])
})

test('runs hooks sequentially and allows mutation', async () => {
  await mkdir(path.join(root, '.gambit', 'plugins'), { recursive: true })
  await writeFile(
    path.join(root, '.gambit', 'plugins', 'mutate.ts'),
    `export default () => ({
      'tool.execute.before': async (_input, output) => {
        output.args = { ...output.args, injected: true }
      },
      'tool.execute.after': async (_input, output) => {
        output.output = 'rewritten'
        output.summary = 'rewritten summary'
      },
      'command.execute.before': async (_input, output) => {
        output.content += '\\nfrom hook'
      },
    })\n`,
  )

  const manager = await HookManager.load({ root, userHome: home, importSuffix: randomUUID() })

  await expect(manager.runToolBefore({ tool: 'readFile', callID: 'call-1', args: { path: 'a' } })).resolves.toEqual({
    path: 'a',
    injected: true,
  })
  await expect(
    manager.runToolAfter({ tool: 'readFile', callID: 'call-1', args: {}, output: 'original', summary: 'original summary' }),
  ).resolves.toEqual({ output: 'rewritten', summary: 'rewritten summary', metadata: undefined })
  await expect(
    manager.runCommandBefore({ command: '/review', arguments: '', content: 'review changes' }),
  ).resolves.toBe('review changes\nfrom hook')
})
