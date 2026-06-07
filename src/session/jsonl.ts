import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type JsonlTransform<T> = (value: unknown) => T | null

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
}

function serializeJsonlEntry(entry: unknown): string {
  const line = JSON.stringify(entry)
  if (line === undefined) {
    throw new Error('JSONL entries must be serializable.')
  }
  return line
}

export async function appendJsonlEntry(filePath: string, entry: unknown): Promise<void> {
  await ensureParentDirectory(filePath)
  await appendFile(filePath, `${serializeJsonlEntry(entry)}\n`, 'utf8')
}

export async function appendJsonlEntries(filePath: string, entries: readonly unknown[]): Promise<void> {
  if (entries.length === 0) {
    return
  }

  await ensureParentDirectory(filePath)
  await appendFile(filePath, `${entries.map(serializeJsonlEntry).join('\n')}\n`, 'utf8')
}

export async function readJsonlEntries<T>(filePath: string, transform: JsonlTransform<T>): Promise<T[]> {
  let raw = ''

  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const entries: T[] = []
  const lines = raw.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown
      const transformed = transform(parsed)
      if (transformed !== null) {
        entries.push(transformed)
      }
    } catch {
      // Ignore malformed lines so a single bad record does not block the store.
    }
  }

  return entries
}

export async function readRawJsonlEntries<T>(filePath: string): Promise<T[]> {
  return readJsonlEntries<T>(filePath, (value) => {
    if (!isRecord(value)) {
      return null
    }
    return value as T
  })
}

export async function writeJsonlEntries(filePath: string, entries: readonly unknown[]): Promise<void> {
  await ensureParentDirectory(filePath)

  if (entries.length === 0) {
    await writeFile(filePath, '', 'utf8')
    return
  }

  const content = `${entries.map(serializeJsonlEntry).join('\n')}\n`
  await writeFile(filePath, content, 'utf8')
}
