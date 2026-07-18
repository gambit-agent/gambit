import path from 'node:path'

import { workspaceRoot } from '../config'

function getAgentRootPath(rootPath: string = workspaceRoot): string {
  return path.join(rootPath, '.gambit', 'agents')
}

function getAgentRunDirectory(runId: string, rootPath: string = workspaceRoot): string {
  return path.join(getAgentRootPath(rootPath), runId)
}

export function getAgentTranscriptPath(runId: string, rootPath: string = workspaceRoot): string {
  return path.join(getAgentRunDirectory(runId, rootPath), 'transcript.jsonl')
}

export function getAgentOutputPath(runId: string, rootPath: string = workspaceRoot): string {
  return path.join(getAgentRunDirectory(runId, rootPath), 'output.md')
}

export function getAgentRecordPath(runId: string, rootPath: string = workspaceRoot): string {
  return path.join(getAgentRunDirectory(runId, rootPath), 'agent.json')
}
