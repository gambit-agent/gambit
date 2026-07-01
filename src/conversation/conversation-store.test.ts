import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

test('appends message batches without writing turn records', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'append-batch-test' })
  await store.initialize()
  await store.appendTurn({
    id: 'turn-1',
    startedAt: new Date().toISOString(),
    userInput: 'first',
  })

  await store.appendMessages([
    {
      id: 'message-1',
      role: 'assistant',
      content: 'batched response',
      timestamp: new Date().toISOString(),
    },
  ])

  expect(await store.loadTurnRecords()).toHaveLength(0)
  expect((await store.loadMessages()).map((message) => message.content)).toEqual(['batched response'])
})

test('message replacement only writes compact message records', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'replace-writes-messages' })
  await store.initialize()
  await store.appendTurn({
    id: 'turn-1',
    startedAt: new Date().toISOString(),
    userInput: 'first',
  })

  await store.replaceMessages([
    {
      id: 'message-1',
      role: 'assistant',
      content: 'compacted',
      timestamp: new Date().toISOString(),
    },
  ])

  expect(await store.loadTurnRecords()).toHaveLength(0)
  expect((await store.loadMessages()).map((message) => message.content)).toEqual(['compacted'])
})

test('persists compact tool metadata without raw args or results', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'compact-tool-metadata' })
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
    toolStatus: 'completed',
    toolArtifactPath: '.gambit/artifacts/tool-1.txt',
  })
})
