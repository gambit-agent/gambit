import type { SlashCommandFrontmatter } from './types'

export function extractFrontmatter(content: string): { frontmatter: SlashCommandFrontmatter; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content }
  }

  const lines = content.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return { frontmatter: {}, body: content }
  }

  const fmLines = lines.slice(1, closingIndex)
  const body = lines.slice(closingIndex + 1).join('\n')
  const frontmatter: SlashCommandFrontmatter = {}

  for (const rawLine of fmLines) {
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
      case 'description':
        frontmatter.description = stripQuotes(value)
        break
      case 'argument-hint':
        frontmatter.argumentHint = stripQuotes(value)
        break
      case 'allowed-tools':
        frontmatter.allowedTools =
          value.length === 0
            ? []
            : value
                .split(/[,\n]/)
                .map((entry) => stripQuotes(entry.trim()))
                .filter(Boolean)
        break
      case 'model':
        frontmatter.model = stripQuotes(value)
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

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
