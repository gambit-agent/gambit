import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'

import { getUserGambitDirectory } from './user-data-paths'

/** Runtime data categories that moved from the project `.gambit` to `~/.gambit`. */
const MIGRATED_ENTRIES = [
  'conversations',
  'session',
  'tasks',
  'permissions',
  'workboard',
  'plans',
  'memory',
  'memories',
  'agents',
  'tool-results',
  'sessions',
  'history.json',
  'model-selection.json',
] as const

/**
 * Move legacy project-local runtime data (`<projectRoot>/.gambit/<entry>`)
 * into the user-level data directory. An entry is only moved when the target
 * does not already exist; existing user-level data is never overwritten.
 */
export async function migrateProjectGambitData(projectRoot: string): Promise<void> {
  const projectGambitDir = path.join(projectRoot, '.gambit')
  if (!existsSync(projectGambitDir)) {
    return
  }

  const userGambitDir = getUserGambitDirectory()
  if (path.resolve(userGambitDir) === path.resolve(projectGambitDir)) {
    return
  }

  for (const entry of MIGRATED_ENTRIES) {
    const source = path.join(projectGambitDir, entry)
    const target = path.join(userGambitDir, entry)
    if (!existsSync(source) || existsSync(target)) {
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    await rename(source, target)
  }
}
