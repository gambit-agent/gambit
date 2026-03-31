import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function appendJsonlEntry(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const line = `${JSON.stringify(payload)}\n`
  await appendFile(filePath, line, 'utf8')
}

export async function readJsonlEntries<T>(filePath: string): Promise<T[]> {
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
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      entries.push(JSON.parse(trimmed) as T)
    } catch {
      // ignore malformed transcript lines
    }
  }

  return entries
}
