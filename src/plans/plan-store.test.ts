import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { getPlanFilePath, isSessionPlanFile } from './plan-store'

describe('isSessionPlanFile', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-plan-store-'))
    setWorkspaceRootForTesting(root)
  })

  afterEach(async () => {
    setWorkspaceRootForTesting(originalWorkspaceRoot)
    await rm(root, { recursive: true, force: true })
  })

  test('accepts markdown files inside the plans directory', () => {
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plans', 'amber-brook.md'))).toBe(true)
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plans', 'nested', 'plan.md'))).toBe(true)
  })

  test('recognizes the path produced for the current session', () => {
    expect(isSessionPlanFile(getPlanFilePath('session-1'))).toBe(true)
  })

  test('rejects sibling directories that share the plans prefix', () => {
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plansX', 'foo.md'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plans-evil', 'foo.md'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plans.md'))).toBe(false)
  })

  test('rejects non-markdown files and traversal out of the plans directory', () => {
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plans', 'foo.txt'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, '.gambit', 'plans', '..', 'other.md'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, 'other.md'))).toBe(false)
  })
})

describe('plan slug persistence', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-plan-slug-'))
    setWorkspaceRootForTesting(root)
  })

  afterEach(async () => {
    setWorkspaceRootForTesting(originalWorkspaceRoot)
    await rm(root, { recursive: true, force: true })
  })

  test('a resumed session resolves to the same plan file', async () => {
    const sessionId = 'session-under-test'
    const firstPath = getPlanFilePath(sessionId)

    // Same module instance: the in-memory cache answers.
    expect(getPlanFilePath(sessionId)).toBe(firstPath)

    // The mapping is on disk, so a restart can recover it.
    const index = await Bun.file(path.join(root, '.gambit', 'plans', 'index.json')).json()
    expect(index[sessionId]).toBe(path.basename(firstPath, '.md'))

    // A fresh module instance stands in for a restarted process: its slug cache
    // is empty, so it must read the mapping back rather than mint a new slug.
    const reloaded = await import(`./plan-store?restart=${randomUUID()}`)
    expect(reloaded.getPlanFilePath(sessionId)).toBe(firstPath)
  })

  test('different sessions get different plan files', () => {
    expect(getPlanFilePath('session-a')).not.toBe(getPlanFilePath('session-b'))
  })
})
