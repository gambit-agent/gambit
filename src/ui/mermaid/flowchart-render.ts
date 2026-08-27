import { CharCanvas, DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, type StrokeStyle } from './canvas'
import type { Flowchart, FlowEdge, FlowNode, FlowNodeShape } from './flowchart-parse'

/**
 * Layered layout and box-drawing renderer for parsed flowcharts.
 *
 * Nodes are assigned ranks by longest path, ordered within each rank to reduce
 * edge crossings, then placed on a character grid. Edges are routed
 * orthogonally through the gap between rank bands.
 */

const NODE_HEIGHT = 3
/** Rows between vertical rank bands: one channel row plus room for a label. */
const VERTICAL_RANK_GAP = 3
const VERTICAL_NODE_GAP = 1

export interface FlowchartRenderOptions {
  maxWidth: number
  /** Labels longer than this are truncated; used to retry a diagram that overflowed. */
  maxLabelWidth?: number
  /** Columns between rank bands in a left-to-right layout. */
  rankGap?: number
  /** Columns between sibling nodes in a top-down layout. */
  nodeGap?: number
  /** Spaces between a label and its box border. */
  labelPadding?: number
}

const DEFAULT_RANK_GAP = 6
const DEFAULT_NODE_GAP = 3
const DEFAULT_LABEL_PADDING = 1

interface Corners {
  topLeft: string
  topRight: string
  bottomLeft: string
  bottomRight: string
}

/**
 * Shapes are distinguished by their corners rather than by outline geometry:
 * a true diamond or cylinder costs many rows in a terminal and buys little.
 */
