import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { maxAgentSteps, setWorkspaceRootForTesting, workspaceRoot as originalWorkspaceRoot } from '../config'
import { toCoreMessages } from '../lib/messages'
import type { ModelStreamRunOptions, ModelStreamRunResult } from '../lib/streaming/model-stream-runner'
import { createRuntimeToolSuite } from '../tools/index'
import { buildDelegatedAgentBaseSystemPrompt, ConversationRunner } from './conversation-runner'
import { buildGoalSystemPrompt, createGoalMessage } from './goal'
import { createConversationStore, type ConversationStore } from './conversation-store'
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
  // Args and results are persisted so resumed sessions replay real tool output.
  expect(messages[0]?.metadata?.toolArgs).toEqual({ path: 'note.txt' })
  expect(messages[0]?.metadata?.toolResult).toBeDefined()
  expect(messages[0]?.metadata?.toolName).toBe('readFile')
})

test('delegated agent base prompt includes the active conversation goal', () => {
  const goalPrompt = buildGoalSystemPrompt([createGoalMessage('finish the workflow port')])
  const delegatedPrompt = buildDelegatedAgentBaseSystemPrompt('Base prompt', goalPrompt)

  expect(delegatedPrompt).toContain('Base prompt')
  expect(delegatedPrompt).toContain('Current conversation goal:\nfinish the workflow port')
})

test('persists recalled memory context as a single superseding hidden user message', async () => {
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

  // Changed context: supersedes the previous memory message instead of
  // accumulating a hidden blob per turn.
  await appendMemoryContext('Relevant memory context:\n\n## fact-two')
  messages = store.getSnapshot().messages
  const memoryMessages = messages.filter((message) => message.metadata?.memoryContext)
  expect(memoryMessages).toHaveLength(1)
  expect(memoryMessages[0]?.content).toContain('fact-two')

  // The removal is persisted too: resumed sessions replay one memory message.
  const persisted = await store.loadMessages()
  const persistedMemory = persisted.filter((message) => message.metadata?.memoryContext)
  expect(persistedMemory).toHaveLength(1)
  expect(persistedMemory[0]?.content).toContain('fact-two')
})

test('collapses legacy transcripts with multiple memory-context messages to one', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'memory-context-legacy-test' })
  await store.initialize()
  await store.pushMessage({
    id: 'mem-old',
    role: 'user',
    content: 'Relevant memory context:\n\n## stale-fact',
    timestamp: new Date().toISOString(),
    hidden: true,
    metadata: { memoryContext: true },
  })
  await store.pushMessage({
    id: 'mem-latest',
    role: 'user',
    content: 'Relevant memory context:\n\n## current-fact',
    timestamp: new Date().toISOString(),
    hidden: true,
    metadata: { memoryContext: true },
  })

  const runner = new ConversationRunner({
    store,
    baseSystemPrompt: 'Base prompt',
    memoryStore: new MemoryStore(),
    createToolContext: () => ({ workspaceRoot: tempRoot }),
  })
  const appendMemoryContext = (context: string) =>
    (runner as unknown as { appendMemoryContext(context: string): Promise<void> }).appendMemoryContext(context)

  // Unchanged context still collapses the accumulated legacy messages.
  await appendMemoryContext('Relevant memory context:\n\n## current-fact')
  const memoryMessages = store.getSnapshot().messages.filter((message) => message.metadata?.memoryContext)
  expect(memoryMessages).toHaveLength(1)
  expect(memoryMessages[0]?.content).toContain('current-fact')
})

function makeRunnerWithStream(
  store: ConversationStore,
  run: (options: ModelStreamRunOptions) => Promise<ModelStreamRunResult>,
): ConversationRunner {
  return new ConversationRunner({
    store,
    baseSystemPrompt: 'Base prompt',
    memoryStore: new MemoryStore(),
    createToolContext: () => ({ workspaceRoot: tempRoot }),
    createToolSuite: () =>
      createRuntimeToolSuite({ includeSpawnAgent: false, discoverMCPServerTools: false, workspaceRoot: tempRoot }),
    createModelStreamRunner: () => ({ run }),
  })
}

test('marks in-flight tools cancelled and the turn interrupted on user abort', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'abort-test' })
  await store.initialize()
  const runner = makeRunnerWithStream(store, async (options) => {
    // The AI SDK closes the stream after an abort part without throwing; the
    // tool call was started but its result never arrived.
    await options.handlers?.onToolCall?.({
      type: 'tool-call',
      toolCallId: 'tc-abort',
      toolName: 'bash',
      input: { command: 'sleep 100' },
    })
    return { text: '', streamedText: '', reasoning: '', aborted: true, stepCount: 0 }
  })

  const turn = await runner.runTurn({ userInput: 'run something', apiKey: '', modelId: 'test-model' })
  expect(turn.interrupted).toBe(true)

  const persisted = await store.loadMessages()
  const toolMessage = persisted.find((message) => message.metadata?.toolCallId === 'tc-abort')
  expect(toolMessage?.metadata?.toolStatus).toBe('cancelled')
  expect(toolMessage?.metadata?.toolResult).toBe('[cancelled by user]')

  // Replaying the cancelled tool produces an honest tool result, never a
  // fabricated success.
  const core = toCoreMessages(persisted.map((message) => ({ ...message, timestamp: new Date(message.timestamp) })))
  const replayedTool = core.find((message) => message.role === 'tool')
  if (!replayedTool || typeof replayedTool.content === 'string') {
    throw new Error('expected structured tool message')
  }
  expect(replayedTool.content[0]).toMatchObject({
    type: 'tool-result',
    toolCallId: 'tc-abort',
    output: { type: 'text', value: '[tool cancelled before completion]' },
  })
})

