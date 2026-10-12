import { glob } from 'node:fs/promises'
import path from 'node:path'
import { workspaceRoot } from '../config'

const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', '.gambit', '.next', '.cache',
  'target', 'build', 'dist', '.venv', 'venv', '__pycache__',
])

const EXCLUDE_GLOBS = Array.from(EXCLUDE_DIRS).flatMap((dir) => [
  dir, `${dir}/**`, `**/${dir}`, `**/${dir}/**`,
])

let cachedScan: { root: string; promise: Promise<string[]> } | null = null

async function scanFiles(dir: string): Promise<string[]> {
  const files: string[] = []

  try {
    // The glob yields directories too. Asking for dirents lets us keep only
    // regular files from the directory listing itself instead of issuing a
    // separate stat for every entry (one extra syscall per file on big trees).
    for await (const entry of glob('**/*', { cwd: dir, exclude: EXCLUDE_GLOBS, withFileTypes: true })) {
      if (entry.isFile()) {
        files.push(path.join(entry.parentPath, entry.name))
      }
    }
  } catch {
    return []
  }

  return files
}

export async function getWorkspaceFiles(
  forceRefresh = false,
  rootPath: string = workspaceRoot,
): Promise<string[]> {
  const root = path.resolve(rootPath)
  if (cachedScan?.root === root && !forceRefresh) return cachedScan.promise

  // Cache the promise itself so an older in-flight scan cannot overwrite a
  // newer refresh or the listing for a different workspace when it finishes.
  const promise = scanFiles(root).then((files) => files
    .map((file) => path.relative(root, file))
    .filter((file) => file !== '..' && !file.startsWith(`..${path.sep}`) && !path.isAbsolute(file))
    .sort())
  cachedScan = { root, promise }
  return promise
}
