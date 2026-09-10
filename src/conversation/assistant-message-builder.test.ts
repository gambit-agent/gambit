import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { AssistantMessageBuilder } from './assistant-message-builder'
import { createConversationStore } from './conversation-store'
import { setUserGambitDirectoryForTesting } from '../session/user-data-paths'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-assistant-builder-'))
  setUserGambitDirectoryForTesting(tempRoot)
})

afterEach(async () => {
  setUserGambitDirectoryForTesting(null)
  await rm(tempRoot, { recursive: true, force: true })
})

test('records reasoning timing metadata on streamed assistant messages', async () => {
  const store = createConversationStore({ rootPath: tempRoot, conversationId: 'reasoning-timing' })
  await store.initialize()
  const builder = new AssistantMessageBuilder(store, true)

  await builder.appendReasoning('Inspecting context.')
  await builder.appendText('Done.')
  await builder.finish('Done.')

  const message = store.getSnapshot().messages.find((entry) => entry.role === 'assistant')
  expect(message?.metadata?.reasoningStartedAt).toBeString()
  expect(message?.metadata?.reasoningFinishedAt).toBeString()
  expect(message?.metadata?.reasoningDurationMs).toBeNumber()
  expect(message?.metadata?.reasoningDurationMs).toBeGreaterThanOrEqual(0)
})

test('flushes at the character and time thresholds and preserves the final text', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000)
  try {
    const store = createConversationStore({ rootPath: tempRoot })
    const builder = new AssistantMessageBuilder(store, false)
    await builder.appendText('start')
    const initial = store.getSnapshot()
    await builder.appendText('x'.repeat(511))
    expect(store.getSnapshot()).toBe(initial)
    await builder.appendText('x')
    expect(store.getSnapshot().messages[0]?.content).toBe('start' + 'x'.repeat(512))

    clock.mockReturnValue(1_100)
    await builder.appendText('timed')
    expect(store.getSnapshot().messages[0]?.content).toEndWith('timed')
    await builder.appendText('final')
    expect(store.getSnapshot().messages[0]?.content).toEndWith('timed')
    const finalText = 'start' + 'x'.repeat(512) + 'timedfinal'
    await builder.finish(finalText)
    expect(store.getSnapshot().messages[0]?.content).toBe(finalText)
    expect(initial.messages[0]?.content).toBe('start')
  } finally {
    clock.mockRestore()
  }
})

test('uses the exact composed length for reasoning and flushes segment boundaries', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000)
  try {
    const store = createConversationStore({ rootPath: tempRoot })
    const builder = new AssistantMessageBuilder(store, true)
    await builder.appendReasoning('   ')
    expect(store.getSnapshot().messages).toHaveLength(0)
    await builder.appendReasoning('thinking   ')
    const initial = store.getSnapshot()
    await builder.appendText('x'.repeat(511))
    expect(store.getSnapshot()).toBe(initial)
    await builder.appendText('x')
    expect(store.getSnapshot().messages[0]?.content).toBe('Reasoning:\nthinking\n\n' + 'x'.repeat(512))
    await builder.appendText('tail')
    const closed = await builder.startNextSegment()
    expect(closed?.text).toBe('x'.repeat(512) + 'tail')
    expect(closed?.hasVisibleReasoning).toBe(true)
    expect(store.getSnapshot().messages[0]?.content).toEndWith('tail')
    await builder.appendText('next')
    expect(store.getSnapshot().messages[1]?.content).toBe('next')
  } finally {
    clock.mockRestore()
  }
})
