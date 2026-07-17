import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAgentRun, loadAgentTranscript, readAgentRecord } from './agent-runtime'
import { DEFAULT_AGENT_DEFINITIONS } from './agent-definitions'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-agent-runtime-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('creates a persistent agent run and updates its state', async () => {
  const handle = await createAgentRun(DEFAULT_AGENT_DEFINITIONS.explorer, 'Inspect workspace', {
    rootPath: tempRoot,
  })

  await handle.appendTranscript({
    kind: 'message',
    role: 'assistant',
    content: 'Investigating',
  })

  const running = await handle.updateProgress('halfway there')
  expect(running.status).toBe('running')
  expect(running.progressSummary).toBe('halfway there')

  const completed = await handle.complete('final output', 'done')
  expect(completed.status).toBe('completed')

  const loadedRecord = await readAgentRecord(handle.record.id, tempRoot)
  expect(loadedRecord?.status).toBe('completed')
  expect(loadedRecord?.progressSummary).toBe('done')

  const transcript = await loadAgentTranscript(handle.record.id, tempRoot)
  expect(transcript).toHaveLength(1)
  expect(await readFile(handle.record.outputPath, 'utf8')).toContain('final output')
  expect(handle.record.outputPath).toContain(path.join('.gambit', 'agents'))
})
