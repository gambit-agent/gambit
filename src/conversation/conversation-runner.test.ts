import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { ConversationRunner } from './conversation-runner'
import { createConversationStore } from './conversation-store'
import { MemoryStore } from '../memory/memory-store'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-conversation-'))
  setWorkspaceRootForTesting(tempRoot)
})

afterEach(async () => {
  setWorkspaceRootForTesting(originalWorkspaceRoot)
  await rm(tempRoot, { recursive: true, force: true })
})

test('records turns and tool calls through the tool executor', async () => {
  await writeFile(path.join(tempRoot, 'note.txt'), 'hello world')

  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'turn-test' })
  const runner = new ConversationRunner({
    store,
    baseSystemPrompt: 'Base prompt',
    memoryStore: new MemoryStore(),
    createToolContext: () => ({
      workspaceRoot: tempRoot,
    }),
  })

  const result = await runner.executeToolCall({
    toolCallId: 'call-1',
    toolId: 'readFile',
    input: { path: 'note.txt' },
  })

  expect(result.summary).toBe('hello world')

  const messages = await store.loadMessages()
  expect(messages).toHaveLength(1)
  expect(messages[0]?.role).toBe('tool')
  expect(messages[0]?.content).toBe('hello world')
})

test('appends turns to the conversation store', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'turn-test-append' })
  const runner = new ConversationRunner({
    store,
    baseSystemPrompt: 'Base prompt',
    memoryStore: new MemoryStore(),
    createToolContext: () => ({
      workspaceRoot: tempRoot,
    }),
  })

  const turn = {
    id: 'turn-1',
    startedAt: new Date().toISOString(),
    userInput: 'hello',
  }
  await runner.appendTurn(turn)

  const turns = await store.loadTurnRecords()
  expect(turns).toHaveLength(1)
  expect(turns[0]?.userInput).toBe('hello')
})
