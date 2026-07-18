import { expect, test } from 'bun:test'

import { PermissionEngine } from './permission-engine'

test('returns a stable snapshot object until state changes', () => {
  const engine = new PermissionEngine()

  const initialSnapshot = engine.getSnapshot()
  expect(engine.getSnapshot()).toBe(initialSnapshot)

  engine.setMode('Plan')

  const updatedSnapshot = engine.getSnapshot()
  expect(updatedSnapshot).not.toBe(initialSnapshot)
  expect(engine.getSnapshot()).toBe(updatedSnapshot)
})

test('delegates interactive decisions to an external permission handler', async () => {
  const requests: string[] = []
  const engine = new PermissionEngine(async (input) => {
    requests.push(input.toolId)
    return 'allow'
  })
  await engine.initialize()

  await expect(engine.request({ toolId: 'bash', subject: 'Run tests' })).resolves.toBe('allow')
  expect(requests).toEqual(['bash'])

  await expect(engine.request({ toolId: 'read', subject: 'Read a file' })).resolves.toBe('allow')
  expect(requests).toEqual(['bash'])
})
