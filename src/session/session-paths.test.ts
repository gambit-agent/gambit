import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  getCurrentSessionDirectory,
  getModelSelectionPath,
  getPermissionStorePath,
  getSessionTranscriptPath,
  getTaskDirectory,
  getTaskOutputDirectory,
  getTaskOutputPath,
  getTaskStorePath,
  getTaskTranscriptPath,
  getTasksDirectory,
  getWorkItemStorePath,
  getWorkboardDirectory,
} from './session-paths'
import { setUserGambitDirectoryForTesting } from './user-data-paths'

describe('session paths', () => {
  let tempDir = ''
  const root = path.join('C:', 'workspace', 'gambit')

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'gambit-session-paths-'))
    setUserGambitDirectoryForTesting(tempDir)
  })

  afterEach(async () => {
    setUserGambitDirectoryForTesting(null)
    await rm(tempDir, { recursive: true, force: true })
  })

  test('builds session and runtime paths from the user data directory', () => {
    expect(getCurrentSessionDirectory(root)).toBe(path.join(tempDir, 'session'))
    expect(getModelSelectionPath(root)).toBe(path.join(tempDir, 'model-selection.json'))
    expect(getSessionTranscriptPath(root)).toBe(path.join(tempDir, 'session', 'transcript.jsonl'))
    expect(getTasksDirectory(root)).toBe(path.join(tempDir, 'tasks'))
    expect(getTaskStorePath(root)).toBe(path.join(tempDir, 'tasks', 'tasks.jsonl'))
    expect(getTaskDirectory('task-1', root)).toBe(path.join(tempDir, 'tasks', 'task-1'))
    expect(getTaskOutputDirectory('task-1', root)).toBe(
      path.join(tempDir, 'tasks', 'task-1', 'output'),
    )
    expect(getTaskOutputPath('task-1', 'result.txt', root)).toBe(
      path.join(tempDir, 'tasks', 'task-1', 'output', 'result.txt'),
    )
    expect(getTaskTranscriptPath('task-1', root)).toBe(
      path.join(tempDir, 'tasks', 'task-1', 'transcript.jsonl'),
    )
    expect(getPermissionStorePath(root)).toBe(path.join(tempDir, 'permissions', 'requests.jsonl'))
    expect(getWorkboardDirectory(root)).toBe(path.join(tempDir, 'workboard'))
    expect(getWorkItemStorePath(root)).toBe(path.join(tempDir, 'workboard', 'work-items.jsonl'))
  })
})
