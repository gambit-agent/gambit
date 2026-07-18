import path from 'node:path'

import { workspaceRoot } from '../config'

function getGambitDirectory(root: string = workspaceRoot): string {
  return path.join(root, '.gambit')
}

export function getCurrentSessionDirectory(root: string = workspaceRoot): string {
  return path.join(getGambitDirectory(root), 'session')
}

export function getModelSelectionPath(root: string = workspaceRoot): string {
  return path.join(getGambitDirectory(root), 'model-selection.json')
}

export function getSessionTranscriptPath(root: string = workspaceRoot): string {
  return path.join(getCurrentSessionDirectory(root), 'transcript.jsonl')
}

export function getTasksDirectory(root: string = workspaceRoot): string {
  return path.join(getGambitDirectory(root), 'tasks')
}

export function getTaskStorePath(root: string = workspaceRoot): string {
  return path.join(getTasksDirectory(root), 'tasks.jsonl')
}

export function getTaskDirectory(taskId: string, root: string = workspaceRoot): string {
  return path.join(getTasksDirectory(root), taskId)
}

export function getTaskOutputDirectory(taskId: string, root: string = workspaceRoot): string {
  return path.join(getTaskDirectory(taskId, root), 'output')
}

export function getTaskOutputPath(
  taskId: string,
  fileName: string = 'output.txt',
  root: string = workspaceRoot,
): string {
  return path.join(getTaskOutputDirectory(taskId, root), fileName)
}

export function getTaskTranscriptPath(taskId: string, root: string = workspaceRoot): string {
  return path.join(getTaskDirectory(taskId, root), 'transcript.jsonl')
}

function getPermissionsDirectory(root: string = workspaceRoot): string {
  return path.join(getGambitDirectory(root), 'permissions')
}

export function getPermissionStorePath(root: string = workspaceRoot): string {
  return path.join(getPermissionsDirectory(root), 'requests.jsonl')
}

export function getWorkboardDirectory(root: string = workspaceRoot): string {
  return path.join(getGambitDirectory(root), 'workboard')
}

export function getWorkItemStorePath(root: string = workspaceRoot): string {
  return path.join(getWorkboardDirectory(root), 'work-items.jsonl')
}
