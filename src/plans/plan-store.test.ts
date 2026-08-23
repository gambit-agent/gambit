import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { getPlanFilePath, isSessionPlanFile } from './plan-store'
import { setUserGambitDirectoryForTesting } from '../session/user-data-paths'

describe('isSessionPlanFile', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gambit-plan-store-'))
    setWorkspaceRootForTesting(root)
    setUserGambitDirectoryForTesting(root)
  })

  afterEach(async () => {
    setWorkspaceRootForTesting(originalWorkspaceRoot)
    setUserGambitDirectoryForTesting(null)
    await rm(root, { recursive: true, force: true })
  })

  test('accepts markdown files inside the plans directory', () => {
    expect(isSessionPlanFile(path.join(root, 'plans', 'amber-brook.md'))).toBe(true)
    expect(isSessionPlanFile(path.join(root, 'plans', 'nested', 'plan.md'))).toBe(true)
  })

  test('recognizes the path produced for the current session', () => {
    expect(isSessionPlanFile(getPlanFilePath('session-1'))).toBe(true)
  })

  test('rejects sibling directories that share the plans prefix', () => {
    expect(isSessionPlanFile(path.join(root, 'plansX', 'foo.md'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, 'plans-evil', 'foo.md'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, 'plans.md'))).toBe(false)
  })

  test('rejects non-markdown files and traversal out of the plans directory', () => {
    expect(isSessionPlanFile(path.join(root, 'plans', 'foo.txt'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, 'plans', '..', 'other.md'))).toBe(false)
    expect(isSessionPlanFile(path.join(root, 'other.md'))).toBe(false)
  })
})
