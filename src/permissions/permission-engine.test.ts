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
