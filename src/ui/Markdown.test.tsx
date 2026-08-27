import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'

import { Markdown } from './Markdown'

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    setup?.renderer.destroy()
  })
  setup = null
})

async function renderMarkdown(content: string, width: number): Promise<string> {
  setup = await testRender(
    <box flexDirection="column" width={width}>
      <Markdown content={content} availableWidth={width} />
    </box>,
    { width, height: 30 },
  )
  await setup.renderOnce()
  return setup.captureCharFrame()
}

const FLOWCHART_BLOCK = ['```mermaid', 'flowchart LR', '  A[Composer] --> B[Runner]', '```'].join('\n')

test('a mermaid flowchart block is drawn as a diagram', async () => {
  const frame = await renderMarkdown(FLOWCHART_BLOCK, 60)

  expect(frame).toContain('Composer')
  expect(frame).toContain('Runner')
  expect(frame).toContain('▶')
  // The source must not also be shown once the diagram rendered.
  expect(frame).not.toContain('flowchart LR')
})

test('a mermaid sequence block is drawn as a diagram', async () => {
  const frame = await renderMarkdown(
    ['```mermaid', 'sequenceDiagram', '  C->>R: submit', '```'].join('\n'),
    60,
  )

  expect(frame).toContain('submit')
  expect(frame).toContain('▶')
  expect(frame).not.toContain('sequenceDiagram')
})

test('an unsupported diagram type falls back to its source', async () => {
  const frame = await renderMarkdown(
    ['```mermaid', 'pie title Tools', '  "Read" : 40', '```'].join('\n'),
    60,
  )

  // Nothing the model wrote may be lost to a rendering limit.
  expect(frame).toContain('pie title Tools')
  expect(frame).toContain('// mermaid')
})

test('a diagram too wide to scale falls back to its source', async () => {
  const frame = await renderMarkdown(FLOWCHART_BLOCK, 16)

  expect(frame).toContain('flowchart')
})

test('a non-mermaid code block is untouched', async () => {
  const frame = await renderMarkdown(['```ts', 'const value = 1', '```'].join('\n'), 60)

  expect(frame).toContain('const value = 1')
  expect(frame).toContain('// ts')
})

test('a table is drawn as a grid that fits the available width', async () => {
  const table = [
    '| Name | Role | Status |',
    '|---|---|---|',
    '| Alice | Developer | Active |',
    '| Charlie | Manager | Offline |',
  ].join('\n')

  const frame = await renderMarkdown(table, 34)
  const lines = frame.split('\n')

  expect(frame).toContain('┌')
  expect(frame).toContain('Name')
  expect(frame).toContain('Alice')
  // Columns shrink to fit rather than the grid being clipped mid-cell.
  for (const line of lines) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(34)
  }
  expect(lines.some((line) => line.includes('┐'))).toBe(true)
})

test('a table nested in a list item is still drawn as a grid', async () => {
  const content = ['- here is the data:', '  | Name | Role |', '  |---|---|', '  | Alice | Dev |'].join('\n')

  const frame = await renderMarkdown(content, 50)

  expect(frame).toContain('here is the data:')
  expect(frame).toContain('┌')
  expect(frame).toContain('Alice')
  // The raw delimiter row must never survive into the output.
  expect(frame).not.toContain('|---|')
})
