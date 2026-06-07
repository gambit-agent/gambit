import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { loadSystemPrompt } from './prompt'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-prompt-'))
  setWorkspaceRootForTesting(tempRoot)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await rm(tempRoot, { recursive: true, force: true })
})

test('default system prompt concisely covers core orchestration features', async () => {
  const prompt = await loadSystemPrompt()

  expect(prompt.split('\n')).toHaveLength(7)
  expect(prompt).toContain('enterPlanMode')
  expect(prompt).toContain('MCP tools')
  expect(prompt).toContain('spawnAgent/runAgents')
  expect(prompt).toContain('workflow')
  expect(prompt).toContain('phase(), agent(), parallel(), pipeline()')
})

test('system.prompt.md still overrides the default prompt', async () => {
  await writeFile(path.join(tempRoot, 'system.prompt.md'), 'Custom prompt', 'utf8')

  expect(await loadSystemPrompt()).toBe('Custom prompt')
})
