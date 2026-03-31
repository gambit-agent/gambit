import type { MemoryFrontmatter, MemoryType } from './memory-types'
import { MEMORY_TYPES } from './memory-types'

function escapeFrontmatterValue(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim()
}

export function stringifyMemoryFrontmatter(frontmatter: MemoryFrontmatter): string {
  return [
    '---',
    `name: ${escapeFrontmatterValue(frontmatter.name)}`,
    `description: ${escapeFrontmatterValue(frontmatter.description)}`,
    `type: ${frontmatter.type}`,
    `updated: ${escapeFrontmatterValue(frontmatter.updated)}`,
    '---',
    '',
  ].join('\n')
}

export function parseMemoryFrontmatter(content: string): {
  frontmatter: Partial<MemoryFrontmatter>
  body: string
} {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content.trimStart() }
  }

  const lines = content.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return { frontmatter: {}, body: content }
  }

  const frontmatter: Partial<MemoryFrontmatter> = {}
  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      continue
    }

    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()

    switch (key) {
      case 'name':
        frontmatter.name = value
        break
      case 'description':
        frontmatter.description = value
        break
      case 'type':
        if ((MEMORY_TYPES as readonly string[]).includes(value)) {
          frontmatter.type = value as MemoryType
        }
        break
      case 'updated':
        frontmatter.updated = value
        break
      default:
        break
    }
  }

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join('\n').trimStart(),
  }
}
