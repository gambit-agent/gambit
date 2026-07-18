import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { toCoreMessages } from '../lib/messages'
import { createConversationStore } from './conversation-store'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-conversation-store-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('returns a stable snapshot object until state changes', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'snapshot-test' })
  await store.initialize()

  const initialSnapshot = store.getSnapshot()
  expect(store.getSnapshot()).toBe(initialSnapshot)

  await store.pushMessage({
    id: 'message-1',
    role: 'user',
    content: 'hello',
    timestamp: new Date().toISOString(),
  })

  const updatedSnapshot = store.getSnapshot()
  expect(updatedSnapshot).not.toBe(initialSnapshot)
  expect(store.getSnapshot()).toBe(updatedSnapshot)
})

test('can switch between persisted conversations and rewrite the active transcript', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'first-session' })
  await store.initialize()
  await store.pushMessage({
    id: 'message-1',
    role: 'user',
    content: 'first conversation',
    timestamp: new Date().toISOString(),
  })

  await store.openConversation('second-session')
  await store.pushMessage({
    id: 'message-2',
    role: 'user',
    content: 'second conversation',
    timestamp: new Date().toISOString(),
  })

  await store.openConversation('first-session')
  expect(store.getSnapshot().conversationId).toBe('first-session')
  expect(store.getSnapshot().messages.map((message) => message.content)).toEqual(['first conversation'])

  await store.replaceMessages([
    {
      id: 'message-3',
      role: 'assistant',
      content: 'rewritten conversation',
      timestamp: new Date().toISOString(),
    },
  ])

  await store.openConversation('first-session')
  expect(store.getSnapshot().messages.map((message) => message.content)).toEqual(['rewritten conversation'])
})

test('appends message batches', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'append-batch-test' })
  await store.initialize()

  await store.appendMessages([
    {
      id: 'message-1',
      role: 'assistant',
      content: 'batched response',
      timestamp: new Date().toISOString(),
    },
  ])

  expect((await store.loadMessages()).map((message) => message.content)).toEqual(['batched response'])
})

test('persists image attachments for resumed model replay', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'image-roundtrip' })
  await store.initialize()
  await store.pushMessage({
    id: 'user-image',
    role: 'user',
    content: 'inspect this',
    timestamp: new Date().toISOString(),
    metadata: {
      attachments: [{
        id: 'image-1',
        name: 'screen.png',
        mediaType: 'image/png',
        data: 'iVBORw0KGgo=',
        size: 8,
      }],
    },
  })

  const loaded = await store.loadMessages()
  expect(loaded[0]?.metadata?.attachments?.[0]).toMatchObject({
    name: 'screen.png',
    mediaType: 'image/png',
    data: 'iVBORw0KGgo=',
  })
})

test('message replacement only writes message records', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'replace-writes-messages' })
  await store.initialize()

  await store.replaceMessages([
    {
      id: 'message-1',
      role: 'assistant',
      content: 'compacted',
      timestamp: new Date().toISOString(),
    },
  ])

  expect((await store.loadMessages()).map((message) => message.content)).toEqual(['compacted'])
})

test('persists tool args and results so resumed sessions replay real tool output', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'tool-metadata-roundtrip' })
  await store.initialize()

  await store.pushMessage({
    id: 'tool-1',
    role: 'tool',
    content: 'Read file\nlarge.txt',
    timestamp: new Date().toISOString(),
    metadata: {
      toolCallId: 'tool-1',
      toolName: 'readFile',
      toolArgs: { path: 'large.txt' },
      toolResult: 'x'.repeat(10_000),
      toolStatus: 'completed',
      toolArtifactPath: '.gambit/artifacts/tool-1.txt',
    },
  })

  const messages = await store.loadMessages()
  expect(messages[0]?.metadata).toEqual({
    toolCallId: 'tool-1',
    toolName: 'readFile',
    toolArgs: { path: 'large.txt' },
    toolResult: 'x'.repeat(10_000),
    toolStatus: 'completed',
    toolArtifactPath: '.gambit/artifacts/tool-1.txt',
  })
})

