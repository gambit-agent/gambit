import { expect, test } from 'bun:test'

import { runWorkflow } from './workflow-runtime'
import type { WorkflowAgentRunOptions } from './workflow-types'

test('runWorkflow records runtime phases and delegates to injected agents', async () => {
  const calls: Array<{ prompt: string; options: WorkflowAgentRunOptions }> = []
  const phases: string[] = []
  const result = await runWorkflow(
    `
export const meta = { name: 'fanout', description: 'fan out' }
phase('Inspect')
const outputs = await parallel(['a', 'b'].map(item => () => agent('check ' + item, {
  label: 'check ' + item,
  role: 'explorer',
  model: 'fast-model',
})))
return { outputs, remaining: budget.remaining() }
`,
    {
      tokenBudget: 1000,
      onPhase: (phase) => phases.push(phase),
      agent: {
        run: async (prompt, options) => {
          calls.push({ prompt, options })
          return `${options.role}:${options.modelId}:${prompt}`
        },
      },
    },
  )

  expect(result.meta.name).toBe('fanout')
  expect(result.phases).toEqual(['Inspect'])
  expect(phases).toEqual(['Inspect'])
  expect(result.agentCount).toBe(2)
  expect(calls.map((call) => call.options.role)).toEqual(['explorer', 'explorer'])
  expect(calls.map((call) => call.options.modelId)).toEqual(['fast-model', 'fast-model'])
  expect(result.result).toMatchObject({
    outputs: ['explorer:fast-model:check a', 'explorer:fast-model:check b'],
  })
  expect((result.result as { remaining: number }).remaining).toBeLessThan(1000)
})

test('runWorkflow supports pipelines with sequential stages per item', async () => {
  const result = await runWorkflow(
    `
export const meta = { name: 'pipeline_demo', description: 'pipeline' }
phase('Pipe')
return await pipeline(
  ['one', 'two'],
  item => agent('first ' + item, { label: 'first ' + item }),
  value => agent('second ' + value, { label: 'second ' + value })
)
`,
    {
      agent: {
        run: async (prompt) => prompt.toUpperCase(),
      },
    },
  )

  expect(result.result).toEqual(['SECOND FIRST ONE', 'SECOND FIRST TWO'])
  expect(result.agentCount).toBe(4)
})

test('runWorkflow rejects unawaited agent promises before returning details', async () => {
  await expect(
    runWorkflow(
      `
export const meta = { name: 'forgot_await', description: 'missing await' }
return { value: agent('do work') }
`,
      {
        agent: {
          run: async () => 'done',
        },
      },
    ),
  ).rejects.toThrow('did you forget to await agent(), parallel(), or pipeline()?')
})

test('runWorkflow returns null and logs failed non-aborted agent branches', async () => {
  const logs: string[] = []
  const result = await runWorkflow(
    `
export const meta = { name: 'failed_branch', description: 'failure' }
phase('Try')
const value = await agent('will fail', { label: 'bad branch' })
return { value }
`,
    {
      onLog: (message) => logs.push(message),
      agent: {
        run: async () => {
          throw new Error('branch failed')
        },
      },
    },
  )

  expect(result.result).toEqual({ value: null })
  expect(logs[0]).toContain('bad branch failed: branch failed')
})

test('runWorkflow rejects parallel promises instead of thunks', async () => {
  await expect(
    runWorkflow(
      `
export const meta = { name: 'bad_parallel', description: 'bad parallel' }
return await parallel([agent('already started')])
`,
      {
        agent: {
          run: async () => 'done',
        },
      },
    ),
  ).rejects.toThrow('parallel() expects an array of functions')
})
