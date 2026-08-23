import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { migrateProjectGambitData } from './migrate-project-data'
import { setUserGambitDirectoryForTesting } from './user-data-paths'

describe('migrateProjectGambitData', () => {
  let projectRoot: string
  let userDataRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'gambit-migrate-project-'))
    userDataRoot = mkdtempSync(path.join(tmpdir(), 'gambit-migrate-user-'))
    setUserGambitDirectoryForTesting(userDataRoot)
  })

  afterEach(() => {
    setUserGambitDirectoryForTesting(null)
  })

  test('moves runtime entries that have no user-level counterpart', async () => {
    const sourceDir = path.join(projectRoot, '.gambit', 'conversations')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(path.join(sourceDir, 'abc.jsonl'), '{}\n')
    writeFileSync(path.join(projectRoot, '.gambit', 'model-selection.json'), '{}')

    await migrateProjectGambitData(projectRoot)

    expect(existsSync(path.join(userDataRoot, 'conversations', 'abc.jsonl'))).toBe(true)
    expect(existsSync(sourceDir)).toBe(false)
    expect(existsSync(path.join(userDataRoot, 'model-selection.json'))).toBe(true)
  })

  test('keeps project data when user-level target already exists', async () => {
    const sourceDir = path.join(projectRoot, '.gambit', 'conversations')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(path.join(sourceDir, 'local.jsonl'), '{}\n')
    const targetDir = path.join(userDataRoot, 'conversations')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(path.join(targetDir, 'global.jsonl'), '{}\n')

    await migrateProjectGambitData(projectRoot)

    expect(existsSync(path.join(sourceDir, 'local.jsonl'))).toBe(true)
    expect(existsSync(path.join(targetDir, 'global.jsonl'))).toBe(true)
  })

  test('is a no-op when the project has no .gambit directory', async () => {
    await migrateProjectGambitData(projectRoot)
    expect(existsSync(userDataRoot)).toBe(true)
  })

  test('leaves customization directories in place', async () => {
    const skillsDir = path.join(projectRoot, '.gambit', 'skills')
    mkdirSync(skillsDir, { recursive: true })

    await migrateProjectGambitData(projectRoot)

    expect(existsSync(skillsDir)).toBe(true)
    expect(existsSync(path.join(userDataRoot, 'skills'))).toBe(false)
  })
})
