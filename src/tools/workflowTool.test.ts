import { expect, test } from 'bun:test'

import { createRuntimeToolRegistry } from './index'
import { createToolExecutor } from './tool-executor'
import type { RunAgentTaskInput } from '../tasks/agent-task-runner'

function createCompletedTask(id: string, title: string) {
  return {
    id,
    kind: 'agent' as const,
    title,
    status: 'completed' as const,
    background: false,
    createdAt: new Date().toISOString(),
  }
}

test('workflow tool runs scripts through existing AgentTaskRunner and captures structured output', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)
  const captured: RunAgentTaskInput[] = []
  const agentTaskRunner = {
    run: async (input: RunAgentTaskInput) => {
      captured.push(input)
      if (input.extraTools?.structured_output) {
        await (input.extraTools.structured_output as any).execute({ ok: true, note: 'captured' })
      }
      return {
        task: createCompletedTask(`task-${captured.length}`, input.title ?? 'workflow agent'),
        output: 'plain output',
        summary: 'plain summary',
      }
    },
  }

  const result = await executor.execute(
    'workflow',
    {
      script: `
export const meta = { name: 'structured_demo', description: 'structured output' }
phase('Collect')
const value = await agent('return structured output', {
  label: 'collector',
  role: 'explorer',
  model: 'alternate-model',
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      note: { type: 'string' },
    },
    required: ['ok', 'note'],
  },
})
return value
`,
      concurrency: 2,
    },
    {
      agentTaskRunner: agentTaskRunner as any,
      agentExecutionOptions: {
        apiKey: 'test-key',
        modelId: 'default-model',
        baseSystemPrompt: 'base plus goal',
        delegationDepth: 0,
        maxDelegationDepth: 3,
        maxSteps: 99,
      },
    },
  )

  expect(result.output).toContain('Workflow structured_demo completed with 1 agent(s).')
  expect(result.output).toContain('"ok": true')
  expect(captured).toHaveLength(1)
  expect(captured[0]?.role).toBe('explorer')
  expect(captured[0]?.background).toBe(false)
  expect(captured[0]?.modelId).toBe('alternate-model')
  expect(captured[0]?.baseSystemPrompt).toBe('base plus goal')
  expect(captured[0]?.agentExecutionOptions?.delegationDepth).toBe(1)
  expect(captured[0]?.agentExecutionOptions?.maxDelegationDepth).toBe(3)
  expect(captured[0]?.agentExecutionOptions?.maxSteps).toBe(99)
})

test('workflow tool rejects runs beyond the delegation depth limit', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)

  await expect(
    executor.execute(
      'workflow',
      {
        script: `
export const meta = { name: 'too_deep', description: 'too deep' }
return await agent('nope')
`,
      },
      {
        agentTaskRunner: { run: async () => ({}) } as any,
        agentExecutionOptions: {
          apiKey: 'test-key',
          modelId: 'test-model',
          baseSystemPrompt: 'base',
          delegationDepth: 3,
          maxDelegationDepth: 3,
        },
      },
    ),
  ).rejects.toThrow('Maximum delegation depth reached')
})
