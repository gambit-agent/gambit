import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { AssistantMessageBuilder } from './assistant-message-builder'
import { createConversationStore } from './conversation-store'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-assistant-builder-'))
})

afterEach(async () => {
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
