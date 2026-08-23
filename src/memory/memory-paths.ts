import path from 'node:path'

import { workspaceRoot } from '../config'
import { getUserDataRoot } from '../session/user-data-paths'

export function getMemoryDirectory(root: string = workspaceRoot): string {
  return path.join(getUserDataRoot(root), 'memory')
}

export function getMemoryIndexPath(root: string = workspaceRoot): string {
  return path.join(getMemoryDirectory(root), 'MEMORY.md')
}

export function getMemoryFilePath(slug: string, root: string = workspaceRoot): string {
  return path.join(getMemoryDirectory(root), `${slug}.md`)
}
