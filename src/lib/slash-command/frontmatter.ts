import type { SlashCommandFrontmatter } from './types'
import { parseFrontmatter, parseFrontmatterList } from '../frontmatter'

export function extractFrontmatter(content: string): { frontmatter: SlashCommandFrontmatter; body: string } {
  const { values, body } = parseFrontmatter(content)
  const frontmatter: SlashCommandFrontmatter = {}

  for (const [key, value] of Object.entries(values)) {
    switch (key) {
      case 'description':
        frontmatter.description = value
        break
      case 'argument-hint':
        frontmatter.argumentHint = value
        break
      case 'allowed-tools':
        frontmatter.allowedTools = parseFrontmatterList(value, /[,\n]/)
        break
      case 'model':
        frontmatter.model = value
        break
      case 'disable-model-invocation':
        frontmatter.disableModelInvocation = /^true$/i.test(value)
        break
      default:
        break
    }
  }

  return { frontmatter, body }
}

export function deriveDescription(body: string): string | null {
  const lines = body.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      return trimmed.replace(/^#+\s*/, '')
    }
  }
  return null
}
