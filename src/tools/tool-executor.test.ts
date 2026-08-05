import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

import { createToolExecutor } from './tool-executor'
import { createToolRegistry } from './tool-registry'
import type { ToolDefinition, ToolEventRecord } from './tool-types'

let tempRoot: string
let outputDir: string
let events: ToolEventRecord[]

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-tool-executor-'))
  outputDir = path.join(tempRoot, '.gambit', 'tool-results')
  events = []
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('validates input before executing a tool', async () => {
  const schema = z.object({
    value: z.string(),
  })
  const definition: ToolDefinition<typeof schema, string> = {
    id: 'validated',
    displayName: 'Validated',
    description: 'Validated tool',
    inputSchema: schema,
    execute: async () => 'ok',
  }

  const executor = createToolExecutor(createToolRegistry([definition]), {
    workspaceRoot: tempRoot,
    outputDirectory: outputDir,
    onEvent: (event) => events.push(event),
  })

  await expect(executor.execute('validated', {})).rejects.toThrow()
  expect(events[0]?.status).toBe('started')
  expect(events.at(-1)?.status).toBe('failed')
})

test('persists large string results to an artifact file', async () => {
  const schema = z.object({
    size: z.number(),
  })
  const definition: ToolDefinition<typeof schema, string> = {
    id: 'large-result',
    displayName: 'Large Result',
    description: 'Returns a long string',
    inputSchema: schema,
    execute: async ({ size }) => 'x'.repeat(size),
  }

  const executor = createToolExecutor(createToolRegistry([definition]), {
    workspaceRoot: tempRoot,
    outputDirectory: outputDir,
    maxInlineResultChars: 16,
    onEvent: (event) => events.push(event),
  })

  const result = await executor.execute('large-result', { size: 64 })

  expect(result.artifactPath).toBe(path.join(outputDir, `${result.toolCallId}.txt`))
  expect(await Bun.file(result.artifactPath!).text()).toHaveLength(64)
  expect(result.summary).toContain('Stored large tool result')
  expect(events.map((event) => event.status)).toEqual(['started', 'completed'])
})

test('a traversing tool call id cannot write an artifact outside the results directory', async () => {
  const schema = z.object({ size: z.number() })
  const definition: ToolDefinition<typeof schema, string> = {
    id: 'bulky',
    displayName: 'Bulky',
    description: 'Returns a large string.',
    inputSchema: schema,
    execute: async ({ size }) => 'x'.repeat(size),
  }
  const executor = createToolExecutor(createToolRegistry([definition]), {
    workspaceRoot: tempRoot,
    outputDirectory: outputDir,
    maxInlineResultChars: 10,
    onEvent: (event) => events.push(event),
  })

  // toolCallId comes from the model provider, so it is untrusted.
  const result = await executor.execute('bulky', { size: 50 }, {
    workspaceRoot: tempRoot,
    toolCallId: '../../../escaped',
  })

  expect(result.artifactPath).toBeTruthy()
  const artifactPath = result.artifactPath!
  expect(path.dirname(path.resolve(artifactPath))).toBe(path.resolve(outputDir))
  expect(await Bun.file(artifactPath).exists()).toBe(true)
  expect(await Bun.file(path.resolve(tempRoot, '..', '..', '..', 'escaped.txt')).exists()).toBe(false)
})

test('resolveArtifactPath rejects a separator-only tool call id', async () => {
  const { resolveArtifactPath } = await import('./tool-execution-pipeline')

  expect(path.dirname(resolveArtifactPath(outputDir, '../../evil'))).toBe(path.resolve(outputDir))
  expect(path.dirname(resolveArtifactPath(outputDir, 'a/b/c'))).toBe(path.resolve(outputDir))
  // An id that sanitizes to nothing still produces a usable in-directory name.
  expect(path.dirname(resolveArtifactPath(outputDir, '...'))).toBe(path.resolve(outputDir))
})
