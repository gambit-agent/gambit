import path from 'node:path'

import { workspaceRoot } from '../config'

export function getMemoryDirectory(root: string = workspaceRoot): string {
  return path.join(root, '.gambit', 'memory')
}

export function getMemoryIndexPath(root: string = workspaceRoot): string {
  return path.join(getMemoryDirectory(root), 'MEMORY.md')
}

export function getMemoryFilePath(slug: string, root: string = workspaceRoot): string {
  return path.join(getMemoryDirectory(root), `${slug}.md`)
}
