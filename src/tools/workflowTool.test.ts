import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { maxDelegationDepth, setWorkspaceRootForTesting, workspaceRoot } from '../config'
import { createRuntimeToolRegistry } from './index'
import { createToolExecutor } from './tool-executor'
import type { RunAgentTaskInput } from '../tasks/agent-task-runner'
import { readTaskOutput } from '../tasks/task-output'
import { TaskRuntime } from '../tasks/task-runtime'

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

test('workflow tool uses configured default max depth when omitted by context', async () => {
  const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
  const executor = createToolExecutor(registry)
  const captured: RunAgentTaskInput[] = []
  const agentTaskRunner = {
    run: async (input: RunAgentTaskInput) => {
      captured.push(input)
      return {
        task: createCompletedTask(`task-${captured.length}`, input.title ?? 'workflow agent'),
        output: 'plain output',
        summary: 'plain summary',
      }
    },
  }

  await executor.execute(
    'workflow',
    {
      script: `
export const meta = { name: 'default_depth', description: 'default depth' }
return await agent('inspect', { label: 'inspect' })
`,
    },
    {
      agentTaskRunner: agentTaskRunner as any,
      agentExecutionOptions: {
        apiKey: 'test-key',
        modelId: 'test-model',
        baseSystemPrompt: 'base',
        delegationDepth: 0,
      },
    },
  )

  expect(captured[0]?.agentExecutionOptions?.delegationDepth).toBe(1)
  expect(captured[0]?.agentExecutionOptions?.maxDelegationDepth).toBe(maxDelegationDepth)
})

test('workflow tool publishes workflow task state for the TUI', async () => {
  const previousRoot = workspaceRoot
  const root = await mkdtemp(path.join(os.tmpdir(), 'gambit-workflow-task-'))
  setWorkspaceRootForTesting(root)

  try {
    const taskRuntime = new TaskRuntime()
    await taskRuntime.initialize()
    const registry = await createRuntimeToolRegistry({ includeSpawnAgent: true, includeMCPTools: false })
    const executor = createToolExecutor(registry)
    const agentTaskRunner = {
      run: async (input: RunAgentTaskInput) => ({
        task: createCompletedTask('agent-task-1', input.title ?? 'workflow agent'),
        output: 'agent output',
        summary: 'agent summary',
      }),
    }

    await executor.execute(
      'workflow',
      {
        script: `
export const meta = { name: 'task_dashboard', description: 'dashboard state' }
phase('Inspect')
const value = await agent('inspect files', { label: 'inspector', role: 'explorer' })
return { value }
`,
      },
      {
        taskRuntime,
        agentTaskRunner: agentTaskRunner as any,
        agentExecutionOptions: {
          apiKey: 'test-key',
          modelId: 'test-model',
          baseSystemPrompt: 'base',
          delegationDepth: 0,
          maxDelegationDepth: 3,
        },
      },
    )

    const workflowTask = taskRuntime.getSnapshot().tasks.find((task) => task.kind === 'workflow')
    expect(workflowTask).toMatchObject({
      kind: 'workflow',
      status: 'completed',
      title: 'Workflow - task_dashboard',
    })
    expect(workflowTask?.metadata?.workflowName).toBe('task_dashboard')
    const snapshot = workflowTask?.metadata?.workflowSnapshot as any
    expect(snapshot.currentPhase).toBe('Inspect')
    expect(snapshot.agents[0]).toMatchObject({
      label: 'inspector',
      status: 'done',
    })
    expect(await readTaskOutput(workflowTask!.id)).toContain('Workflow task_dashboard completed')
  } finally {
    setWorkspaceRootForTesting(previousRoot)
    await rm(root, { recursive: true, force: true })
  }
})
