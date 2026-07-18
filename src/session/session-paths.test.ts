import { describe, expect, test } from 'bun:test'
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

describe('session paths', () => {
  const root = path.join('C:', 'workspace', 'gambit')

  test('builds session and runtime paths from the workspace root', () => {
    expect(getCurrentSessionDirectory(root)).toBe(path.join(root, '.gambit', 'session'))
    expect(getModelSelectionPath(root)).toBe(path.join(root, '.gambit', 'model-selection.json'))
    expect(getSessionTranscriptPath(root)).toBe(path.join(root, '.gambit', 'session', 'transcript.jsonl'))
    expect(getTasksDirectory(root)).toBe(path.join(root, '.gambit', 'tasks'))
    expect(getTaskStorePath(root)).toBe(path.join(root, '.gambit', 'tasks', 'tasks.jsonl'))
    expect(getTaskDirectory('task-1', root)).toBe(path.join(root, '.gambit', 'tasks', 'task-1'))
    expect(getTaskOutputDirectory('task-1', root)).toBe(
      path.join(root, '.gambit', 'tasks', 'task-1', 'output'),
    )
    expect(getTaskOutputPath('task-1', 'result.txt', root)).toBe(
      path.join(root, '.gambit', 'tasks', 'task-1', 'output', 'result.txt'),
    )
    expect(getTaskTranscriptPath('task-1', root)).toBe(
      path.join(root, '.gambit', 'tasks', 'task-1', 'transcript.jsonl'),
    )
    expect(getPermissionStorePath(root)).toBe(path.join(root, '.gambit', 'permissions', 'requests.jsonl'))
    expect(getWorkboardDirectory(root)).toBe(path.join(root, '.gambit', 'workboard'))
    expect(getWorkItemStorePath(root)).toBe(path.join(root, '.gambit', 'workboard', 'work-items.jsonl'))
  })
})
