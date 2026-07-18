import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { SessionNotification } from '@agentclientprotocol/sdk'

import { createConversationStore } from '../conversation/conversation-store'
import { AcpTurnBridge } from './turn-bridge'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AcpTurnBridge', () => {
  test('streams assistant deltas and tool lifecycle updates in order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gambit-acp-bridge-'))
    tempRoots.push(root)
    const store = createConversationStore({ rootPath: root })
    await store.initialize()
    const notifications: SessionNotification[] = []
    const bridge = new AcpTurnBridge(store, 'session-1', root, async (notification) => {
      notifications.push(notification)
    })
    bridge.start()

    await store.pushMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    }, { persist: false })
    store.updateMessage('assistant-1', { content: 'Hello world' })
    await store.pushMessage({
      id: 'tool-1',
      role: 'tool',
      content: 'Running',
      timestamp: new Date().toISOString(),
      metadata: {
        toolCallId: 'tool-1',
        toolName: 'readFile',
        toolArgs: { path: 'README.md' },
        toolStatus: 'started',
      },
    }, { persist: false })
    store.updateMessage('tool-1', {
      content: 'Read README.md',
      metadata: {
        toolCallId: 'tool-1',
        toolName: 'readFile',
        toolArgs: { path: 'README.md' },
        toolResult: 'contents',
        toolStatus: 'completed',
      },
    })

    await bridge.flush()
    bridge.stop()

    expect(notifications.map((notification) => notification.update.sessionUpdate)).toEqual([
      'agent_message_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ])
    expect(notifications[0]?.update).toMatchObject({
      content: { type: 'text', text: 'Hello' },
    })
    expect(notifications[1]?.update).toMatchObject({
      content: { type: 'text', text: ' world' },
    })
    expect(notifications[2]?.update).toMatchObject({
      toolCallId: 'tool-1',
      kind: 'read',
      status: 'in_progress',
    })
    expect(notifications[3]?.update).toMatchObject({
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: 'contents',
    })
  })
})
