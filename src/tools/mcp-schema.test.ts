import { describe, expect, test } from 'bun:test'

import { buildZodSchemaForTool, jsonSchemaToZod } from './mcp'

function toolWithSchema(inputSchema: unknown) {
  return { name: 'test-tool', inputSchema } as Parameters<typeof buildZodSchemaForTool>[0]
}

describe('buildZodSchemaForTool', () => {
  test('validates primitive types and required fields', () => {
    const schema = buildZodSchemaForTool(
      toolWithSchema({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name.' },
          count: { type: 'integer' },
          ratio: { type: 'number' },
          enabled: { type: 'boolean' },
        },
        required: ['name'],
      }),
    )

    expect(schema.parse({ name: 'x' })).toEqual({ name: 'x' })
    expect(schema.parse({ name: 'x', count: 3, ratio: 0.5, enabled: true })).toEqual({
      name: 'x',
      count: 3,
      ratio: 0.5,
      enabled: true,
    })
    expect(() => schema.parse({})).toThrow()
    expect(() => schema.parse({ name: 42 })).toThrow()
    expect(() => schema.parse({ name: 'x', count: 1.5 })).toThrow()
    expect(() => schema.parse({ name: 'x', enabled: 'yes' })).toThrow()
  })

  test('coerces stringified numbers but keeps bad strings and booleans strict', () => {
    const schema = buildZodSchemaForTool(
      toolWithSchema({
        type: 'object',
        properties: {
          count: { type: 'integer' },
          ratio: { type: 'number' },
          enabled: { type: 'boolean' },
        },
      }),
    )

    // Models commonly emit "5" for numeric fields; coercion accepts them.
    expect(schema.parse({ count: '3' })).toEqual({ count: 3 })
    expect(schema.parse({ ratio: '0.5' })).toEqual({ ratio: 0.5 })

    // Non-numeric strings still fail (NaN), and "1.5" is not an integer.
    expect(() => schema.parse({ count: 'abc' })).toThrow()
    expect(() => schema.parse({ ratio: 'abc' })).toThrow()
    expect(() => schema.parse({ count: '1.5' })).toThrow()

    // Booleans are never coerced: "true"/"false" strings are rejected.
    expect(() => schema.parse({ enabled: 'true' })).toThrow()
    expect(() => schema.parse({ enabled: 'false' })).toThrow()
    expect(schema.parse({ enabled: false })).toEqual({ enabled: false })
  })

  test('validates enums', () => {
    const schema = buildZodSchemaForTool(
      toolWithSchema({
        type: 'object',
        properties: { mode: { enum: ['fast', 'slow'] } },
        required: ['mode'],
      }),
    )

    expect(schema.parse({ mode: 'fast' })).toEqual({ mode: 'fast' })
    expect(() => schema.parse({ mode: 'warp' })).toThrow()
  })

  test('validates arrays and nested objects', () => {
    const schema = buildZodSchemaForTool(
      toolWithSchema({
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          options: {
            type: 'object',
            properties: { depth: { type: 'integer' } },
            required: ['depth'],
          },
        },
        required: ['tags'],
      }),
    )

    expect(schema.parse({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] })
    expect(schema.parse({ tags: [], options: { depth: 2 } })).toEqual({ tags: [], options: { depth: 2 } })
    expect(() => schema.parse({ tags: [1] })).toThrow()
    expect(() => schema.parse({ tags: [], options: {} })).toThrow()
  })

  test('keeps passthrough unless additionalProperties is false', () => {
    const passthrough = buildZodSchemaForTool(
      toolWithSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
      }),
    )
    expect(passthrough.parse({ a: 'x', extra: 1 })).toEqual({ a: 'x', extra: 1 })

    const strict = buildZodSchemaForTool(
      toolWithSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
      }),
    )
    expect(strict.parse({ a: 'x', extra: 1 })).toEqual({ a: 'x' })
  })

  test('defaults to an open record when no properties are declared', () => {
    const schema = buildZodSchemaForTool(toolWithSchema({ type: 'object' }))
    expect(schema.parse(undefined)).toEqual({})
    expect(schema.parse({ anything: [1, 2, 3] })).toEqual({ anything: [1, 2, 3] })
  })
})

describe('jsonSchemaToZod', () => {
  test('translates union types', () => {
    const schema = jsonSchemaToZod({ type: ['string', 'null'] })
    expect(schema.parse('x')).toBe('x')
    expect(schema.parse(null)).toBeNull()
    expect(() => schema.parse(5)).toThrow()
  })

  test('translates mixed literal enums', () => {
    const schema = jsonSchemaToZod({ enum: ['a', 1, true] })
    expect(schema.parse('a')).toBe('a')
    expect(schema.parse(1)).toBe(1)
    expect(schema.parse(true)).toBe(true)
    expect(() => schema.parse('b')).toThrow()
  })

  test('falls back to unknown for exotic schemas', () => {
    const anyOf = jsonSchemaToZod({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    expect(anyOf.parse({ arbitrary: true })).toEqual({ arbitrary: true })

    const unknownType = jsonSchemaToZod({ type: 'tuple' })
    expect(unknownType.parse([1, 'x'])).toEqual([1, 'x'])
  })

  test('carries over descriptions', () => {
    const schema = jsonSchemaToZod({ type: 'string', description: 'A described field.' })
    expect(schema.description).toBe('A described field.')
  })
})
