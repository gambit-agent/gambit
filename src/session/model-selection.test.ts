import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { getModelSelectionPath } from './session-paths'
import { readModelSelection, writeModelSelection } from './model-selection'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-model-selection-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('writes and reads the persisted model selection', async () => {
  await writeModelSelection(
    {
      modelId: 'openai/gpt-5',
      reasoningEffort: 'high',
      providerSlug: 'DeepInfra/Turbo',
    },
    tempRoot,
  )

  await expect(readModelSelection(tempRoot)).resolves.toEqual({
    modelId: 'openai/gpt-5',
    reasoningEffort: 'high',
    providerSlug: 'deepinfra/turbo',
  })
})

test('returns null when the selection file is missing or malformed', async () => {
  await expect(readModelSelection(tempRoot)).resolves.toBeNull()

  const filePath = getModelSelectionPath(tempRoot)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, '{"modelId":42}', 'utf8')

  await expect(readModelSelection(tempRoot)).resolves.toBeNull()
})

test('treats unknown reasoning effort values as null', async () => {
  const filePath = getModelSelectionPath(tempRoot)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    JSON.stringify({
      modelId: 'anthropic/claude-sonnet-4',
      reasoningEffort: 'max',
    }),
    'utf8',
  )

  await expect(readModelSelection(tempRoot)).resolves.toEqual({
    modelId: 'anthropic/claude-sonnet-4',
    reasoningEffort: null,
    providerSlug: null,
  })
})
