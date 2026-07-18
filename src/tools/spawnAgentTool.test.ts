import { expect, test } from 'bun:test'

import { DEFAULT_MAX_DELEGATION_DEPTH, maxDelegationDepth } from '../config'
import { createRuntimeToolRegistry } from './index'
import { createToolExecutor } from './tool-executor'
import type { RunAgentTaskInput } from '../tasks/agent-task-runner'

test('default nested delegation depth is five', () => {
  expect(DEFAULT_MAX_DELEGATION_DEPTH).toBe(5)
})

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

test('spawnAgent uses configured default max depth when omitted by context', async () => {
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

  await executor.execute(
    'spawnAgent',
    { role: 'worker', prompt: 'inspect', background: false },
    {
      agentTaskRunner: agentTaskRunner as any,
      agentExecutionOptions: {
        apiKey: 'test-key',
        modelId: 'test-model',
        baseSystemPrompt: 'base',
        delegationDepth: 1,
      },
    },
  )

  expect(captured[0]?.agentExecutionOptions?.delegationDepth).toBe(2)
  expect(captured[0]?.agentExecutionOptions?.maxDelegationDepth).toBe(maxDelegationDepth)
})

test('runAgents starts a concurrent batch with incremented delegation depth', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)
  const captured: any[] = []
  const agentTaskRunner = {
    runBatch: async (input: any) => {
      captured.push(input)
      return {
        tasks: [
          {
            task: {
              id: 'task-1',
              kind: 'agent',
              title: 'first',
              status: 'completed',
              background: true,
              createdAt: new Date().toISOString(),
            },
            output: 'first output',
          },
          {
            task: {
              id: 'task-2',
              kind: 'agent',
              title: 'second',
              status: 'completed',
              background: true,
              createdAt: new Date().toISOString(),
            },
            output: 'second output',
          },
        ],
      }
    },
  }

  const result = await executor.execute(
    'runAgents',
    {
      agents: [
        { role: 'explorer', prompt: 'inspect a', description: 'first' },
        { role: 'worker', prompt: 'inspect b', description: 'second' },
      ],
    },
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

  expect(result.output).toContain('first output')
  expect(result.output).toContain('second output')
  expect(captured[0]?.agents).toHaveLength(2)
  expect(captured[0]?.agentExecutionOptions?.delegationDepth).toBe(2)
  expect(captured[0]?.agentExecutionOptions?.maxDelegationDepth).toBe(3)
  expect(captured[0]?.agentExecutionOptions?.maxSteps).toBe(123)
})

test('spawnAgent runs in foreground by default', async () => {
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

  await executor.execute(
    'spawnAgent',
    { role: 'worker', prompt: 'inspect' },
    {
      agentTaskRunner: agentTaskRunner as any,
      agentExecutionOptions: {
        apiKey: 'test-key',
        modelId: 'test-model',
        baseSystemPrompt: 'base',
        delegationDepth: 1,
        maxDelegationDepth: 3,
      },
    },
  )

  expect(captured[0]?.background).toBe(false)
})

test('runAgents rejects runs beyond the delegation depth limit', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)

  await expect(
    executor.execute(
      'runAgents',
      { agents: [{ role: 'worker', prompt: 'inspect' }] },
      {
        agentTaskRunner: { runBatch: async () => ({ tasks: [] }) } as any,
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