test('caps oversized tool results at persistence time with an explicit truncation marker', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'tool-result-cap' })
  await store.initialize()

  await store.pushMessage({
    id: 'tool-1',
    role: 'tool',
    content: 'Read file\nhuge.txt',
    timestamp: new Date().toISOString(),
    metadata: {
      toolCallId: 'tool-1',
      toolName: 'readFile',
      toolArgs: { path: 'huge.txt' },
      toolResult: 'y'.repeat(40_000),
      toolStatus: 'completed',
    },
  })

  const messages = await store.loadMessages()
  const persistedResult = messages[0]?.metadata?.toolResult
  expect(typeof persistedResult).toBe('string')
  expect((persistedResult as string).length).toBeLessThan(20_000)
  expect(persistedResult as string).toEndWith('[truncated for persistence]')
  expect((persistedResult as string).startsWith('yyyy')).toBe(true)
})

test('caps oversized structured tool results by serializing them', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'tool-result-cap-json' })
  await store.initialize()

  await store.pushMessage({
    id: 'tool-1',
    role: 'tool',
    content: 'ran tool',
    timestamp: new Date().toISOString(),
    metadata: {
      toolCallId: 'tool-1',
      toolName: 'bash',
      toolArgs: { command: 'ls' },
      toolResult: { type: 'text', value: 'z'.repeat(40_000) },
      toolStatus: 'completed',
    },
  })

  const messages = await store.loadMessages()
  const persistedResult = messages[0]?.metadata?.toolResult
  expect(typeof persistedResult).toBe('string')
  expect(persistedResult as string).toEndWith('[truncated for persistence]')
})

test('round-trips tool calls through persistence into model messages', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'replay-roundtrip' })
  await store.initialize()

  const now = new Date().toISOString()
  await store.appendMessages([
    { id: 'u1', role: 'user', content: 'read the file', timestamp: now },
    { id: 'a1', role: 'assistant', content: 'reading it', timestamp: now },
    {
      id: 'call-1',
      role: 'tool',
      content: 'Read file\nnote.txt · 11 chars',
      timestamp: now,
      metadata: {
        toolCallId: 'call-1',
        toolName: 'readFile',
        toolArgs: { path: 'note.txt' },
        toolResult: 'hello world',
        toolStatus: 'completed',
      },
    },
  ])

  // Fresh store instance simulates resuming the session from disk.
  const resumed = createConversationStore({ rootPath: tempRoot, conversationId: 'replay-roundtrip' })
  await resumed.initialize()
  const loaded = await resumed.loadMessages()
  const core = toCoreMessages(loaded.map((message) => ({ ...message, timestamp: new Date(message.timestamp) })))

  expect(core[1]).toEqual({
    role: 'assistant',
    content: [
      { type: 'text', text: 'reading it' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'readFile', input: { path: 'note.txt' } },
    ],
  })
  expect(core[2]).toEqual({
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'readFile', output: { type: 'text', value: 'hello world' } },
    ],
  })
})

test('legacy transcripts without persisted tool results replay an honest placeholder', async () => {
  const conversationId = 'legacy-transcript'
  const directory = path.join(tempRoot, '.gambit', 'conversations', conversationId)
  await mkdir(directory, { recursive: true })
  const legacyEntries = [
    { kind: 'message', id: 'u1', role: 'user', content: 'run it', timestamp: '2026-01-01T00:00:00.000Z' },
    { kind: 'message', id: 'a1', role: 'assistant', content: 'running', timestamp: '2026-01-01T00:00:01.000Z' },
    {
      kind: 'message',
      id: 'call-1',
      role: 'tool',
      content: 'Ran command\nls · 2 entries',
      timestamp: '2026-01-01T00:00:02.000Z',
      metadata: { toolCallId: 'call-1', toolName: 'bash', toolStatus: 'completed' },
    },
  ]
  await writeFile(
    path.join(directory, 'transcript.jsonl'),
    legacyEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  )

  const store = createConversationStore({ rootPath: tempRoot, conversationId })
  await store.initialize()
  const loaded = await store.loadMessages()
  const core = toCoreMessages(loaded.map((message) => ({ ...message, timestamp: new Date(message.timestamp) })))

  const toolMessage = core[2]
  if (toolMessage?.role !== 'tool' || typeof toolMessage.content === 'string') {
    throw new Error('expected structured tool message')
  }
  expect(toolMessage.content[0]).toEqual({
    type: 'tool-result',
    toolCallId: 'call-1',
    toolName: 'bash',
    output: {
      type: 'text',
      value: '[tool output not persisted from a previous session; re-run the tool if needed]',
    },
  })
})
