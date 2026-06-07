import { readdir } from 'node:fs/promises'
import path from 'node:path'

export interface CollectFilesOptions {
  extensions?: ReadonlySet<string>
}

export async function collectFiles(directory: string, options: CollectFilesOptions = {}): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, options)))
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    if (options.extensions && !options.extensions.has(path.extname(entry.name))) {
      continue
    }
    files.push(entryPath)
  }

  files.sort((left, right) => left.localeCompare(right))
  return files
}