test('persists executed tool messages to disk when the turn fails mid-stream', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'error-persist-test' })
  await store.initialize()
  const runner = makeRunnerWithStream(store, async (options) => {
    await options.handlers?.onToolCall?.({
      type: 'tool-call',
      toolCallId: 'tc-err',
      toolName: 'bash',
      input: { command: 'touch marker.txt' },
    })
    await options.handlers?.onToolResult?.({
      type: 'tool-result',
      toolCallId: 'tc-err',
      toolName: 'bash',
      input: { command: 'touch marker.txt' },
      output: 'created marker.txt',
    })
    throw new Error('provider exploded')
  })

  await expect(
    runner.runTurn({ userInput: 'touch a file', apiKey: '', modelId: 'test-model' }),
  ).rejects.toThrow('provider exploded')

  // The tool executed a real side effect: the on-disk transcript records it.
  const persisted = await store.loadMessages()
  const toolMessage = persisted.find((message) => message.metadata?.toolCallId === 'tc-err')
  expect(toolMessage?.metadata?.toolStatus).toBe('completed')
  expect(toolMessage?.metadata?.toolResult).toBe('created marker.txt')
  expect(store.getSnapshot().error).toBe('provider exploded')
})

test('marks in-flight tools failed when the turn errors mid-execution', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'error-inflight-test' })
  await store.initialize()
  const runner = makeRunnerWithStream(store, async (options) => {
    // The tool call started but the provider died before its result arrived.
    await options.handlers?.onToolCall?.({
      type: 'tool-call',
      toolCallId: 'tc-inflight',
      toolName: 'bash',
      input: { command: 'sleep 100' },
    })
    throw new Error('provider exploded')
  })

  await expect(
    runner.runTurn({ userInput: 'run something', apiKey: '', modelId: 'test-model' }),
  ).rejects.toThrow('provider exploded')

  // Persisting the tool frozen at 'started' would render a forever-spinner on
  // resume; it must be finalized as failed with an honest result note.
  const persisted = await store.loadMessages()
  const toolMessage = persisted.find((message) => message.metadata?.toolCallId === 'tc-inflight')
  expect(toolMessage?.metadata?.toolStatus).toBe('failed')
  expect(toolMessage?.metadata?.toolResult).toBe('[interrupted by error]')
})

test('does not append a step-limit note when the model finished cleanly on the last step', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'step-limit-clean-test' })
  await store.initialize()
  const runner = makeRunnerWithStream(store, async (options) => {
    await options.handlers?.onTextDelta?.('all done', { type: 'text-delta' })
    return {
      text: 'all done',
      streamedText: 'all done',
      reasoning: '',
      aborted: false,
      finishReason: 'stop',
      stepCount: maxAgentSteps,
    }
  })

  const turn = await runner.runTurn({ userInput: 'do it', apiKey: '', modelId: 'test-model' })
  expect(turn.assistantOutput).toBe('all done')
  expect(turn.assistantOutput).not.toContain('step limit')
  expect(turn.assistantOutput).not.toContain('-step')
})

test('appends a step-limit note when the run was cut short at the step ceiling', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'step-limit-cut-test' })
  await store.initialize()
  const runner = makeRunnerWithStream(store, async (options) => {
    await options.handlers?.onTextDelta?.('still going', { type: 'text-delta' })
    return {
      text: 'still going',
      streamedText: 'still going',
      reasoning: '',
      aborted: false,
      finishReason: 'tool-calls',
      stepCount: maxAgentSteps,
    }
  })

  const turn = await runner.runTurn({ userInput: 'do it', apiKey: '', modelId: 'test-model' })
  expect(turn.assistantOutput).toContain('still going')
  expect(turn.assistantOutput).toContain(`${maxAgentSteps}-step limit`)
})

test('appends a visible truncation note when the model stops at max output length', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'truncation-test' })
  await store.initialize()
  const runner = makeRunnerWithStream(store, async (options) => {
    await options.handlers?.onTextDelta?.('partial answer', { type: 'text-delta' })
    return {
      text: 'partial answer',
      streamedText: 'partial answer',
      reasoning: '',
      aborted: false,
      finishReason: 'length',
      stepCount: 1,
    }
  })

  const turn = await runner.runTurn({ userInput: 'explain everything', apiKey: '', modelId: 'test-model' })
  expect(turn.finishReason).toBe('length')
  expect(turn.assistantOutput).toContain('partial answer')
  expect(turn.assistantOutput).toContain('truncated')

  const assistant = [...store.getSnapshot().messages].reverse().find((message) => message.role === 'assistant')
  expect(assistant?.content).toContain('truncated')
})
