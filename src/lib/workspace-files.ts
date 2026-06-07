import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { workspaceRoot } from '../config'

const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', '.gambit', '.next', '.cache',
  'target', 'build', 'dist', '.venv', 'venv', '__pycache__',
])

let cachedFiles: string[] | null = null
let scanPromise: Promise<string[]> | null = null

async function scanFiles(dir: string): Promise<string[]> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const results = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.') || EXCLUDE_DIRS.has(entry.name)) return []
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return scanFiles(fullPath)
    }
    if (entry.isFile()) {
      return [fullPath]
    }
    return []
  }))

  return results.flat()
}

export async function getWorkspaceFiles(forceRefresh = false): Promise<string[]> {
  if (cachedFiles && !forceRefresh) return cachedFiles
  if (scanPromise && !forceRefresh) return scanPromise

  scanPromise = (async () => {
    try {
      const root = workspaceRoot
      const files = await scanFiles(root)

      cachedFiles = files
        .map((f) => path.relative(root, f))
        .filter((f) => !f.startsWith('..'))
        .sort()

      return cachedFiles
    } finally {
      scanPromise = null
    }
  })()

  return scanPromise
}
