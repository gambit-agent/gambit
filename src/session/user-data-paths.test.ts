import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  getUserDataRoot,
  getUserGambitDirectory,
  setUserGambitDirectoryForTesting,
} from './user-data-paths'

describe('user-data-paths', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gambit-user-data-'))
    setUserGambitDirectoryForTesting(tempRoot)
  })

  afterEach(() => {
    setUserGambitDirectoryForTesting(null)
    delete Bun.env.GAMBIT_DATA_HOME
  })

  test('getUserGambitDirectory honors the test override', () => {
    expect(getUserGambitDirectory()).toBe(tempRoot)
  })

  test('getUserGambitDirectory falls back to ~/.gambit without overrides', () => {
    setUserGambitDirectoryForTesting(null)
    expect(getUserGambitDirectory('/home/tester')).toBe(path.join('/home/tester', '.gambit'))
  })

  test('getUserDataRoot is flat across workspaces', () => {
    expect(getUserDataRoot('/project-a')).toBe(getUserDataRoot('/project-b'))
    expect(getUserDataRoot('/project-a')).toBe(tempRoot)
  })
})
