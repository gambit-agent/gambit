import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting } from '../config'
import { AgentTaskRunner } from './agent-task-runner'
import { TaskRuntime } from './task-runtime'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gambit-agent-task-runner-'))
  setWorkspaceRootForTesting(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('streamBatch cancels already launched agents when another launch fails', async () => {
  const runtime = new TaskRuntime()
  await runtime.initialize()
  const agentRunner = {
    run: async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      throw new Error('cancelled')
    },
  }
  const runner = new AgentTaskRunner(runtime, agentRunner as any, async () => ({}))

  await expect(
    runner.runBatch({
      agents: [
        { role: 'worker', prompt: 'keep running' },
        { role: 'missing' as any, prompt: 'fail during launch' },
      ],
      apiKey: 'test-key',
      modelId: 'test-model',
      baseSystemPrompt: 'base',
    }),
  ).rejects.toThrow('Unknown agent role: missing')

  const [task] = runtime.getSnapshot().tasks
  expect(task).toMatchObject({
    kind: 'agent',
    status: 'cancelled',
  })
})
