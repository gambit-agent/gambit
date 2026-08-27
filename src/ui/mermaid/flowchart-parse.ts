/**
 * Parser for the subset of mermaid `flowchart` / `graph` syntax that is worth
 * drawing in a terminal.
 *
 * Deliberately tolerant: anything it does not recognise is skipped rather than
 * failing the whole diagram, because a diagram that renders most of its nodes
 * is more useful than falling back to raw source over one exotic line.
 */

export type FlowDirection = 'TD' | 'BT' | 'LR' | 'RL'

export type FlowNodeShape = 'rect' | 'round' | 'stadium' | 'diamond' | 'circle' | 'subroutine' | 'database'

export interface FlowNode {
  id: string
  label: string
  shape: FlowNodeShape
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  style: 'solid' | 'dashed' | 'thick'
  /** False for `---` style links, which carry no arrowhead. */
  arrow: boolean
}

export interface Flowchart {
  direction: FlowDirection
  nodes: FlowNode[]
  edges: FlowEdge[]
}

const HEADER = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\s*$/i

/**
 * Node shapes, longest delimiters first so `[[x]]` is not mistaken for `[x]`
 * with stray brackets.
 */
const SHAPE_PATTERNS: ReadonlyArray<{ open: string; close: string; shape: FlowNodeShape }> = [
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'database' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'diamond' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
]

/**
 * Link operators, longest first. `--` prefixed forms must be tested before the
 * bare `-` forms or `-->` would match as `-` + `->`.
 */
const LINK_PATTERNS: ReadonlyArray<{ token: string; style: FlowEdge['style']; arrow: boolean }> = [
  { token: '==>', style: 'thick', arrow: true },
  { token: '===', style: 'thick', arrow: false },
  { token: '-.->', style: 'dashed', arrow: true },
  { token: '-.-', style: 'dashed', arrow: false },
  { token: '-->', style: 'solid', arrow: true },
  { token: '---', style: 'solid', arrow: false },
  { token: '->', style: 'solid', arrow: true },
  { token: '--', style: 'solid', arrow: false },
]

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/** Strip mermaid's inline `<br/>` markers, which have no meaning on one line. */
function normalizeLabel(value: string): string {
  return stripQuotes(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

interface ParsedNodeRef {
  node: FlowNode
  /** Index just past the node reference in the source segment. */
  end: number
}

/**
 * Read a node reference — an id optionally followed by a shape and label — at
 * `start`. Returns null when there is no identifier there.
 */
function readNodeRef(segment: string, start: number): ParsedNodeRef | null {
  let index = start
  while (index < segment.length && /\s/u.test(segment[index]!)) {
    index += 1
  }

  const idStart = index
  while (index < segment.length && /[\w.-]/u.test(segment[index]!)) {
    index += 1
  }
  const id = segment.slice(idStart, index)
  if (!id) {
    return null
  }

  for (const { open, close, shape } of SHAPE_PATTERNS) {
    if (!segment.startsWith(open, index)) {
      continue
    }
    const closeIndex = segment.indexOf(close, index + open.length)
    if (closeIndex === -1) {
      continue
    }
    const label = normalizeLabel(segment.slice(index + open.length, closeIndex))
    return {
      node: { id, label: label || id, shape },
      end: closeIndex + close.length,
    }
  }

  return { node: { id, label: id, shape: 'rect' }, end: index }
}

interface ParsedLink {
  style: FlowEdge['style']
  arrow: boolean
  label?: string
  end: number
}

/**
 * Read a link operator at `start`, including both label spellings mermaid
 * allows: `-- text -->` and `-->|text|`.
 */
function readLink(segment: string, start: number): ParsedLink | null {
  let index = start
  while (index < segment.length && /\s/u.test(segment[index]!)) {
    index += 1
  }

  for (const { token, style, arrow } of LINK_PATTERNS) {
    if (!segment.startsWith(token, index)) {
      continue
    }
    let end = index + token.length

    // `-->|label|`
    if (segment[end] === '|') {
      const closeIndex = segment.indexOf('|', end + 1)
      if (closeIndex !== -1) {
        return { style, arrow, label: normalizeLabel(segment.slice(end + 1, closeIndex)), end: closeIndex + 1 }
      }
    }

    // `-- label -->`: an unarrowed operator, text, then a closing operator.
    if (!arrow) {
      const rest = segment.slice(end)
      const closing = rest.match(/^([^-=>|]*?)\s*(-\.->|-->|==>|->)/u)
      if (closing && closing[1] !== undefined && closing[1].trim()) {
        const closingToken = closing[2]!
        const closingStyle: FlowEdge['style'] = closingToken.startsWith('-.')
          ? 'dashed'
          : closingToken.startsWith('==')
            ? 'thick'
            : 'solid'
        return {
          style: style === 'solid' ? closingStyle : style,
          arrow: true,
          label: normalizeLabel(closing[1]),
          end: end + closing[0]!.length,
        }
      }
    }

    return { style, arrow, end }
  }

  return null
}

/** Split a line on `;`, which mermaid allows as a statement separator. */
function splitStatements(line: string): string[] {
  return line
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function parseFlowchart(source: string): Flowchart | null {
  const rawLines = source.split(/\r?\n/u)
  let direction: FlowDirection | null = null
  let headerSeen = false

  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []

  const recordNode = (node: FlowNode): void => {
    const existing = nodes.get(node.id)
    if (!existing) {
      nodes.set(node.id, node)
      return
    }
    // A later reference carrying a real shape or label wins: mermaid lets a
    // node be introduced bare in one statement and described in another.
    if (existing.label === existing.id && node.label !== node.id) {
      existing.label = node.label
    }
    if (existing.shape === 'rect' && node.shape !== 'rect') {
      existing.shape = node.shape
    }
  }

  for (const rawLine of rawLines) {
    const withoutComment = rawLine.replace(/%%.*$/u, '')
    const line = withoutComment.trim()
    if (!line) {
      continue
    }

    if (!headerSeen) {
      const header = line.match(HEADER)
      if (header) {
        headerSeen = true
        const value = header[1]?.toUpperCase()
        direction = value === 'TB' ? 'TD' : ((value as FlowDirection | undefined) ?? 'TD')
        continue
      }
    }

    for (const statement of splitStatements(line)) {
      // Subgraphs are flattened: their nodes still render, which beats
      // dropping the diagram over a grouping construct we do not draw.
      if (/^subgraph\b/iu.test(statement) || /^end$/iu.test(statement)) {
        continue
      }
      // Styling directives carry no structure worth drawing.
      if (/^(?:style|classDef|class|linkStyle|click|direction)\b/iu.test(statement)) {
        continue
      }

      let cursor = 0
      let previous = readNodeRef(statement, cursor)
      if (!previous) {
        continue
      }
      recordNode(previous.node)
      cursor = previous.end

      while (cursor < statement.length) {
        const link = readLink(statement, cursor)
        if (!link) {
          break
        }
        const target = readNodeRef(statement, link.end)
        if (!target) {
          break
        }
        recordNode(target.node)
        edges.push({
          from: previous.node.id,
          to: target.node.id,
          label: link.label,
          style: link.style,
          arrow: link.arrow,
        })
        previous = target
        cursor = target.end
      }
    }
  }

  if (!headerSeen || nodes.size === 0) {
    return null
  }

  return {
    direction: direction ?? 'TD',
    nodes: [...nodes.values()],
    edges,
  }
}