const CORNERS_BY_SHAPE: Record<FlowNodeShape, Corners> = {
  rect: { topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘' },
  subroutine: { topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘' },
  round: { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯' },
  stadium: { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯' },
  circle: { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯' },
  database: { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯' },
  diamond: { topLeft: '╱', topRight: '╲', bottomLeft: '╲', bottomRight: '╱' },
}

/** Extra horizontal padding for shapes that should read as wider than a plain box. */
const EXTRA_PADDING_BY_SHAPE: Partial<Record<FlowNodeShape, number>> = {
  stadium: 1,
  circle: 2,
  subroutine: 1,
}

interface PlacedNode extends FlowNode {
  rank: number
  order: number
  displayLabel: string
  width: number
  height: number
  x: number
  y: number
}

function truncateLabel(label: string, maxLabelWidth: number | undefined): string {
  if (!maxLabelWidth || label.length <= maxLabelWidth) {
    return label
  }
  if (maxLabelWidth <= 1) {
    return label.slice(0, 1)
  }
  return `${label.slice(0, maxLabelWidth - 1)}…`
}

/**
 * Edges that close a cycle, found by depth-first search. They are excluded from
 * ranking so a cyclic graph still layers instead of ranking forever.
 */
function findBackEdges(nodeIds: readonly string[], edges: readonly FlowEdge[]): Set<number> {
  const outgoing = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const list = outgoing.get(edge.from)
    if (list) {
      list.push(index)
    } else {
      outgoing.set(edge.from, [index])
    }
  })

  const backEdges = new Set<number>()
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string): void => {
    state.set(id, 'visiting')
    for (const edgeIndex of outgoing.get(id) ?? []) {
      const edge = edges[edgeIndex]!
      if (edge.to === edge.from) {
        backEdges.add(edgeIndex)
        continue
      }
      const targetState = state.get(edge.to)
      if (targetState === 'visiting') {
        backEdges.add(edgeIndex)
        continue
      }
      if (targetState === undefined) {
        visit(edge.to)
      }
    }
    state.set(id, 'done')
  }

  for (const id of nodeIds) {
    if (!state.has(id)) {
      visit(id)
    }
  }

  return backEdges
}

/** Longest-path ranking over the acyclic subset of the graph. */
function assignRanks(nodeIds: readonly string[], edges: readonly FlowEdge[], backEdges: ReadonlySet<number>): Map<string, number> {
  const forward = edges.filter((_, index) => !backEdges.has(index))
  const incoming = new Map<string, string[]>()
  for (const id of nodeIds) {
    incoming.set(id, [])
  }
  for (const edge of forward) {
    incoming.get(edge.to)?.push(edge.from)
  }

  const ranks = new Map<string, number>()
  const resolving = new Set<string>()

  const rankOf = (id: string): number => {
    const cached = ranks.get(id)
    if (cached !== undefined) {
      return cached
    }
    if (resolving.has(id)) {
      return 0
    }
    resolving.add(id)
    let rank = 0
    for (const predecessor of incoming.get(id) ?? []) {
      rank = Math.max(rank, rankOf(predecessor) + 1)
    }
    resolving.delete(id)
    ranks.set(id, rank)
    return rank
  }

  for (const id of nodeIds) {
    rankOf(id)
  }
  return ranks
}

/**
 * Reduce edge crossings by repeatedly moving each node toward the average
 * position of its neighbours in the adjacent rank.
 */
function orderRanks(
  rankBuckets: Map<number, string[]>,
  edges: readonly FlowEdge[],
  ranks: ReadonlyMap<string, number>,
): void {
  const rankNumbers = [...rankBuckets.keys()].sort((a, b) => a - b)

  const sweep = (useSuccessors: boolean): void => {
    const ordered = useSuccessors ? [...rankNumbers].reverse() : rankNumbers
    for (const rank of ordered) {
      const bucket = rankBuckets.get(rank)
      if (!bucket || bucket.length < 2) {
        continue
      }
      const neighbourRank = useSuccessors ? rank + 1 : rank - 1
      const neighbours = rankBuckets.get(neighbourRank)
      if (!neighbours) {
        continue
      }
      const positions = new Map(neighbours.map((id, index) => [id, index]))
      const barycenters = new Map<string, number>()
      for (const id of bucket) {
        const related = edges
          .filter((edge) =>
            useSuccessors
              ? edge.from === id && ranks.get(edge.to) === neighbourRank
              : edge.to === id && ranks.get(edge.from) === neighbourRank,
          )
          .map((edge) => positions.get(useSuccessors ? edge.to : edge.from))
          .filter((value): value is number => value !== undefined)
        if (related.length > 0) {
          barycenters.set(id, related.reduce((sum, value) => sum + value, 0) / related.length)
        }
      }
      const originalIndex = new Map(bucket.map((id, index) => [id, index]))
      bucket.sort((a, b) => {
        const aValue = barycenters.get(a) ?? originalIndex.get(a)!
        const bValue = barycenters.get(b) ?? originalIndex.get(b)!
        if (aValue === bValue) {
          return originalIndex.get(a)! - originalIndex.get(b)!
        }
        return aValue - bValue
      })
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    sweep(false)
    sweep(true)
  }
}

function drawNode(canvas: CharCanvas, node: PlacedNode): void {
  canvas.rectangle(node.x, node.y, node.width, node.height)

  const corners = CORNERS_BY_SHAPE[node.shape]
  const right = node.x + node.width - 1
  const bottom = node.y + node.height - 1
  canvas.set(node.x, node.y, corners.topLeft)
  canvas.set(right, node.y, corners.topRight)
  canvas.set(node.x, bottom, corners.bottomLeft)
  canvas.set(right, bottom, corners.bottomRight)

  const interiorWidth = node.width - 2
  const labelOffset = Math.max(0, Math.floor((interiorWidth - node.displayLabel.length) / 2))
  canvas.text(node.x + 1 + labelOffset, node.y + 1, node.displayLabel)

  // A subroutine's double side rule is the one shape cue that lives inside the
  // box rather than on its corners.
  if (node.shape === 'subroutine' && interiorWidth > 4) {
    canvas.set(node.x + 1, node.y + 1, '│')
    canvas.set(right - 1, node.y + 1, '│')
  }
}

function strokeFor(edge: FlowEdge): StrokeStyle {
  return edge.style === 'dashed' ? 'dashed' : 'solid'
}

interface PendingLabel {
  /** Tried in order; the first position that is entirely free wins. */
  candidates: Array<{ x: number; y: number }>
  text: string
}

/**
 * Route one edge orthogonally: out of the source, along a channel in the gap
 * between the two nodes, then into the target. Direction comes from the boxes'
 * relative positions, so BT and RL need no special handling.
 */
function routeForwardEdge(
  canvas: CharCanvas,
  edge: FlowEdge,
  from: PlacedNode,
  to: PlacedNode,
  vertical: boolean,
  channelOffset: number,
  labels: PendingLabel[],
): void {
  const stroke = strokeFor(edge)

  if (vertical) {
    const goingDown = to.y > from.y
    const exitX = from.x + Math.floor(from.width / 2)
    const entryX = to.x + Math.floor(to.width / 2)
    const exitY = goingDown ? from.y + from.height - 1 : from.y
    const entryY = goingDown ? to.y : to.y + to.height - 1

    // Stagger only when the edge actually turns: a straight drop that gets
    // shifted sideways reads as a kink for no reason.
    const span = Math.abs(entryY - exitY)
    const base = goingDown ? exitY + 1 : exitY - 1
    const shift = exitX !== entryX && span > 2 ? channelOffset % Math.max(1, span - 1) : 0
    const channelY = goingDown ? base + shift : base - shift

    canvas.vertical(exitX, exitY, channelY, stroke)
    if (exitX !== entryX) {
      canvas.horizontal(exitX, entryX, channelY, stroke)
    }
    const arrowY = goingDown ? entryY - 1 : entryY + 1
    canvas.vertical(entryX, channelY, edge.arrow ? arrowY : entryY, stroke)
    if (edge.arrow) {
      canvas.set(entryX, arrowY, goingDown ? '▼' : '▲')
    }

    if (edge.label) {
      labels.push({
        text: edge.label,
        // Beside the arrowhead first: that reads unambiguously as labelling
        // the edge entering this node, even where several edges converge.
        candidates: [
          { x: entryX + 2, y: arrowY },
          { x: exitX + 2, y: channelY },
          { x: entryX + 2, y: goingDown ? arrowY - 1 : arrowY + 1 },
        ],
      })
    }
    return
  }

  const goingRight = to.x > from.x
  const exitY = from.y + Math.floor(from.height / 2)
  const entryY = to.y + Math.floor(to.height / 2)
  const exitX = goingRight ? from.x + from.width - 1 : from.x
  const entryX = goingRight ? to.x : to.x + to.width - 1

  const span = Math.abs(entryX - exitX)
  const base = goingRight ? exitX + 1 : exitX - 1
  const shift = exitY !== entryY && span > 2 ? channelOffset % Math.max(1, span - 1) : 0
  const channelX = goingRight ? base + shift : base - shift

  canvas.horizontal(exitX, channelX, exitY, stroke)
  if (exitY !== entryY) {
    canvas.vertical(channelX, exitY, entryY, stroke)
  }
  const arrowX = goingRight ? entryX - 1 : entryX + 1
  canvas.horizontal(channelX, edge.arrow ? arrowX : entryX, entryY, stroke)
  if (edge.arrow) {
    canvas.set(arrowX, entryY, goingRight ? '▶' : '◀')
  }

  if (edge.label) {
    const labelX = Math.min(channelX, arrowX)
    labels.push({
      text: edge.label,
      candidates: [
        { x: labelX, y: entryY - 1 },
        { x: labelX, y: entryY + 1 },
      ],
    })
  }
}

/**
 * Route an edge that runs backwards or within a rank out through a reserved
 * lane beside the diagram. Sending a loop back through the middle would cross
 * every node between its endpoints.
 */
function routeLaneEdge(
  canvas: CharCanvas,
  edge: FlowEdge,
  from: PlacedNode,
  to: PlacedNode,
  vertical: boolean,
  lane: number,
  labels: PendingLabel[],
): void {
  const stroke = strokeFor(edge)

  if (vertical) {
    const laneX = lane
    const exitY = from.y + 1
    const entryY = to.y + 1
    canvas.horizontal(from.x, laneX, exitY, stroke)
    canvas.vertical(laneX, exitY, entryY, stroke)
    const arrowX = to.x - 1
    canvas.horizontal(laneX, edge.arrow ? arrowX : to.x, entryY, stroke)
    if (edge.arrow) {
      canvas.set(arrowX, entryY, '▶')
    }
    if (edge.label) {
      labels.push({
        text: edge.label,
        candidates: [{ x: laneX + 1, y: Math.floor((exitY + entryY) / 2) }],
      })
    }
    return
  }

  const laneY = lane
  const exitX = from.x + Math.floor(from.width / 2)
  const entryX = to.x + Math.floor(to.width / 2)
  canvas.vertical(exitX, from.y, laneY, stroke)
  canvas.horizontal(exitX, entryX, laneY, stroke)
  const arrowY = to.y - 1
  canvas.vertical(entryX, laneY, edge.arrow ? arrowY : to.y, stroke)
  if (edge.arrow) {
    canvas.set(entryX, arrowY, '▼')
  }
  if (edge.label) {
    labels.push({
      text: edge.label,
      candidates: [{ x: Math.min(exitX, entryX) + 1, y: laneY - 1 }],
    })
  }
}

/**
 * Render a flowchart, or return null when it cannot be drawn within
 * `maxWidth`. Callers retry with a smaller `maxLabelWidth` before giving up.
 */
export function renderFlowchart(chart: Flowchart, options: FlowchartRenderOptions): string[] | null {
  if (chart.nodes.length === 0) {
    return null
  }

  const rankGap = options.rankGap ?? DEFAULT_RANK_GAP
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP
  const labelPadding = options.labelPadding ?? DEFAULT_LABEL_PADDING

  const nodeIds = chart.nodes.map((node) => node.id)
  const backEdges = findBackEdges(nodeIds, chart.edges)
  const ranks = assignRanks(nodeIds, chart.edges, backEdges)

  const rankBuckets = new Map<number, string[]>()
  for (const node of chart.nodes) {
    const rank = ranks.get(node.id) ?? 0
    const bucket = rankBuckets.get(rank)
    if (bucket) {
      bucket.push(node.id)
    } else {
      rankBuckets.set(rank, [node.id])
    }
  }
  orderRanks(rankBuckets, chart.edges, ranks)

  const maxRank = Math.max(...rankBuckets.keys())
  const reversed = chart.direction === 'BT' || chart.direction === 'RL'
  const vertical = chart.direction === 'TD' || chart.direction === 'BT'

  // Edges that run backwards or stay within a rank get their own lane beside
  // the diagram; reserve that space before positions are computed.
  const laneEdgeIndexes: number[] = []
  chart.edges.forEach((edge, index) => {
    if (edge.from === edge.to) {
      return
    }
    const fromRank = ranks.get(edge.from) ?? 0
    const toRank = ranks.get(edge.to) ?? 0
    if (toRank <= fromRank) {
      laneEdgeIndexes.push(index)
    }
  })
  const laneCount = laneEdgeIndexes.length
  // One column (or row) per lane, plus a spacer separating them from the nodes.
  const laneReserve = laneCount > 0 ? laneCount + 1 : 0

  const placed = new Map<string, PlacedNode>()
  for (const node of chart.nodes) {
    const rank = ranks.get(node.id) ?? 0
    const bucket = rankBuckets.get(rank)!
    const displayLabel = truncateLabel(node.label, options.maxLabelWidth)
    const extraPadding = EXTRA_PADDING_BY_SHAPE[node.shape] ?? 0
    const naturalWidth = displayLabel.length + 2 + labelPadding * 2 + extraPadding * 2
    placed.set(node.id, {
      ...node,
      displayLabel,
      rank: reversed ? maxRank - rank : rank,
      order: bucket.indexOf(node.id),
      // Odd widths keep every box centre on the same parity, so a straight
      // chain of nodes drops straight down instead of jogging a column.
      width: naturalWidth % 2 === 0 ? naturalWidth + 1 : naturalWidth,
      height: NODE_HEIGHT,
      x: 0,
      y: 0,
    })
  }

  const byRank = new Map<number, PlacedNode[]>()
  for (const node of placed.values()) {
    const bucket = byRank.get(node.rank)
    if (bucket) {
      bucket.push(node)
    } else {
      byRank.set(node.rank, [node])
    }
  }
  for (const bucket of byRank.values()) {
    bucket.sort((a, b) => a.order - b.order)
  }
  const rankNumbers = [...byRank.keys()].sort((a, b) => a - b)

  let totalWidth = 0
  let totalHeight = 0

  if (vertical) {
    // Ranks stack downward; nodes within a rank sit side by side.
    let y = 0
    for (const rank of rankNumbers) {
      const bucket = byRank.get(rank)!
      let x = 0
      for (const node of bucket) {
        node.x = x
        node.y = y
        x += node.width + nodeGap
      }
      totalWidth = Math.max(totalWidth, x - nodeGap)
      y += NODE_HEIGHT + VERTICAL_RANK_GAP
    }
    totalHeight = y - VERTICAL_RANK_GAP

    // Centre each rank so edges between differently sized ranks stay short.
    for (const rank of rankNumbers) {
      const bucket = byRank.get(rank)!
      const rankWidth = bucket.reduce((sum, node) => sum + node.width, 0) + nodeGap * (bucket.length - 1)
      const offset = Math.floor((totalWidth - rankWidth) / 2)
      for (const node of bucket) {
        node.x += offset
      }
    }
  } else {
    let x = 0
    for (const rank of rankNumbers) {
      const bucket = byRank.get(rank)!
      const columnWidth = Math.max(...bucket.map((node) => node.width))
      let y = 0
      for (const node of bucket) {
        node.x = x
        node.y = y
        y += NODE_HEIGHT + VERTICAL_NODE_GAP
      }
      totalHeight = Math.max(totalHeight, y - VERTICAL_NODE_GAP)
      x += columnWidth + rankGap
    }
    totalWidth = x - rankGap

    for (const rank of rankNumbers) {
      const bucket = byRank.get(rank)!
      const rankHeight = bucket.length * NODE_HEIGHT + VERTICAL_NODE_GAP * (bucket.length - 1)
      const offset = Math.floor((totalHeight - rankHeight) / 2)
      for (const node of bucket) {
        node.y += offset
      }
    }
  }

  if (laneReserve > 0) {
    for (const node of placed.values()) {
      if (vertical) {
        node.x += laneReserve
      } else {
        node.y += laneReserve
      }
    }
    if (vertical) {
      totalWidth += laneReserve
    } else {
      totalHeight += laneReserve
    }
  }

  if (totalWidth > options.maxWidth || totalWidth <= 0) {
    return null
  }

  const canvas = new CharCanvas(totalWidth, totalHeight)
  for (const node of placed.values()) {
    drawNode(canvas, node)
  }

  const channelCounters = new Map<string, number>()
  const labels: PendingLabel[] = []
  chart.edges.forEach((edge, index) => {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    // Self-loops carry no layout information worth the clutter.
    if (!from || !to || from === to) {
      return
    }
    const lane = laneEdgeIndexes.indexOf(index)
    if (lane !== -1) {
      routeLaneEdge(canvas, edge, from, to, vertical, lane, labels)
      return
    }
    const key = `${Math.min(from.rank, to.rank)}`
    const offset = channelCounters.get(key) ?? 0
    channelCounters.set(key, offset + 1)
    routeForwardEdge(canvas, edge, from, to, vertical, offset, labels)
  })

  // Labels go on last, and only where they do not overwrite the diagram: a
  // label that punches through an edge is worse than one that is dropped.
  for (const label of labels) {
    canvas.textAtFirstFree(label.candidates, label.text)
  }

  return canvas.toTrimmedLines()
}
