import { CharCanvas, type StrokeStyle } from './canvas'
import type { SequenceDiagram, SequenceEvent, SequenceParticipant } from './sequence-parse'

/**
 * Renders a parsed sequence diagram onto a character grid: a header box and
 * lifeline per participant, messages as horizontal arrows between lifelines,
 * and grouping blocks as frames around the rows they span.
 */

const HEADER_HEIGHT = 3
const BASE_LANE_GAP = 4
const MIN_MESSAGE_WIDTH = 6
/** Rows a message occupies: one of clear lifeline, then the arrow itself. */
const MESSAGE_ROWS = 2
const SELF_MESSAGE_ROWS = 3
const NOTE_ROWS = 3
/** Heavy vertical marking a participant that is currently activated. */
const ACTIVE_LIFELINE = '┃'

export interface SequenceRenderOptions {
  maxWidth: number
  maxLabelWidth?: number
  /** Base columns between participant boxes before message labels widen them. */
  laneGap?: number
}

interface Lane {
  participant: SequenceParticipant
  displayLabel: string
  width: number
  x: number
  center: number
}

interface PlacedEvent {
  event: SequenceEvent
  row: number
  height: number
  depth: number
}

function truncate(value: string, maxLabelWidth: number | undefined): string {
  if (!maxLabelWidth || value.length <= maxLabelWidth) {
    return value
  }
  if (maxLabelWidth <= 1) {
    return value.slice(0, 1)
  }
  return `${value.slice(0, maxLabelWidth - 1)}…`
}

function headBefore(head: string): string {
  switch (head) {
    case 'arrow':
      return '▶'
    case 'cross':
      return '✗'
    case 'async':
      return '>'
    default:
      return '─'
  }
}

function headAfterReverse(head: string): string {
  switch (head) {
    case 'arrow':
      return '◀'
    case 'cross':
      return '✗'
    case 'async':
      return '<'
    default:
      return '─'
  }
}

/**
 * Widen the gaps between lanes until every message label fits between the two
 * lifelines it connects. Labels ride on the arrow, so a gap that is too narrow
 * would clip the text rather than wrap it.
 */
function resolveLaneGaps(
  lanes: Lane[],
  events: readonly SequenceEvent[],
  indexById: Map<string, number>,
  baseGap: number,
): number[] {
  const gaps = new Array<number>(Math.max(0, lanes.length - 1)).fill(baseGap)

  const layout = (): void => {
    let x = 0
    lanes.forEach((lane, index) => {
      lane.x = x
      lane.center = x + Math.floor(lane.width / 2)
      x += lane.width + (gaps[index] ?? 0)
    })
  }

  layout()

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false
    for (const event of events) {
      if (event.kind !== 'message') {
        continue
      }
      const fromIndex = indexById.get(event.from)
      const toIndex = indexById.get(event.to)
      if (fromIndex === undefined || toIndex === undefined) {
        continue
      }

      const required = Math.max(event.text.length + 4, MIN_MESSAGE_WIDTH)

      if (fromIndex === toIndex) {
        // A self-message loops out to the right of its own lifeline, so the
        // gap has to clear both the loop and the label beside it.
        const gapIndex = Math.min(fromIndex, gaps.length - 1)
        const selfRequired = event.text.length + 8
        if (gapIndex >= 0 && gaps[gapIndex]! < selfRequired) {
          gaps[gapIndex] = selfRequired
          changed = true
        }
        continue
      }

      const low = Math.min(fromIndex, toIndex)
      const high = Math.max(fromIndex, toIndex)
      const distance = lanes[high]!.center - lanes[low]!.center
      const deficit = required - distance
      if (deficit > 0) {
        const share = Math.ceil(deficit / (high - low))
        for (let index = low; index < high; index += 1) {
          gaps[index] = (gaps[index] ?? 0) + share
        }
        changed = true
      }
    }
    layout()
    if (!changed) {
      break
    }
  }

  return gaps
}

