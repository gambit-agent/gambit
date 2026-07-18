import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { findRelevantMemoryRecords, loadRelevantMemoryRecords } from './memory-retrieval'
import { getMemoryIndexPath } from './memory-paths'
import { readMemoryRecord, refreshMemoryIndex, writeMemoryRecord } from './memory-store'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-memory-store-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('writes typed memory files and refreshes the index', async () => {
  const first = await writeMemoryRecord(
    {
      name: 'Communication preference',
      description: 'Keep responses terse',
      type: 'feedback',
      content: 'Use short answers and skip trailing summaries.',
      updated: '2026-03-31',
    },
    tempRoot,
  )

  const second = await writeMemoryRecord(
    {
      name: 'Project scope',
      description: 'Phase one stays local',
      type: 'project',
      content: 'Remote execution is deferred.',
      updated: '2026-03-30',
    },
    tempRoot,
  )

  expect(await readMemoryRecord(first.path)).toMatchObject({
    name: 'Communication preference',
    type: 'feedback',
  })
  expect(await readMemoryRecord(second.path)).toMatchObject({
    name: 'Project scope',
    type: 'project',
  })

  const indexContents = await readFile(getMemoryIndexPath(tempRoot), 'utf8')
  expect(indexContents).toContain('Communication preference')
  expect(indexContents).toContain('Project scope')
})

test('selects relevant memories by query terms', async () => {
  await writeMemoryRecord(
    {
      name: 'Response style',
      description: 'Prefer concise replies',
      type: 'feedback',
      content: 'Avoid long recaps.',
      updated: '2026-03-31',
    },
    tempRoot,
  )

  await writeMemoryRecord(
    {
      name: 'Task runtime',
      description: 'Persist long-running work',
      type: 'project',
      content: 'Represent background work as tasks.',
      updated: '2026-03-30',
    },
    tempRoot,
  )

  const records = await loadRelevantMemoryRecords('I want terse replies', {
    rootPath: tempRoot,
    limit: 1,
  })

  expect(records).toHaveLength(1)
  expect(records[0]?.name).toBe('Response style')

  const scored = findRelevantMemoryRecords('background work', records, { limit: 5 })
  expect(scored).toHaveLength(0)
})

test('refreshes the index after manual file updates', async () => {
  await mkdir(path.join(tempRoot, '.gambit', 'memory'), { recursive: true })
  await writeFile(
    path.join(tempRoot, '.gambit', 'memory', 'manual.feedback.md'),
    [
      '---',
      'name: Manual',
      'description: Updated by hand',
      'type: feedback',
      'updated: 2026-03-29',
      '---',
      '',
      'Body',
      '',
    ].join('\n'),
  )

  const index = await refreshMemoryIndex(tempRoot)
  expect(index).toContain('Manual')
})
