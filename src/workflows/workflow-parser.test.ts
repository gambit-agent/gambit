import { expect, test } from 'bun:test'

import { parseWorkflowScript } from './workflow-parser'

const validScript = `
export const meta = {
  name: 'demo_workflow',
  description: 'A useful workflow',
  whenToUse: 'when the task decomposes cleanly',
  phases: [{ title: 'Inspect', detail: 'Read code', model: 'fast' }],
}

phase('Inspect')
return true
`

test('parseWorkflowScript accepts literal workflow metadata', () => {
  const parsed = parseWorkflowScript(validScript)

  expect(parsed.meta.name).toBe('demo_workflow')
  expect(parsed.meta.description).toBe('A useful workflow')
  expect(parsed.meta.phases?.[0]?.title).toBe('Inspect')
  expect(parsed.body).toContain("phase('Inspect')")
  expect(parsed.body).not.toContain('export const meta')
})

test('parseWorkflowScript accepts static template literals', () => {
  const parsed = parseWorkflowScript("export const meta = { name: `demo`, description: `static` }\nreturn true")

  expect(parsed.meta.name).toBe('demo')
})

test('parseWorkflowScript requires meta export first', () => {
  expect(() =>
    parseWorkflowScript("const x = 1\nexport const meta = { name: 'demo', description: 'desc' }"),
  ).toThrow('must be the first statement')
})

test('parseWorkflowScript requires name and description', () => {
  expect(() => parseWorkflowScript("export const meta = { name: 'demo' }")).toThrow('meta.description')
  expect(() => parseWorkflowScript("export const meta = { description: 'desc' }")).toThrow('meta.name')
})

test('parseWorkflowScript rejects non-literal metadata', () => {
  expect(() => parseWorkflowScript("export const meta = { name: makeName(), description: 'desc' }")).toThrow(
    'non-literal',
  )
  expect(() =>
    parseWorkflowScript("const name = 'demo'; export const meta = { name, description: 'desc' }"),
  ).toThrow('must be the first statement')
})

test('parseWorkflowScript rejects object and array hazards', () => {
  expect(() => parseWorkflowScript("export const meta = { ...base, name: 'demo', description: 'desc' }")).toThrow(
    'spread not allowed',
  )
  expect(() =>
    parseWorkflowScript("export const meta = { ['name']: 'demo', description: 'desc' }"),
  ).toThrow('computed keys not allowed')
  expect(() =>
    parseWorkflowScript("export const meta = { __proto__: {}, name: 'demo', description: 'desc' }"),
  ).toThrow('reserved key')
  expect(() =>
    parseWorkflowScript("export const meta = { name: 'demo', description: 'desc', phases: [,,] }"),
  ).toThrow('sparse arrays')
})

test('parseWorkflowScript rejects nondeterministic APIs in executable code', () => {
  for (const expression of ['Date.now()', 'Math.random()', 'new Date()']) {
    expect(() =>
      parseWorkflowScript(`export const meta = { name: 'demo', description: 'desc' }\nreturn ${expression}`),
    ).toThrow('Workflow scripts must be deterministic')
  }
})

test('parseWorkflowScript allows nondeterministic API names in strings', () => {
  const parsed = parseWorkflowScript(`export const meta = {
    name: 'demo',
    description: 'prompt mentions Date.now() and Math.random()',
  }
  return 'new Date() is text'
  `)

  expect(parsed.meta.description).toContain('Math.random')
})
