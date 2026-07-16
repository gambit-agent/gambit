import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { buildDelegatedAgentBaseSystemPrompt, ConversationRunner } from './conversation-runner'
import { buildGoalSystemPrompt, createGoalMessage } from './goal'
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

  expect(result.summary).toBe('Read file\nnote.txt · 11 chars · 1 line')

  const messages = await store.loadMessages()
  expect(messages).toHaveLength(1)
  expect(messages[0]?.role).toBe('tool')
  expect(messages[0]?.content).toBe('Read file\nnote.txt · 11 chars · 1 line')
  expect(messages[0]?.metadata?.toolResult).toBeUndefined()
  expect(messages[0]?.metadata?.toolArgs).toBeUndefined()
  expect(messages[0]?.metadata?.toolName).toBe('readFile')
})

test('does not persist turn records to the conversation store', async () => {
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
  expect(turns).toHaveLength(0)
})

test('delegated agent base prompt includes the active conversation goal', () => {
  const goalPrompt = buildGoalSystemPrompt([createGoalMessage('finish the workflow port')])
  const delegatedPrompt = buildDelegatedAgentBaseSystemPrompt('Base prompt', goalPrompt)

  expect(delegatedPrompt).toContain('Base prompt')
  expect(delegatedPrompt).toContain('Current conversation goal:\nfinish the workflow port')
})

test('persists recalled memory context as a hidden user message without duplicates', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'memory-context-test' })
  const runner = new ConversationRunner({
    store,
    baseSystemPrompt: 'Base prompt',
    memoryStore: new MemoryStore(),
    createToolContext: () => ({ workspaceRoot: tempRoot }),
  })
  const appendMemoryContext = (context: string) =>
    (runner as unknown as { appendMemoryContext(context: string): Promise<void> }).appendMemoryContext(context)

  await appendMemoryContext('')
  expect(store.getSnapshot().messages).toHaveLength(0)

  await appendMemoryContext('Relevant memory context:\n\n## fact-one')
  let messages = store.getSnapshot().messages
  expect(messages).toHaveLength(1)
  expect(messages[0]?.role).toBe('user')
  expect(messages[0]?.hidden).toBe(true)
  expect(messages[0]?.metadata?.memoryContext).toBe(true)

  // Same context again: skipped.
  await appendMemoryContext('Relevant memory context:\n\n## fact-one')
  expect(store.getSnapshot().messages).toHaveLength(1)

  // Changed context: appended.
  await appendMemoryContext('Relevant memory context:\n\n## fact-two')
  messages = store.getSnapshot().messages
  expect(messages).toHaveLength(2)
  expect(messages[1]?.content).toContain('fact-two')

  // Persisted to the transcript, so later turns replay it identically.
  const persisted = await store.loadMessages()
  expect(persisted.filter((message) => message.metadata?.memoryContext)).toHaveLength(2)
})
