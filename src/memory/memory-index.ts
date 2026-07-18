import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Glob } from 'bun'

import { workspaceRoot } from '../config'
import { getMemoryDirectory, getMemoryFilePath, getMemoryIndexPath } from './memory-paths'
import type { CreateMemoryInput, MemoryRecord } from './memory-types'
import { parseMemoryFrontmatter, stringifyMemoryFrontmatter } from './memory-frontmatter'

export function slugifyMemoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildMemoryFileContents(input: CreateMemoryInput, updated: string): string {
  const effectiveUpdated = input.updated?.trim() || updated
  return [
    stringifyMemoryFrontmatter({
      name: input.name,
      description: input.description,
      type: input.type,
      updated: effectiveUpdated,
    }).trimEnd(),
    input.content.trim(),
    '',
  ].join('\n')
}

export function parseMemoryFile(filePath: string, raw: string): MemoryRecord | null {
  const { frontmatter, body } = parseMemoryFrontmatter(raw)

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
  const memoryFiles: string[] = []
  const memoryGlob = new Glob('*.md')

  for await (const filePath of memoryGlob.scan({
    cwd: memoryDirectory,
    dot: true,
    absolute: true,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (path.basename(filePath) !== 'MEMORY.md') {
      memoryFiles.push(filePath)
    }
  }

  const records = await Promise.all(memoryFiles.map(async (filePath) => {
    const raw = await Bun.file(filePath).text()
    return parseMemoryFile(filePath, raw)
  }))

  return records
    .filter((record): record is MemoryRecord => record !== null)
    .sort((left, right) => right.updated.localeCompare(left.updated))
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

  await Bun.write(getMemoryIndexPath(rootPath), `${lines.join('\n')}\n`)
}

export async function readMemoryIndex(rootPath: string = workspaceRoot): Promise<string> {
  try {
    return await Bun.file(getMemoryIndexPath(rootPath)).text()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await rebuildMemoryIndex(rootPath)
      return Bun.file(getMemoryIndexPath(rootPath)).text()
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
  await Bun.write(filePath, buildMemoryFileContents(input, updated))
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
