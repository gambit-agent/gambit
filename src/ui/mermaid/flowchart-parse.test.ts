import { expect, test } from 'bun:test'

import { parseFlowchart } from './flowchart-parse'

test('reads direction from either header keyword', () => {
  expect(parseFlowchart('flowchart LR\n  A --> B')?.direction).toBe('LR')
  expect(parseFlowchart('graph RL\n  A --> B')?.direction).toBe('RL')
  // TB is mermaid's synonym for TD, and a bare header defaults to it.
  expect(parseFlowchart('graph TB\n  A --> B')?.direction).toBe('TD')
  expect(parseFlowchart('flowchart\n  A --> B')?.direction).toBe('TD')
})

test('rejects source that is not a flowchart', () => {
  expect(parseFlowchart('sequenceDiagram\n  A->>B: hi')).toBeNull()
  expect(parseFlowchart('')).toBeNull()
  expect(parseFlowchart('flowchart TD')).toBeNull()
})

test('reads every supported node shape', () => {
  const chart = parseFlowchart(`flowchart TD
    A[Rect] --> B(Round)
    B --> C{Decision}
    C --> D([Stadium])
    D --> E[(Database)]
    E --> F((Circle))
    F --> G[[Subroutine]]
    G --> H{{Hexagon}}`)

  const shapes = Object.fromEntries(chart!.nodes.map((node) => [node.id, node.shape]))
  expect(shapes).toEqual({
    A: 'rect',
    B: 'round',
    C: 'diamond',
    D: 'stadium',
    E: 'database',
    F: 'circle',
    G: 'subroutine',
    H: 'diamond',
  })
  expect(chart!.nodes.find((node) => node.id === 'E')?.label).toBe('Database')
})

test('reads link styles and arrowheads', () => {
  const chart = parseFlowchart(`flowchart TD
    A --> B
    B --- C
    C -.-> D
    D ==> E
    E -.- F`)

  expect(chart!.edges.map((edge) => `${edge.style}${edge.arrow ? '>' : ''}`)).toEqual([
    'solid>',
    'solid',
    'dashed>',
    'thick>',
    'dashed',
  ])
})

test('reads edge labels in both spellings', () => {
  const piped = parseFlowchart('flowchart TD\n  A -->|yes| B')
  expect(piped!.edges[0]?.label).toBe('yes')

  const inline = parseFlowchart('flowchart TD\n  A -- no --> B')
  expect(inline!.edges[0]?.label).toBe('no')
  expect(inline!.edges[0]?.arrow).toBe(true)
})

test('chained statements produce one edge per link', () => {
  const chart = parseFlowchart('flowchart LR\n  A[Start] --> B{Check} --> C[End]')

  expect(chart!.nodes.map((node) => node.id)).toEqual(['A', 'B', 'C'])
  expect(chart!.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C'])
})

test('a label given in a later statement is adopted', () => {
  const chart = parseFlowchart('flowchart TD\n  A --> B\n  A[Composer]')

  expect(chart!.nodes.find((node) => node.id === 'A')?.label).toBe('Composer')
})

test('subgraph and styling directives are skipped without losing nodes', () => {
  const chart = parseFlowchart(`flowchart TD
    subgraph group one
      A[Inside] --> B[Also inside]
    end
    B --> C[Outside]
    style A fill:#f9f
    classDef big font-size:20px
    click A "https://example.com"`)

  expect(chart!.nodes.map((node) => node.id)).toEqual(['A', 'B', 'C'])
  expect(chart!.edges).toHaveLength(2)
})

test('comments, semicolons and quoted labels are handled', () => {
  const chart = parseFlowchart(`flowchart TD %% inline comment
    %% a whole-line comment
    A["Quoted <br/> label"] --> B; B --> C`)

  expect(chart!.nodes.find((node) => node.id === 'A')?.label).toBe('Quoted label')
  expect(chart!.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C'])
})
