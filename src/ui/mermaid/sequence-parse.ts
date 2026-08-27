/**
 * Parser for the subset of mermaid `sequenceDiagram` syntax worth drawing in a
 * terminal: participants, messages, notes, activations, and the grouping
 * blocks (loop / alt / opt / par).
 *
 * Like the flowchart parser it skips what it does not recognise rather than
 * rejecting the diagram.
 */

export type SequenceLineStyle = 'solid' | 'dashed'
export type SequenceArrowHead = 'arrow' | 'open' | 'cross' | 'async'
export type NotePlacement = 'over' | 'left' | 'right'

export interface SequenceParticipant {
  id: string
  label: string
  /** `actor` renders with a marker distinguishing it from a plain participant. */
  actor: boolean
}

export type SequenceEvent =
  | {
      kind: 'message'
      from: string
      to: string
      text: string
      line: SequenceLineStyle
      head: SequenceArrowHead
      /** `+` / `-` suffixes on the arrow, mermaid's inline activation shorthand. */
      activates: boolean
      deactivates: boolean
    }
  | { kind: 'note'; placement: NotePlacement; participants: string[]; text: string }
  | { kind: 'activate'; participant: string }
  | { kind: 'deactivate'; participant: string }
  | { kind: 'block-start'; blockType: string; label: string }
  | { kind: 'block-else'; label: string }
  | { kind: 'block-end' }

export interface SequenceDiagram {
  participants: SequenceParticipant[]
  events: SequenceEvent[]
}

/** Arrow operators, longest first so `-->>` is not read as `-->` plus `>`. */
const ARROW_PATTERNS: ReadonlyArray<{ token: string; line: SequenceLineStyle; head: SequenceArrowHead }> = [
  { token: '-->>', line: 'dashed', head: 'arrow' },
  { token: '--->', line: 'dashed', head: 'open' },
  { token: '--x', line: 'dashed', head: 'cross' },
  { token: '--)', line: 'dashed', head: 'async' },
  { token: '-->', line: 'dashed', head: 'open' },
  { token: '->>', line: 'solid', head: 'arrow' },
  { token: '-x', line: 'solid', head: 'cross' },
  { token: '-)', line: 'solid', head: 'async' },
  { token: '->', line: 'solid', head: 'open' },
]

const BLOCK_KEYWORDS = ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'] as const

function cleanLabel(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function parseSequenceDiagram(source: string): SequenceDiagram | null {
  const lines = source.split(/\r?\n/u)
  let headerSeen = false

  const participants = new Map<string, SequenceParticipant>()
  const events: SequenceEvent[] = []

  const ensureParticipant = (id: string, options: { label?: string; actor?: boolean } = {}): void => {
    const trimmed = id.trim()
    if (!trimmed) {
      return
    }
    const existing = participants.get(trimmed)
    if (!existing) {
      participants.set(trimmed, {
        id: trimmed,
        label: options.label ?? trimmed,
        actor: options.actor ?? false,
      })
      return
    }
    if (options.label) {
      existing.label = options.label
    }
    if (options.actor) {
      existing.actor = true
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/%%.*$/u, '').trim()
    if (!line) {
      continue
    }

    if (!headerSeen) {
      if (/^sequenceDiagram\b/iu.test(line)) {
        headerSeen = true
      }
      continue
    }

    const declaration = line.match(/^(participant|actor)\s+(.+)$/iu)
    if (declaration) {
      const body = declaration[2]!.trim()
      const alias = body.match(/^(.+?)\s+as\s+(.+)$/iu)
      const id = alias ? alias[1]!.trim() : body
      const label = alias ? cleanLabel(alias[2]!) : cleanLabel(body)
      ensureParticipant(id, { label, actor: declaration[1]!.toLowerCase() === 'actor' })
      continue
    }

    const note = line.match(/^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/iu)
    if (note) {
      const placementWord = note[1]!.toLowerCase()
      const placement: NotePlacement = placementWord === 'over' ? 'over' : placementWord === 'left of' ? 'left' : 'right'
      const targets = note[2]!
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      for (const target of targets) {
        ensureParticipant(target)
      }
      events.push({ kind: 'note', placement, participants: targets, text: cleanLabel(note[3]!) })
      continue
    }

    const activation = line.match(/^(activate|deactivate)\s+(.+)$/iu)
    if (activation) {
      const id = activation[2]!.trim()
      ensureParticipant(id)
      events.push(
        activation[1]!.toLowerCase() === 'activate'
          ? { kind: 'activate', participant: id }
          : { kind: 'deactivate', participant: id },
      )
      continue
    }

    if (/^end$/iu.test(line)) {
      events.push({ kind: 'block-end' })
      continue
    }

    const elseBranch = line.match(/^(?:else|and)\b\s*(.*)$/iu)
    if (elseBranch) {
      events.push({ kind: 'block-else', label: cleanLabel(elseBranch[1] ?? '') })
      continue
    }

    const blockStart = line.match(/^(\w+)\b\s*(.*)$/u)
    if (blockStart && (BLOCK_KEYWORDS as readonly string[]).includes(blockStart[1]!.toLowerCase())) {
      // Only treat this as a block when it is not actually a message whose
      // sender happens to be named e.g. `rect`.
      if (!ARROW_PATTERNS.some(({ token }) => line.includes(token))) {
        events.push({
          kind: 'block-start',
          blockType: blockStart[1]!.toLowerCase(),
          label: cleanLabel(blockStart[2] ?? ''),
        })
        continue
      }
    }

    const message = readMessage(line)
    if (message) {
      ensureParticipant(message.from)
      ensureParticipant(message.to)
      events.push(message)
    }
  }

  if (!headerSeen || participants.size === 0) {
    return null
  }

  return { participants: [...participants.values()], events }
}

function readMessage(line: string): Extract<SequenceEvent, { kind: 'message' }> | null {
  for (const { token, line: lineStyle, head } of ARROW_PATTERNS) {
    const index = line.indexOf(token)
    if (index === -1) {
      continue
    }

    const from = line.slice(0, index).trim()
    let rest = line.slice(index + token.length)
    if (!from) {
      continue
    }

    // Mermaid's `+` / `-` activation shorthand sits between the arrow and the
    // target name.
    let activates = false
    let deactivates = false
    const marker = rest.match(/^\s*([+-])/u)
    if (marker) {
      activates = marker[1] === '+'
      deactivates = marker[1] === '-'
      rest = rest.slice(marker[0]!.length)
    }

    const colonIndex = rest.indexOf(':')
    const to = (colonIndex === -1 ? rest : rest.slice(0, colonIndex)).trim()
    const text = colonIndex === -1 ? '' : cleanLabel(rest.slice(colonIndex + 1))
    if (!to) {
      continue
    }

    return { kind: 'message', from, to, text, line: lineStyle, head, activates, deactivates }
  }

  return null
}
