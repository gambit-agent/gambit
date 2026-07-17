import { describe, expect, it } from 'bun:test'

import { renderTemplate, type PromptTemplate } from './promptTemplates'

function makeTemplate(body: string): PromptTemplate {
  return {
    id: 'test',
    name: 'test',
    scope: 'project',
    description: null,
    filePath: '/test.md',
    body,
  }
}

describe('renderTemplate', () => {
  it('substitutes {{ARGUMENTS}} with full argument string', () => {
    const result = renderTemplate(makeTemplate('Review: {{ARGUMENTS}}'), 'file.ts --strict')
    expect(result).toBe('Review: file.ts --strict')
  })

  it('substitutes positional {{1}}, {{2}} placeholders', () => {
    const result = renderTemplate(makeTemplate('Compare {{1}} with {{2}}'), 'old.ts new.ts')
    expect(result).toBe('Compare old.ts with new.ts')
  })

  it('handles quoted positional arguments', () => {
    const result = renderTemplate(makeTemplate('File: {{1}}'), '"path with spaces.ts"')
    expect(result).toBe('File: path with spaces.ts')
  })

  it('substitutes named key=value variables', () => {
    const result = renderTemplate(makeTemplate('Deploy {{service}} to {{env}}'), 'service=api env=prod')
    expect(result).toBe('Deploy api to prod')
  })

  it('leaves unmatched placeholders empty', () => {
    const result = renderTemplate(makeTemplate('Hello {{name}}'), '')
    expect(result).toBe('Hello')
  })

  it('handles templates with no placeholders', () => {
    const result = renderTemplate(makeTemplate('Static content here'), 'ignored args')
    expect(result).toBe('Static content here')
  })
})
