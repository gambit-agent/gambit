export interface ParsedFrontmatter {
  values: Record<string, string>
  body: string
  hasFrontmatter: boolean
}

export function parseFrontmatter(
  content: string,
  options: { trimBodyStart?: boolean } = {},
): ParsedFrontmatter {
  if (!content.startsWith('---')) {
    return {
      values: {},
      body: options.trimBodyStart ? content.trimStart() : content,
      hasFrontmatter: false,
    }
  }

  const lines = content.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex === -1) {
    return { values: {}, body: content, hasFrontmatter: false }
  }

  const values: Record<string, string> = {}
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
    if (!key) {
      continue
    }
    values[key] = stripFrontmatterQuotes(line.slice(colonIndex + 1).trim())
  }

  const body = lines.slice(closingIndex + 1).join('\n')
  return {
    values,
    body: options.trimBodyStart ? body.trimStart() : body,
    hasFrontmatter: true,
  }
}

export function parseFrontmatterList(value: string, separator: RegExp = /[,\s]+/): string[] {
  if (!value) {
    return []
  }
  return value
    .split(separator)
    .map((entry) => stripFrontmatterQuotes(entry.trim()))
    .filter(Boolean)
}

function stripFrontmatterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
