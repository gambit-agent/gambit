import { expect, test } from 'bun:test'

import { parseSequenceDiagram } from './sequence-parse'

test('rejects source that is not a sequence diagram', () => {
  expect(parseSequenceDiagram('flowchart TD\n  A --> B')).toBeNull()
  expect(parseSequenceDiagram('sequenceDiagram')).toBeNull()
})

test('reads declared participants, aliases and actors', () => {
  const diagram = parseSequenceDiagram(`sequenceDiagram
    participant C as Composer
    actor U as User
    participant R`)

  expect(diagram!.participants).toEqual([
    { id: 'C', label: 'Composer', actor: false },
    { id: 'U', label: 'User', actor: true },
    { id: 'R', label: 'R', actor: false },
  ])
})

test('participants used without declaration are added in first-seen order', () => {
  const diagram = parseSequenceDiagram('sequenceDiagram\n  B->>A: hi\n  A->>C: onward')

  expect(diagram!.participants.map((participant) => participant.id)).toEqual(['B', 'A', 'C'])
})

test('reads every arrow style', () => {
  const diagram = parseSequenceDiagram(`sequenceDiagram
    A->>B: solid arrow
    A-->>B: dashed arrow
    A->B: solid open
    A-->B: dashed open
    A-xB: solid cross
    A--xB: dashed cross
    A-)B: solid async
    A--)B: dashed async`)

  const messages = diagram!.events.filter((event) => event.kind === 'message')
  expect(messages.map((event) => `${event.line}/${event.head}`)).toEqual([
    'solid/arrow',
    'dashed/arrow',
    'solid/open',
    'dashed/open',
    'solid/cross',
    'dashed/cross',
    'solid/async',
    'dashed/async',
  ])
  expect(messages[0]?.text).toBe('solid arrow')
})

test('reads inline activation shorthand', () => {
  const diagram = parseSequenceDiagram('sequenceDiagram\n  A->>+B: start\n  B-->>-A: finish')

  const messages = diagram!.events.filter((event) => event.kind === 'message')
  expect(messages[0]).toMatchObject({ to: 'B', activates: true, deactivates: false })
  expect(messages[1]).toMatchObject({ from: 'B', activates: false, deactivates: true })
})

test('reads explicit activation statements', () => {
  const diagram = parseSequenceDiagram('sequenceDiagram\n  activate A\n  A->>B: work\n  deactivate A')

  expect(diagram!.events.map((event) => event.kind)).toEqual(['activate', 'message', 'deactivate'])
})

test('reads notes in every placement', () => {
  const diagram = parseSequenceDiagram(`sequenceDiagram
    Note over A,B: spanning note
    Note left of A: on the left
    Note right of B: on the right`)

  const notes = diagram!.events.filter((event) => event.kind === 'note')
  expect(notes.map((note) => note.placement)).toEqual(['over', 'left', 'right'])
  expect(notes[0]?.participants).toEqual(['A', 'B'])
  expect(notes[0]?.text).toBe('spanning note')
})

test('reads grouping blocks and their branches', () => {
  const diagram = parseSequenceDiagram(`sequenceDiagram
    loop until done
      A->>B: retry
    end
    alt success
      A->>B: ok
    else failure
      A->>B: nope
    end`)

  expect(diagram!.events.map((event) => event.kind)).toEqual([
    'block-start',
    'message',
    'block-end',
    'block-start',
    'message',
    'block-else',
    'message',
    'block-end',
  ])
  const blocks = diagram!.events.filter((event) => event.kind === 'block-start')
  expect(blocks.map((block) => `${block.blockType}:${block.label}`)).toEqual([
    'loop:until done',
    'alt:success',
  ])
})

test('a message whose sender shares a block keyword is still a message', () => {
  // `rect` is a block keyword, but this line carries an arrow so it is a message.
  const diagram = parseSequenceDiagram('sequenceDiagram\n  rect->>B: still a message')

  expect(diagram!.events[0]?.kind).toBe('message')
})
