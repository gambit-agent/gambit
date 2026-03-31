import { readFile } from 'node:fs/promises'

import {
  parseMemoryFile,
  readMemoryIndex,
  rebuildMemoryIndex,
  scanMemoryRecords,
  slugifyMemoryName,
  upsertMemoryRecord,
} from './memory-index'
import { findRelevantMemories, formatRelevantMemories } from './memory-retrieval'
import { workspaceRoot } from '../config'
import type { CreateMemoryInput, MemoryRecord } from './memory-types'

export class MemoryStore {
  async upsert(input: CreateMemoryInput): Promise<MemoryRecord> {
    return upsertMemoryRecord(input)
  }

  async list(): Promise<MemoryRecord[]> {
    return scanMemoryRecords()
  }

  async getRelevantContext(query: string): Promise<string> {
    const memories = await findRelevantMemories(query)
    return formatRelevantMemories(memories)
  }

  async getIndex(): Promise<string> {
    return readMemoryIndex()
  }

  async readRecord(slugOrPath: string): Promise<string> {
    const slug = slugifyMemoryName(slugOrPath)
    const record = (await scanMemoryRecords()).find((entry) => entry.filePath.endsWith(`${slug}.md`))
    if (!record) {
      return ''
    }
    return readFile(record.filePath, 'utf8')
  }
}

export interface MemoryRecordWithPath extends MemoryRecord {
  path: string
}

export async function writeMemoryRecord(
  input: CreateMemoryInput,
  rootPath: string = workspaceRoot,
): Promise<MemoryRecordWithPath> {
  const record = await upsertMemoryRecord(input, rootPath)
  return {
    ...record,
    path: record.filePath,
  }
}

export async function readMemoryRecord(filePath: string): Promise<MemoryRecord> {
  const raw = await readFile(filePath, 'utf8')
  const record = parseMemoryFile(filePath, raw)
  if (!record) {
    throw new Error(`Unable to parse memory record: ${filePath}`)
  }
  return record
}

export async function refreshMemoryIndex(rootPath: string = workspaceRoot): Promise<string> {
  await rebuildMemoryIndex(rootPath)
  return readMemoryIndex(rootPath)
}
