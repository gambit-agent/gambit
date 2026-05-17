import { expect, test } from 'bun:test'
import { z } from 'zod'

import { HookManager } from '../hooks/plugin-hooks'
import { createToolExecutor } from './tool-executor'
import { createToolRegistry } from './tool-registry'

test('tool executor runs plugin hooks around execution', async () => {
  const registry = createToolRegistry([
    {
      id: 'echo',
      displayName: 'Echo',
      description: 'Echo input',
      inputSchema: z.object({ value: z.string(), injected: z.boolean().optional() }),
      execute: async (input) => `${input.value}:${input.injected === true}`,
    },
  ])
  const manager = HookManager.fromHooks([
    {
      filePath: 'inline',
      hooks: {
        'tool.execute.before': async (_input: unknown, output: { args: any }) => {
          output.args = { ...output.args, injected: true }
        },
        'tool.execute.after': async (_input: unknown, output: { output: unknown; summary?: string }) => {
          output.output = `hooked:${output.output}`
          output.summary = 'hooked summary'
        },
      },
    },
  ])

  const executor = createToolExecutor(registry)
  const result = await executor.execute('echo', { value: 'hello' }, { hookManager: manager })

  expect(result.input).toEqual({ value: 'hello', injected: true })
  expect(result.output).toBe('hooked:hello:true')
  expect(result.summary).toBe('hooked summary')
})
