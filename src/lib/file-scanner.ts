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

  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectFiles(entryPath, options)
    }
    if (!entry.isFile()) {
      return []
    }
    if (options.extensions && !options.extensions.has(path.extname(entry.name))) {
      return []
    }
    return [entryPath]
  }))

  return files.flat().sort((left, right) => left.localeCompare(right))
}
