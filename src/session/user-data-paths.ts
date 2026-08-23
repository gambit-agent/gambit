import { homedir } from 'node:os'
import path from 'node:path'

let userDataRootOverride: string | null = null

/**
 * Absolute path to the user-level Gambit data directory. Holds all message
 * history and runtime metadata (conversations, tasks, memory, plans, ...).
 * Override with `GAMBIT_DATA_HOME` or the test-only setter.
 */
export function getUserGambitDirectory(home: string = homedir()): string {
  if (userDataRootOverride) {
    return userDataRootOverride
  }
  const envOverride = Bun.env.GAMBIT_DATA_HOME?.trim()
  if (envOverride) {
    return path.resolve(envOverride)
  }
  return path.join(home, '.gambit')
}

/**
 * Root directory for user-level runtime data for the given workspace.
 * Currently flat (shared across workspaces); a seam for future per-project
 * namespacing under the user data directory.
 */
export function getUserDataRoot(_workspaceRoot: string): string {
  return getUserGambitDirectory()
}

/** Point user data paths at an arbitrary directory (tests only). */
export function setUserGambitDirectoryForTesting(directory: string | null) {
  userDataRootOverride = directory
}
