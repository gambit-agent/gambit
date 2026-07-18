import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { JSONL } from 'bun'

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
    raw = await Bun.file(filePath).text()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  return parseJsonlLines(raw, transform)
}

export async function readRawJsonlEntries<T>(filePath: string): Promise<T[]> {
  return readJsonlEntries<T>(filePath, (value) => {
    if (!isRecord(value)) {
      return null
    }
    return value as T
  })
}

export async function readJsonlTailEntries<T>(
  filePath: string,
  maxEntries: number,
  transform: JsonlTransform<T>,
): Promise<T[]> {
  if (maxEntries <= 0) {
    return []
  }

  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return []
  }

  let windowBytes = 64 * 1024
  const maxWindowBytes = 8 * 1024 * 1024
  const fileSize = file.size

  while (true) {
    const start = Math.max(0, fileSize - windowBytes)
    let raw = await file.slice(start, fileSize).text()
    if (start > 0) {
      const newlineIndex = raw.indexOf('\n')
      raw = newlineIndex >= 0 ? raw.slice(newlineIndex + 1) : ''
    }

    const entries = parseJsonlLines(raw, transform)
    if (entries.length >= maxEntries || start === 0 || windowBytes >= maxWindowBytes) {
      return entries.slice(-maxEntries)
    }
    windowBytes *= 2
  }
}

export async function readRawJsonlTailEntries<T>(filePath: string, maxEntries: number): Promise<T[]> {
  return readJsonlTailEntries<T>(filePath, maxEntries, (value) => {
    if (!isRecord(value)) {
      return null
    }
    return value as T
  })
}

export async function writeJsonlEntries(filePath: string, entries: readonly unknown[]): Promise<void> {
  await ensureParentDirectory(filePath)

  if (entries.length === 0) {
    await Bun.write(filePath, '')
    return
  }

  const content = `${entries.map(serializeJsonlEntry).join('\n')}\n`
  await Bun.write(filePath, content)
}

function parseJsonlLines<T>(raw: string, transform: JsonlTransform<T>): T[] {
  const entries: T[] = []
  const lines = raw.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      const parsedValues = JSONL.parse(`${trimmed}\n`) as unknown[]
      for (const parsed of parsedValues) {
        const transformed = transform(parsed)
        if (transformed !== null) {
          entries.push(transformed)
        }
      }
    } catch {
      // Ignore malformed lines so a single bad record does not block the store.
    }
  }

  return entries
}
