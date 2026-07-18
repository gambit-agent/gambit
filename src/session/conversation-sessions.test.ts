import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createConversationStore } from '../conversation/conversation-store'
import { listConversationSessions } from './conversation-sessions'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'gambit-session-list-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('lists saved conversations in most-recent-first order with derived titles', async () => {
  const olderStore = createConversationStore({ rootPath: tempRoot, conversationId: 'older-session' })
  await olderStore.initialize()
  await olderStore.pushMessage({
    id: 'older-user',
    role: 'user',
    content: 'Investigate the auth timeout regression',
    timestamp: '2026-03-30T10:00:00.000Z',
  })

  const newerStore = createConversationStore({ rootPath: tempRoot, conversationId: 'newer-session' })
  await newerStore.initialize()
  await newerStore.pushMessage({
    id: 'newer-user',
    role: 'user',
    content: 'Review the new session picker implementation',
    timestamp: '2026-03-31T11:00:00.000Z',
  })
  await newerStore.pushMessage({
    id: 'newer-assistant',
    role: 'assistant',
    content: 'I found two edge cases in the filter handling.',
    timestamp: '2026-03-31T11:01:00.000Z',
  })

  const sessions = await listConversationSessions(tempRoot)

  expect(sessions).toHaveLength(2)
  expect(sessions[0]?.conversationId).toBe('newer-session')
  expect(sessions[0]?.title).toContain('Review the new session picker implementation')
  expect(sessions[0]?.preview).toContain('I found two edge cases')
  expect(sessions[1]?.conversationId).toBe('older-session')
})
