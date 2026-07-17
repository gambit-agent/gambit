import type { MemoryRecord } from './memory-types'
import { scanMemoryRecords } from './memory-index'
import { workspaceRoot } from '../config'

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

function scoreMemory(record: MemoryRecord, queryTerms: readonly string[]): number {
  const haystack = `${record.name} ${record.description} ${record.content}`.toLowerCase()
  let score = 0

  for (const term of queryTerms) {
    if (record.name.toLowerCase().includes(term)) {
      score += 4
    }
    if (record.description.toLowerCase().includes(term)) {
      score += 3
    }
    if (haystack.includes(term)) {
      score += 1
    }
  }

  return score
}

interface RelevantMemorySearchOptions {
  rootPath?: string
  limit?: number
}

function scoreRelevantRecords(
  query: string,
  records: readonly MemoryRecord[],
  limit: number,
): MemoryRecord[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const queryTerms = tokenize(trimmed)
  if (queryTerms.length === 0) {
    return []
  }

  return records
    .map((record) => ({ record, score: scoreMemory(record, queryTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.record.updated.localeCompare(left.record.updated)
    })
    .slice(0, limit)
    .map((entry) => entry.record)
}

export function findRelevantMemoryRecords(
  query: string,
  records: readonly MemoryRecord[],
  options: RelevantMemorySearchOptions = {},
): MemoryRecord[] {
  return scoreRelevantRecords(query, records, options.limit ?? 3)
}

export async function loadRelevantMemoryRecords(
  query: string,
  options: RelevantMemorySearchOptions = {},
): Promise<MemoryRecord[]> {
  const records = await scanMemoryRecords(options.rootPath ?? workspaceRoot)
  return scoreRelevantRecords(query, records, options.limit ?? 3)
}

export async function findRelevantMemories(query: string, limit: number = 3): Promise<MemoryRecord[]> {
  return loadRelevantMemoryRecords(query, { limit })
}

export function formatRelevantMemories(records: readonly MemoryRecord[]): string {
  if (records.length === 0) {
    return ''
  }

  return [
    'Relevant memory context:',
    '',
    ...records.flatMap((record) => [
      `## ${record.name}`,
      `Type: ${record.type}`,
      `Description: ${record.description}`,
      `Updated: ${record.updated}`,
      '',
      record.content,
      '',
    ]),
  ].join('\n')
}
