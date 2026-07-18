import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { forkConversation, readConversationMeta, buildConversationTree } from './conversation-fork'
import { writeJsonlEntries } from './jsonl'
import type { ConversationMessage } from '../conversation/conversation-types'

function makeMessage(id: string, role: 'user' | 'assistant', content: string): ConversationMessage & { kind: string } {
  return {
    kind: 'message',
    id,
    role,
    content,
    timestamp: new Date().toISOString(),
  }
}

describe('forkConversation', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'gambit-fork-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('forks all messages by default', async () => {
    const sourceId = 'source-id-1234'
    const dir = path.join(tmpRoot, '.gambit', 'conversations', sourceId)
    await mkdir(dir, { recursive: true })

    const messages = [
      makeMessage('m1', 'user', 'Hello'),
      makeMessage('m2', 'assistant', 'Hi there'),
      makeMessage('m3', 'user', 'How are you?'),
      makeMessage('m4', 'assistant', 'Good, thanks!'),
    ]

    await writeJsonlEntries(path.join(dir, 'transcript.jsonl'), messages)

    const result = await forkConversation(sourceId, { root: tmpRoot })
    expect(result.messageCount).toBe(4)
    expect(result.conversationId).not.toBe(sourceId)

    const meta = await readConversationMeta(result.conversationId, tmpRoot)
    expect(meta).not.toBeNull()
    expect(meta!.forkedFrom).toBe(sourceId)
  })

  it('forks at a specific message', async () => {
    const sourceId = 'source-id-5678'
    const dir = path.join(tmpRoot, '.gambit', 'conversations', sourceId)
    await mkdir(dir, { recursive: true })

    const messages = [
      makeMessage('m1', 'user', 'Hello'),
      makeMessage('m2', 'assistant', 'Hi'),
      makeMessage('m3', 'user', 'Bye'),
      makeMessage('m4', 'assistant', 'Goodbye'),
    ]

    await writeJsonlEntries(path.join(dir, 'transcript.jsonl'), messages)

    const result = await forkConversation(sourceId, { atMessageId: 'm2', root: tmpRoot })
    expect(result.messageCount).toBe(2)
  })

  it('throws for unknown message id', async () => {
    const sourceId = 'source-id-bad'
    const dir = path.join(tmpRoot, '.gambit', 'conversations', sourceId)
    await mkdir(dir, { recursive: true })

    await writeJsonlEntries(path.join(dir, 'transcript.jsonl'), [
      makeMessage('m1', 'user', 'Hello'),
    ])

    expect(forkConversation(sourceId, { atMessageId: 'nonexistent', root: tmpRoot })).rejects.toThrow(
      'not found',
    )
  })
})

describe('buildConversationTree', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'gambit-tree-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('returns message for empty directory', async () => {
    const tree = await buildConversationTree(tmpRoot)
    expect(tree).toBe('No conversations found.')
  })

  it('renders a tree with forks', async () => {
    // Create parent conversation
    const parentId = 'parent-0001'
    const parentDir = path.join(tmpRoot, '.gambit', 'conversations', parentId)
    await mkdir(parentDir, { recursive: true })
    await writeJsonlEntries(path.join(parentDir, 'transcript.jsonl'), [
      makeMessage('m1', 'user', 'Start'),
      makeMessage('m2', 'assistant', 'Hello'),
    ])

    // Fork from parent
    const result = await forkConversation(parentId, { root: tmpRoot })

    const tree = await buildConversationTree(tmpRoot)
    expect(tree).toContain(parentId.slice(0, 8))
    expect(tree).toContain(result.conversationId.slice(0, 8))
  })
})
