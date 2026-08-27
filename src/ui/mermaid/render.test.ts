import { expect, test } from 'bun:test'

import { detectDiagramKind, isMermaidLanguage, renderMermaid } from './index'

const FLOWCHART = `flowchart LR
  A[Composer] --> B{Run active?}
  B -->|yes| C[Steering queue]
  B -->|no| D[Start turn]`

const SEQUENCE = `sequenceDiagram
  participant C as Composer
  participant R as Runner
  C->>R: submit
  R-->>C: done`

const widthOf = (lines: string[]): number => Math.max(...lines.map((line) => line.length))

test('recognises the mermaid info string', () => {
  expect(isMermaidLanguage('mermaid')).toBe(true)
  expect(isMermaidLanguage('Mermaid')).toBe(true)
  expect(isMermaidLanguage('mermaid theme=dark')).toBe(true)
  expect(isMermaidLanguage('ts')).toBe(false)
  expect(isMermaidLanguage(undefined)).toBe(false)
})

test('detects the diagram type from the first meaningful line', () => {
  expect(detectDiagramKind(FLOWCHART)).toBe('flowchart')
  expect(detectDiagramKind(SEQUENCE)).toBe('sequence')
  expect(detectDiagramKind('%% comment\n\ngraph TD\n A-->B')).toBe('flowchart')
  expect(detectDiagramKind('pie title Tools\n "Read": 40')).toBe('unsupported')
  expect(detectDiagramKind('')).toBe('unsupported')
})

test('draws a flowchart with its labels, arrowheads and boxes', () => {
  const lines = renderMermaid(FLOWCHART, 100)!
  const drawing = lines.join('\n')

  expect(drawing).toContain('Composer')
  expect(drawing).toContain('Steering queue')
  expect(drawing).toContain('Start turn')
  // Edge labels and arrowheads are what make the diagram readable as a graph.
  expect(drawing).toContain('yes')
  expect(drawing).toContain('no')
  expect(drawing).toContain('▶')
  expect(drawing).toContain('┌')
  // The decision node is drawn with slanted corners rather than a plain box.
  expect(drawing).toContain('╱')
})

test('draws a sequence diagram with lifelines and message arrows', () => {
  const lines = renderMermaid(SEQUENCE, 100)!
  const drawing = lines.join('\n')

  expect(drawing).toContain('Composer')
  expect(drawing).toContain('Runner')
  expect(drawing).toContain('submit')
  expect(drawing).toContain('▶')
  expect(drawing).toContain('◀')
  expect(drawing).toContain('│')
  // A dashed reply must not be drawn as a solid one.
  expect(drawing).toContain('╌')
})

test('unsupported diagram types fall back rather than drawing something wrong', () => {
  expect(renderMermaid('pie title Tools\n  "Read" : 40', 100)).toBeNull()
  expect(renderMermaid('classDiagram\n  Animal <|-- Duck', 100)).toBeNull()
  expect(renderMermaid('flowchart TD', 100)).toBeNull()
})

test('a diagram is scaled down to fit before it is given up on', () => {
  const wide = renderMermaid(FLOWCHART, 100)!
  const narrow = renderMermaid(FLOWCHART, 48)!

  expect(widthOf(wide)).toBeLessThanOrEqual(100)
  expect(widthOf(narrow)).toBeLessThanOrEqual(48)
  // Scaling is real compaction, not the same drawing clipped.
  expect(widthOf(narrow)).toBeLessThan(widthOf(wide))
  expect(narrow.join('\n')).toContain('Composer')
})

test('a diagram that cannot be scaled to fit returns null for source fallback', () => {
  expect(renderMermaid(FLOWCHART, 20)).toBeNull()
  expect(renderMermaid(SEQUENCE, 8)).toBeNull()
  expect(renderMermaid(FLOWCHART, 0)).toBeNull()
})

test('rendered output never exceeds the width it was given', () => {
  for (const maxWidth of [30, 40, 60, 80, 120]) {
    for (const source of [FLOWCHART, SEQUENCE]) {
      const lines = renderMermaid(source, maxWidth)
      if (lines) {
        expect(widthOf(lines)).toBeLessThanOrEqual(maxWidth)
      }
    }
  }
})

test('a cyclic flowchart still lays out instead of hanging', () => {
  const lines = renderMermaid(
    `flowchart TD
      A[Runner] --> B[Model step]
      B -->|tool call| C[Execute tool]
      C --> B
      B -->|done| D[Persist]`,
    100,
  )!

  expect(lines.join('\n')).toContain('Execute tool')
  expect(lines.join('\n')).toContain('Persist')
})

test('a self-referencing node does not break the drawing', () => {
  const lines = renderMermaid('flowchart TD\n  A[Retry] --> A\n  A --> B[Done]', 100)!

  expect(lines.join('\n')).toContain('Retry')
  expect(lines.join('\n')).toContain('Done')
})

test('a sequence self-message is drawn as a loop with its label', () => {
  const lines = renderMermaid(
    'sequenceDiagram\n  participant A as Runner\n  participant B as Store\n  A->>A: compact\n  A->>B: persist',
    100,
  )!

  expect(lines.join('\n')).toContain('compact')
  expect(lines.join('\n')).toContain('persist')
})
