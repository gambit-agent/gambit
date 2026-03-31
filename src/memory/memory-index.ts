import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { getMemoryDirectory, getMemoryFilePath, getMemoryIndexPath } from './memory-paths'
import type { CreateMemoryInput, MemoryFrontmatter, MemoryRecord } from './memory-types'
import { isMemoryType } from './memory-types'

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export function slugifyMemoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildMemoryFileContents(input: CreateMemoryInput, updated: string): string {
  const effectiveUpdated = input.updated?.trim() || updated
  return [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    `type: ${input.type}`,
    `updated: ${effectiveUpdated}`,
    '---',
    '',
    input.content.trim(),
    '',
  ].join('\n')
}

export function parseMemoryFile(filePath: string, raw: string): MemoryRecord | null {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return null
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    return null
  }

  const frontmatterBlock = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5).trim()
  const frontmatterLines = frontmatterBlock.split('\n')
  const frontmatter: Partial<MemoryFrontmatter> = {}

  for (const rawLine of frontmatterLines) {
    const separatorIndex = rawLine.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const key = rawLine.slice(0, separatorIndex).trim()
    const value = stripQuotes(rawLine.slice(separatorIndex + 1).trim())

    if (key === 'name') {
      frontmatter.name = value
      continue
    }
    if (key === 'description') {
      frontmatter.description = value
      continue
    }
    if (key === 'type' && isMemoryType(value)) {
      frontmatter.type = value
      continue
    }
    if (key === 'updated') {
      frontmatter.updated = value
    }
  }

  if (!frontmatter.name || !frontmatter.description || !frontmatter.type || !frontmatter.updated) {
    return null
  }

  return {
    filePath,
    name: frontmatter.name,
    description: frontmatter.description,
    type: frontmatter.type,
    updated: frontmatter.updated,
    content: body,
  }
}

export async function scanMemoryRecords(rootPath: string = workspaceRoot): Promise<MemoryRecord[]> {
  const memoryDirectory = getMemoryDirectory(rootPath)
  await mkdir(memoryDirectory, { recursive: true })
  const entries = await readdir(memoryDirectory, { withFileTypes: true })
  const records: MemoryRecord[] = []

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    if (!entry.name.endsWith('.md') || entry.name === 'MEMORY.md') {
      continue
    }

    const filePath = path.join(memoryDirectory, entry.name)
    const raw = await readFile(filePath, 'utf8')
    const parsed = parseMemoryFile(filePath, raw)
    if (parsed) {
      records.push(parsed)
    }
  }

  records.sort((left, right) => right.updated.localeCompare(left.updated))
  return records
}

export async function rebuildMemoryIndex(rootPath: string = workspaceRoot): Promise<void> {
  const records = await scanMemoryRecords(rootPath)
  const lines = [
    '# MEMORY',
    '',
    'Typed memory index for Gambit.',
    '',
  ]

  if (records.length === 0) {
    lines.push('No memories saved yet.', '')
  } else {
    for (const record of records) {
      const slug = path.basename(record.filePath)
      lines.push(
        `- \`${record.name}\` (${record.type})`,
        `  - ${record.description}`,
        `  - Updated: ${record.updated}`,
        `  - File: ${slug}`,
      )
    }
    lines.push('')
  }

  await writeFile(getMemoryIndexPath(rootPath), `${lines.join('\n')}\n`, 'utf8')
}

export async function readMemoryIndex(rootPath: string = workspaceRoot): Promise<string> {
  try {
    return await readFile(getMemoryIndexPath(rootPath), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await rebuildMemoryIndex(rootPath)
      return readFile(getMemoryIndexPath(rootPath), 'utf8')
    }
    throw error
  }
}

export async function upsertMemoryRecord(
  input: CreateMemoryInput,
  rootPath: string = workspaceRoot,
): Promise<MemoryRecord> {
  const slug = slugifyMemoryName(input.name)
  if (!slug) {
    throw new Error('Memory name must produce a non-empty slug.')
  }

  const updated = input.updated?.trim() || new Date().toISOString().slice(0, 10)
  const filePath = getMemoryFilePath(slug, rootPath)
  await mkdir(getMemoryDirectory(rootPath), { recursive: true })
  await writeFile(filePath, buildMemoryFileContents(input, updated), 'utf8')
  await rebuildMemoryIndex(rootPath)

  return {
    filePath,
    name: input.name,
    description: input.description,
    type: input.type,
    updated,
    content: input.content.trim(),
  }
}
