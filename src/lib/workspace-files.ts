import { glob } from 'node:fs/promises'
import path from 'node:path'
import { workspaceRoot } from '../config'

const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', '.gambit', '.next', '.cache',
  'target', 'build', 'dist', '.venv', 'venv', '__pycache__',
])

const EXCLUDE_GLOBS = Array.from(EXCLUDE_DIRS).flatMap((dir) => [dir, `${dir}/**`])

let cachedFiles: string[] | null = null
let scanPromise: Promise<string[]> | null = null

async function scanFiles(dir: string): Promise<string[]> {
  const files: string[] = []

  try {
    for await (const relativePath of glob('**/*', { cwd: dir, exclude: EXCLUDE_GLOBS })) {
      const fullPath = path.join(dir, relativePath)
      if (await Bun.file(fullPath).exists()) {
        files.push(fullPath)
      }
    }
  } catch {
    return []
  }

  return files
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
