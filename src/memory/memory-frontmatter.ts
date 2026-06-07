import type { MemoryFrontmatter, MemoryType } from './memory-types'
import { MEMORY_TYPES } from './memory-types'
import { parseFrontmatter } from '../lib/frontmatter'

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
  const parsed = parseFrontmatter(content, { trimBodyStart: true })
  const frontmatter: Partial<MemoryFrontmatter> = {}

  for (const [key, value] of Object.entries(parsed.values)) {
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
    body: parsed.body,
  }
}
