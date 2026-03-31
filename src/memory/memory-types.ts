export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

export interface MemoryFrontmatter {
  name: string
  description: string
  type: MemoryType
  updated: string
}

export interface MemoryRecord extends MemoryFrontmatter {
  filePath: string
  content: string
}

export interface CreateMemoryInput {
  name: string
  description: string
  type: MemoryType
  content: string
  updated?: string
}

export function isMemoryType(value: unknown): value is MemoryType {
  return MEMORY_TYPES.some((type) => type === value)
}
