import { expect, test } from 'bun:test'
import { z } from 'zod'

import { createToolRegistry } from './tool-registry'
import type { ToolDefinition } from './tool-types'

test('registers and resolves tools by id', () => {
  const schema = z.object({
    value: z.string(),
  })

  const definition: ToolDefinition<typeof schema, string> = {
    id: 'example',
    displayName: 'Example',
    description: 'Example tool',
    inputSchema: schema,
    execute: async () => 'ok',
  }

  const registry = createToolRegistry([definition])

  expect(registry.get('example')).toBe(definition)
  expect(registry.list()).toHaveLength(1)
})

test('rejects duplicate tool ids', () => {
  const schema = z.object({
    value: z.string(),
  })
  const definition: ToolDefinition<typeof schema, string> = {
    id: 'duplicate',
    displayName: 'Duplicate',
    description: 'Duplicate tool',
    inputSchema: schema,
    execute: async () => 'ok',
  }

  const registry = createToolRegistry([definition])
  expect(() => registry.register(definition)).toThrow('Tool already registered: duplicate')
})
