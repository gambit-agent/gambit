import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'

import { workspaceRoot } from '../config'

export interface PromptTemplate {
  id: string
  name: string
  scope: 'project' | 'user'
  description: string | null
  filePath: string
  body: string
}

export interface PromptTemplateExecution {
  template: string
  scope: 'project' | 'user'
  arguments: string
  content: string
}

function parseYamlFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: raw.trim() }
  }

  const frontmatter: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '')
    if (key) frontmatter[key] = value
  }

  return { frontmatter, body: (match[2] ?? '').trim() }
}

async function discoverTemplatesInDir(
  dir: string,
  scope: 'project' | 'user',
): Promise<PromptTemplate[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const templates: PromptTemplate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue

    const filePath = path.join(dir, entry.name)
    const name = entry.name.replace(/\.md$/, '')

    try {
      const raw = await readFile(filePath, 'utf8')
      const { frontmatter, body } = parseYamlFrontmatter(raw)

      templates.push({
        id: name,
        name,
        scope,
        description: frontmatter.description ?? null,
        filePath,
        body,
      })
    } catch {
      // skip unreadable files
    }
  }

  return templates
}

export async function loadPromptTemplates(): Promise<PromptTemplate[]> {
  const projectDir = path.join(workspaceRoot, '.gambit', 'prompts')
  const userDir = path.join(homedir(), '.gambit', 'prompts')

  const [projectTemplates, userTemplates] = await Promise.all([
    discoverTemplatesInDir(projectDir, 'project'),
    discoverTemplatesInDir(userDir, 'user'),
  ])

  // Project templates shadow user templates with the same name
  const seen = new Set<string>()
  const result: PromptTemplate[] = []

  for (const t of projectTemplates) {
    seen.add(t.name)
    result.push(t)
  }
  for (const t of userTemplates) {
    if (!seen.has(t.name)) {
      result.push(t)
    }
  }

  return result
}

/**
 * Render a prompt template with variable substitution.
 *
 * Supports:
 * - {{ARGUMENTS}} or {{arguments}} — full argument string
 * - {{1}}, {{2}}, etc. — positional arguments
 * - {{name}} — named variables from a key=value argument syntax
 */
export function renderTemplate(template: PromptTemplate, args: string): string {
  const positional = parseArgs(args)
  const named = parseNamedArgs(args)

  let content = template.body

  // Replace {{ARGUMENTS}} / {{arguments}}
  content = content.replace(/\{\{(?:ARGUMENTS|arguments)\}\}/g, args)

  // Replace positional {{1}}, {{2}}, etc.
  content = content.replace(/\{\{(\d+)\}\}/g, (_match, index) => {
    const idx = parseInt(index, 10) - 1
    return positional[idx] ?? ''
  })

  // Replace named {{key}}
  content = content.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (/^\d+$/.test(key)) return _match // skip positional (already handled)
    if (key === 'ARGUMENTS' || key === 'arguments') return _match
    return named[key.toLowerCase()] ?? ''
  })

  return content.trim()
}

function parseArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (const char of input) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === ' ') {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) args.push(current)
  return args
}

function parseNamedArgs(input: string): Record<string, string> {
  const args = parseArgs(input)
  const named: Record<string, string> = {}

  for (const arg of args) {
    const eqIndex = arg.indexOf('=')
    if (eqIndex > 0) {
      const key = arg.slice(0, eqIndex).toLowerCase()
      named[key] = arg.slice(eqIndex + 1)
    }
  }

  return named
}

export async function executePromptTemplate(
  name: string,
  args: string = '',
): Promise<PromptTemplateExecution | null> {
  const templates = await loadPromptTemplates()
  const template = templates.find((t) => t.name === name)
  if (!template) return null

  const content = renderTemplate(template, args)
  return {
    template: template.name,
    scope: template.scope,
    arguments: args,
    content,
  }
}

export function buildPromptTemplateListDescription(templates: PromptTemplate[]): string {
  if (templates.length === 0) return ''

  const lines = ['Available prompt templates (use @template-name to expand):']
  for (const t of templates) {
    const desc = t.description ? ` — ${t.description}` : ''
    lines.push(`  @${t.name}${desc}`)
  }

  return lines.join('\n')
}
