import { describe, expect, it } from 'bun:test'

import { compactMessages, estimateContextTokens, shouldAutoCompact } from './compaction'
import type { ConversationMessage } from './conversation-types'

function makeMessage(
  role: 'user' | 'assistant' | 'tool' | 'system',
  content: string,
  options: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    ...options,
  }
}

describe('estimateContextTokens', () => {
  it('estimates tokens from content length', () => {
    const messages = [makeMessage('user', 'a'.repeat(400))]
    expect(estimateContextTokens(messages)).toBe(100)
  })

  it('includes tool metadata in estimate', () => {
    const msg = makeMessage('tool', 'result', {
      metadata: {
        toolCallId: 'tc1',
        toolName: 'readFile',
        toolArgs: { path: 'foo.ts' },
        toolResult: 'file content here',
        toolStatus: 'completed',
      },
    })
    const tokens = estimateContextTokens([msg])
    expect(tokens).toBeGreaterThan(estimateContextTokens([makeMessage('tool', 'result')]))
  })
})

describe('shouldAutoCompact', () => {
  it('returns false for small conversations', () => {
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'hi')]
    expect(shouldAutoCompact(messages)).toBe(false)
  })

  it('returns true when over token limit', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(4000)),
    )
    expect(shouldAutoCompact(messages)).toBe(true)
  })
})

describe('compactMessages', () => {
  it('does not compact small conversations', () => {
    const messages = [makeMessage('user', 'hello'), makeMessage('assistant', 'hi')]
    const result = compactMessages(messages)
    expect(result.compacted).toBe(false)
    expect(result.messages).toEqual(messages)
  })

  it('compacts large conversations keeping recent messages', () => {
    const messages: ConversationMessage[] = []
    for (let i = 0; i < 50; i++) {
      messages.push(makeMessage('user', `Question ${i}: ${'x'.repeat(2000)}`))
      messages.push(makeMessage('assistant', `Answer ${i}: ${'y'.repeat(2000)}`))
    }

    const result = compactMessages(messages, { maxTokens: 10000, keepRecentCount: 10 })
    expect(result.compacted).toBe(true)
    expect(result.summarizedCount).toBeGreaterThan(0)
    expect(result.compactedTokens).toBeLessThan(result.originalTokens)

    // Should have: hidden system messages + compaction summary + 10 recent visible
    const visibleRecent = result.messages.filter((m) => !m.hidden)
    expect(visibleRecent.length).toBe(10)
  })

  it('preserves hidden system messages', () => {
    const hidden = makeMessage('system', 'system prompt', { hidden: true })
    const messages = [
      hidden,
      ...Array.from({ length: 60 }, (_, i) =>
        makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(3000)),
      ),
    ]

    const result = compactMessages(messages, { maxTokens: 10000, keepRecentCount: 10 })
    expect(result.compacted).toBe(true)
    // The original hidden message should still be there
    expect(result.messages.some((m) => m.id === hidden.id)).toBe(true)
  })

  it('includes tool names in summary', () => {
    const messages: ConversationMessage[] = [
      makeMessage('user', 'Read file foo.ts'),
      makeMessage('tool', 'file contents', {
        metadata: { toolCallId: 'tc1', toolName: 'readFile', toolStatus: 'completed' },
      }),
      makeMessage('assistant', 'Here is the file content'),
      ...Array.from({ length: 50 }, (_, i) =>
        makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(3000)),
      ),
    ]

    const result = compactMessages(messages, { maxTokens: 10000, keepRecentCount: 5 })
    expect(result.compacted).toBe(true)

    const summaryMsg = result.messages.find((m) => m.id.startsWith('compaction-'))
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.content).toContain('readFile')
  })
})
