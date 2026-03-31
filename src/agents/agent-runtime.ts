import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { appendJsonlEntry, readJsonlEntries } from '../conversation/transcript'
import { getAgentOutputPath, getAgentRecordPath, getAgentTranscriptPath } from './agent-paths'
import type { AgentDefinition, AgentRunRecord, AgentRunStatus } from './agent-types'

export interface AgentRuntimeOptions {
  rootPath?: string
}

export interface AgentRunHandle {
  record: AgentRunRecord
  appendTranscript: (entry: unknown) => Promise<void>
  updateProgress: (summary: string) => Promise<AgentRunRecord>
  complete: (output: string, summary?: string) => Promise<AgentRunRecord>
  fail: (error: unknown) => Promise<AgentRunRecord>
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return JSON.stringify(error)
}

async function writeAgentRecord(recordPath: string, record: AgentRunRecord): Promise<void> {
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

export async function createAgentRun(
  definition: AgentDefinition,
  title: string,
  options: AgentRuntimeOptions = {},
): Promise<AgentRunHandle> {
  const rootPath = options.rootPath ?? workspaceRoot
  const runId = randomUUID()
  const transcriptPath = getAgentTranscriptPath(runId, rootPath)
  const outputPath = getAgentOutputPath(runId, rootPath)
  const recordPath = getAgentRecordPath(runId, rootPath)
  const now = new Date().toISOString()

  await mkdir(path.dirname(recordPath), { recursive: true })

  const record: AgentRunRecord = {
    id: runId,
    agentId: definition.id,
    role: definition.role,
    title,
    status: 'pending',
    createdAt: now,
    startedAt: now,
    transcriptPath,
    outputPath,
    metadata: {
      allowedToolIds: definition.allowedToolIds ?? [],
      systemPromptAddendum: definition.systemPromptAddendum,
    },
  }

  await writeAgentRecord(recordPath, record)
  await writeFile(outputPath, '', 'utf8')

  const persist = async (nextStatus: AgentRunStatus, patch: Partial<AgentRunRecord>): Promise<AgentRunRecord> => {
    const nextRecord: AgentRunRecord = {
      ...record,
      ...patch,
      status: nextStatus,
    }
    Object.assign(record, nextRecord)
    await writeAgentRecord(recordPath, nextRecord)
    return nextRecord
  }

  return {
    record,
    appendTranscript: async (entry: unknown) => {
      await appendJsonlEntry(transcriptPath, entry)
    },
    updateProgress: async (summary: string) => {
      return await persist('running', { progressSummary: summary })
    },
    complete: async (output: string, summary?: string) => {
      await writeFile(outputPath, `${output.trimEnd()}\n`, 'utf8')
      return await persist('completed', {
        progressSummary: summary ?? output.slice(0, 200),
        finishedAt: new Date().toISOString(),
      })
    },
    fail: async (error: unknown) => {
      return await persist('failed', {
        error: toErrorMessage(error),
        finishedAt: new Date().toISOString(),
      })
    },
  }
}

export async function loadAgentTranscript(runId: string, rootPath?: string): Promise<unknown[]> {
  const transcriptPath = getAgentTranscriptPath(runId, rootPath)
  return await readJsonlEntries(transcriptPath)
}

export async function readAgentRecord(runId: string, rootPath?: string): Promise<AgentRunRecord | null> {
  const recordPath = getAgentRecordPath(runId, rootPath)

  try {
    const raw = await readFile(recordPath, 'utf8')
    return JSON.parse(raw) as AgentRunRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