export function renderSequenceDiagram(diagram: SequenceDiagram, options: SequenceRenderOptions): string[] | null {
  if (diagram.participants.length === 0) {
    return null
  }

  const lanes: Lane[] = diagram.participants.map((participant) => {
    const displayLabel = truncate(participant.label, options.maxLabelWidth)
    const naturalWidth = displayLabel.length + 4
    return {
      participant,
      displayLabel,
      // Odd widths keep the lifeline exactly under the middle of the box.
      width: naturalWidth % 2 === 0 ? naturalWidth + 1 : naturalWidth,
      x: 0,
      center: 0,
    }
  })

  const indexById = new Map(lanes.map((lane, index) => [lane.participant.id, index]))
  resolveLaneGaps(lanes, diagram.events, indexById, options.laneGap ?? BASE_LANE_GAP)

  // Blocks are drawn as nested frames, so reserve a margin wide enough for the
  // deepest nesting on each side.
  let depth = 0
  let maxDepth = 0
  for (const event of diagram.events) {
    if (event.kind === 'block-start') {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
    } else if (event.kind === 'block-end') {
      depth = Math.max(0, depth - 1)
    }
  }
  const margin = maxDepth > 0 ? maxDepth + 1 : 0
  for (const lane of lanes) {
    lane.x += margin
    lane.center += margin
  }

  // Place every event on a row, tracking block depth for frame insets.
  const placed: PlacedEvent[] = []
  let row = HEADER_HEIGHT
  depth = 0
  for (const event of diagram.events) {
    switch (event.kind) {
      case 'message': {
        const selfMessage = event.from === event.to
        const height = selfMessage ? SELF_MESSAGE_ROWS : MESSAGE_ROWS
        placed.push({ event, row, height, depth })
        row += height
        break
      }
      case 'note': {
        placed.push({ event, row, height: NOTE_ROWS, depth })
        row += NOTE_ROWS
        break
      }
      case 'block-start': {
        placed.push({ event, row, height: 1, depth })
        depth += 1
        row += 1
        break
      }
      case 'block-else': {
        placed.push({ event, row, height: 1, depth: Math.max(0, depth - 1) })
        row += 1
        break
      }
      case 'block-end': {
        depth = Math.max(0, depth - 1)
        placed.push({ event, row, height: 1, depth })
        row += 1
        break
      }
      default: {
        placed.push({ event, row, height: 0, depth })
        break
      }
    }
  }

  const lastLane = lanes[lanes.length - 1]!
  const totalWidth = lastLane.x + lastLane.width + margin
  const totalHeight = row + 1

  if (totalWidth > options.maxWidth || totalWidth <= 0) {
    return null
  }

  const canvas = new CharCanvas(totalWidth, totalHeight)

  // Header boxes and full-length lifelines first; everything else draws over.
  for (const lane of lanes) {
    canvas.rectangle(lane.x, 0, lane.width, HEADER_HEIGHT)
    const label = lane.participant.actor ? `◍ ${lane.displayLabel}` : lane.displayLabel
    const interior = lane.width - 2
    const offset = Math.max(0, Math.floor((interior - label.length) / 2))
    canvas.text(lane.x + 1 + offset, 1, label.slice(0, interior))
    canvas.vertical(lane.center, HEADER_HEIGHT, totalHeight - 1)
  }

  // Activation spans, so the heavy lifeline is in place before arrows land.
  const activeSince = new Map<string, number>()
  for (const item of placed) {
    const { event } = item
    const markActive = (participant: string, from: number, to: number): void => {
      const lane = lanes[indexById.get(participant) ?? -1]
      if (!lane) {
        return
      }
      for (let y = from; y <= to; y += 1) {
        canvas.set(lane.center, y, ACTIVE_LIFELINE)
      }
    }

    if (event.kind === 'activate') {
      activeSince.set(event.participant, item.row)
    } else if (event.kind === 'deactivate') {
      const start = activeSince.get(event.participant)
      if (start !== undefined) {
        markActive(event.participant, start, item.row)
        activeSince.delete(event.participant)
      }
    } else if (event.kind === 'message') {
      if (event.activates) {
        activeSince.set(event.to, item.row + item.height - 1)
      }
      if (event.deactivates) {
        const start = activeSince.get(event.from)
        if (start !== undefined) {
          markActive(event.from, start, item.row + item.height - 1)
          activeSince.delete(event.from)
        }
      }
    }
  }
  // An activation left open runs to the bottom of the diagram.
  for (const [participant, start] of activeSince) {
    const lane = lanes[indexById.get(participant) ?? -1]
    if (lane) {
      for (let y = start; y < totalHeight - 1; y += 1) {
        canvas.set(lane.center, y, ACTIVE_LIFELINE)
      }
    }
  }

  const blockStack: PlacedEvent[] = []

  for (const item of placed) {
    const { event } = item

    if (event.kind === 'message') {
      const fromIndex = indexById.get(event.from)
      const toIndex = indexById.get(event.to)
      if (fromIndex === undefined || toIndex === undefined) {
        continue
      }
      const stroke: StrokeStyle = event.line === 'dashed' ? 'dashed' : 'solid'
      const arrowRow = item.row + item.height - 1

      if (fromIndex === toIndex) {
        // Self-message: a short loop out to the right of the lifeline, with
        // the label beside it. The loop stays narrow so the label has room
        // before the next lane.
        const lane = lanes[fromIndex]!
        const reach = Math.min(lane.center + 3, totalWidth - 2)
        canvas.horizontal(lane.center, reach, item.row, stroke)
        canvas.vertical(reach, item.row, arrowRow, stroke)
        canvas.horizontal(lane.center + 1, reach, arrowRow, stroke)
        canvas.set(lane.center + 1, arrowRow, '◀')
        if (event.text) {
          canvas.textAtFirstFree(
            [
              { x: reach + 2, y: item.row + 1 },
              { x: reach + 2, y: item.row },
              { x: reach + 2, y: arrowRow },
            ],
            event.text,
          )
        }
        continue
      }

      const goingRight = toIndex > fromIndex
      const fromLane = lanes[fromIndex]!
      const toLane = lanes[toIndex]!
      // Stop one cell short so the target lifeline stays unbroken.
      const arrowX = goingRight ? toLane.center - 1 : toLane.center + 1
      const startX = goingRight ? fromLane.center + 1 : fromLane.center - 1

      canvas.horizontal(startX, arrowX, arrowRow, stroke)
      canvas.set(arrowX, arrowRow, goingRight ? headBefore(event.head) : headAfterReverse(event.head))

      if (event.text) {
        const left = Math.min(startX, arrowX)
        const right = Math.max(startX, arrowX)
        const available = right - left - 1
        const text = event.text.length > available ? truncate(event.text, Math.max(1, available)) : event.text
        const offset = left + Math.max(1, Math.floor((available - text.length) / 2) + 1)
        canvas.text(offset, arrowRow, text)
      }
      continue
    }

    if (event.kind === 'note') {
      const indexes = event.participants
        .map((id) => indexById.get(id))
        .filter((value): value is number => value !== undefined)
      if (indexes.length === 0) {
        continue
      }
      const first = lanes[Math.min(...indexes)]!
      const last = lanes[Math.max(...indexes)]!

      let boxLeft: number
      let boxWidth: number
      if (event.placement === 'over') {
        boxLeft = Math.min(first.center - 2, first.x)
        boxWidth = Math.max(last.center + 2, last.x + last.width) - boxLeft
      } else if (event.placement === 'left') {
        boxWidth = event.text.length + 4
        boxLeft = Math.max(0, first.center - boxWidth)
      } else {
        boxWidth = event.text.length + 4
        boxLeft = Math.min(totalWidth - boxWidth, last.center + 1)
      }
      boxWidth = Math.max(boxWidth, event.text.length + 4)
      boxLeft = Math.max(0, Math.min(boxLeft, totalWidth - boxWidth))

      // Clear the lifelines the note sits on so its interior reads as a box.
      for (let y = item.row; y < item.row + NOTE_ROWS; y += 1) {
        for (let x = boxLeft; x < boxLeft + boxWidth; x += 1) {
          canvas.clear(x, y)
        }
      }
      canvas.rectangle(boxLeft, item.row, boxWidth, NOTE_ROWS)
      canvas.set(boxLeft, item.row, '╭')
      canvas.set(boxLeft + boxWidth - 1, item.row, '╮')
      canvas.set(boxLeft, item.row + NOTE_ROWS - 1, '╰')
      canvas.set(boxLeft + boxWidth - 1, item.row + NOTE_ROWS - 1, '╯')
      const interior = boxWidth - 2
      const offset = Math.max(0, Math.floor((interior - event.text.length) / 2))
      canvas.text(boxLeft + 1 + offset, item.row + 1, event.text.slice(0, interior))
      continue
    }

    if (event.kind === 'block-start') {
      blockStack.push(item)
      continue
    }

    if (event.kind === 'block-else') {
      const inset = item.depth
      const left = inset
      const right = totalWidth - 1 - inset
      canvas.horizontal(left, right, item.row)
      const label = event.label ? ` else ${event.label} ` : ' else '
      canvas.text(left + 2, item.row, label)
      continue
    }

    if (event.kind === 'block-end') {
      const start = blockStack.pop()
      if (!start || start.event.kind !== 'block-start') {
        continue
      }
      const inset = item.depth
      const left = inset
      const right = totalWidth - 1 - inset
      const top = start.row
      const bottom = item.row
      if (right - left < 4 || bottom <= top) {
        continue
      }
      canvas.horizontal(left, right, top)
      canvas.horizontal(left, right, bottom)
      canvas.vertical(left, top, bottom)
      canvas.vertical(right, top, bottom)
      canvas.set(left, top, '╭')
      canvas.set(right, top, '╮')
      canvas.set(left, bottom, '╰')
      canvas.set(right, bottom, '╯')
      const label = start.event.label
        ? ` ${start.event.blockType} ${start.event.label} `
        : ` ${start.event.blockType} `
      canvas.text(left + 2, top, label)
    }
  }

  return canvas.toTrimmedLines()
}
