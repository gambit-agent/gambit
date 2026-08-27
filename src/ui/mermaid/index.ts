import { parseFlowchart } from './flowchart-parse'
import { renderFlowchart } from './flowchart-render'
import { parseSequenceDiagram } from './sequence-parse'
import { renderSequenceDiagram } from './sequence-render'

/**
 * Entry point for drawing mermaid code blocks in the TUI.
 *
 * Returns the rendered lines, or null when the diagram is a type we do not
 * draw or cannot be fitted into the available width. A null result means the
 * caller should fall back to showing the block's source, so nothing the model
 * wrote is ever lost to a rendering limit.
 */

/**
 * Progressively tighter layouts, tried in order. Shrinking only the labels is
 * not enough on a narrow terminal — the gaps between nodes dominate the width
 * of a wide diagram — so each step tightens spacing as well.
 */
const FLOWCHART_ATTEMPTS: ReadonlyArray<{
  maxLabelWidth?: number
  rankGap: number
  nodeGap: number
  labelPadding: number
}> = [
  { maxLabelWidth: undefined, rankGap: 6, nodeGap: 3, labelPadding: 1 },
  { maxLabelWidth: 24, rankGap: 5, nodeGap: 3, labelPadding: 1 },
  { maxLabelWidth: 18, rankGap: 4, nodeGap: 2, labelPadding: 1 },
  { maxLabelWidth: 12, rankGap: 3, nodeGap: 2, labelPadding: 0 },
  { maxLabelWidth: 8, rankGap: 2, nodeGap: 1, labelPadding: 0 },
]

const SEQUENCE_ATTEMPTS: ReadonlyArray<{ maxLabelWidth?: number; laneGap: number }> = [
  { maxLabelWidth: undefined, laneGap: 4 },
  { maxLabelWidth: 24, laneGap: 3 },
  { maxLabelWidth: 18, laneGap: 2 },
  { maxLabelWidth: 12, laneGap: 2 },
  { maxLabelWidth: 8, laneGap: 1 },
]

/** Below this there is no room for even a minimal diagram. */
const MIN_DIAGRAM_WIDTH = 12

export function isMermaidLanguage(lang: string | undefined): boolean {
  return typeof lang === 'string' && lang.trim().toLowerCase().split(/\s+/u)[0] === 'mermaid'
}

export type MermaidDiagramKind = 'flowchart' | 'sequence' | 'unsupported'

/** Which diagram a block declares, read from its first meaningful line. */
export function detectDiagramKind(source: string): MermaidDiagramKind {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.replace(/%%.*$/u, '').trim()
    if (!line) {
      continue
    }
    if (/^(?:flowchart|graph)\b/iu.test(line)) {
      return 'flowchart'
    }
    if (/^sequenceDiagram\b/iu.test(line)) {
      return 'sequence'
    }
    return 'unsupported'
  }
  return 'unsupported'
}

export function renderMermaid(source: string, maxWidth: number): string[] | null {
  if (!Number.isFinite(maxWidth) || maxWidth < MIN_DIAGRAM_WIDTH) {
    return null
  }

  const kind = detectDiagramKind(source)

  if (kind === 'flowchart') {
    const chart = parseFlowchart(source)
    if (!chart) {
      return null
    }
    for (const attempt of FLOWCHART_ATTEMPTS) {
      const lines = renderFlowchart(chart, { maxWidth, ...attempt })
      if (lines && lines.length > 0) {
        return lines
      }
    }
    return null
  }

  if (kind === 'sequence') {
    const diagram = parseSequenceDiagram(source)
    if (!diagram) {
      return null
    }
    for (const attempt of SEQUENCE_ATTEMPTS) {
      const lines = renderSequenceDiagram(diagram, { maxWidth, ...attempt })
      if (lines && lines.length > 0) {
        return lines
      }
    }
    return null
  }

  return null
}

export { parseFlowchart } from './flowchart-parse'
export { parseSequenceDiagram } from './sequence-parse'
