import { expect, test } from 'bun:test'

import { createRuntimeToolRegistry } from './index'
import { createToolExecutor } from './tool-executor'
import type { RunAgentTaskInput } from '../tasks/agent-task-runner'

test('spawnAgent passes incremented delegation depth to child agents', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)
  const captured: RunAgentTaskInput[] = []
  const agentTaskRunner = {
    run: async (input: RunAgentTaskInput) => {
      captured.push(input)
      return {
        task: {
          id: 'task-1',
          kind: 'agent',
          title: 'child',
          status: 'completed',
          background: false,
          createdAt: new Date().toISOString(),
        },
        output: 'child output',
        summary: 'child summary',
      }
    },
  }

  const result = await executor.execute(
    'spawnAgent',
    { role: 'worker', prompt: 'inspect', background: false },
    {
      agentTaskRunner: agentTaskRunner as any,
      agentExecutionOptions: {
        apiKey: 'test-key',
        modelId: 'test-model',
        baseSystemPrompt: 'base',
        delegationDepth: 1,
        maxDelegationDepth: 3,
        maxSteps: 123,
      },
    },
  )

  expect(result.output).toContain('child output')
  expect(captured[0]?.agentExecutionOptions?.delegationDepth).toBe(2)
  expect(captured[0]?.agentExecutionOptions?.maxDelegationDepth).toBe(3)
  expect(captured[0]?.agentExecutionOptions?.maxSteps).toBe(123)
})

test('spawnAgent rejects runs beyond the delegation depth limit', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)

  await expect(
    executor.execute(
      'spawnAgent',
      { role: 'worker', prompt: 'inspect', background: false },
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
