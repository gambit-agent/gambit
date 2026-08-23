import path from 'node:path'

import { workspaceRoot } from '../config'
import { getUserDataRoot } from '../session/user-data-paths'

function getAgentRootPath(rootPath: string = workspaceRoot): string {
  return path.join(getUserDataRoot(rootPath), 'agents')
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
