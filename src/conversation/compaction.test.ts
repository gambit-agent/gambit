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

  it('does not compact many messages when tokens are under the budget', () => {
    // Far more than keepRecentCount * 2 visible messages, but tiny token usage.
    const messages = Array.from({ length: 120 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant', `short ${i}`),
    )

    const result = compactMessages(messages)
    expect(result.compacted).toBe(false)
    expect(result.messages).toEqual(messages)
  })

  it('never splits an assistant tool-call from its tool results', () => {
    const messages: ConversationMessage[] = []
    for (let i = 0; i < 20; i++) {
      messages.push(makeMessage('user', `Task ${i}: ${'x'.repeat(2000)}`))
      messages.push(makeMessage('assistant', `Working on it ${'y'.repeat(2000)}`))
      messages.push(
        makeMessage('tool', 'tool output', {
          metadata: { toolCallId: `tc-${i}`, toolName: 'bash', toolStatus: 'completed' },
        }),
      )
      messages.push(makeMessage('assistant', `Done with task ${i}`))
    }

    // keepRecentCount chosen so the naive split lands mid tool-group.
    for (const keepRecentCount of [2, 3, 5, 6, 7]) {
      const result = compactMessages(messages, { maxTokens: 10_000, keepRecentCount })
      expect(result.compacted).toBe(true)
      const recent = result.messages.filter((m) => !m.hidden)
      // The kept window always starts at a user-message boundary, so a tool
      // message can never appear before its owning assistant message.
      expect(recent[0]?.role).toBe('user')
    }
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

  it('emits the summary as a hidden user-role message, not a system message', () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(3000)),
    )

    const result = compactMessages(messages, { maxTokens: 10000, keepRecentCount: 10 })
    expect(result.compacted).toBe(true)

    const summaryMsg = result.messages.find((m) => m.metadata?.compactionSummary)
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.role).toBe('user')
    expect(summaryMsg!.hidden).toBe(true)
  })

  it('folds prior compaction summaries into the new one instead of keeping them', () => {
    const priorSummary = makeMessage(
      'user',
      '[Context compaction] The following is a summary of the earlier conversation:\n\nUser: asked about widgets\n\n--- End of summary. The recent messages follow verbatim. ---',
      { hidden: true, metadata: { compactionSummary: true } },
    )
    const messages = [
      priorSummary,
      ...Array.from({ length: 60 }, (_, i) =>
        makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(3000)),
      ),
    ]

    const result = compactMessages(messages, { maxTokens: 10000, keepRecentCount: 10 })
    expect(result.compacted).toBe(true)

    const summaries = result.messages.filter((m) => m.metadata?.compactionSummary)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.id).not.toBe(priorSummary.id)
    expect(summaries[0]!.content).toContain('asked about widgets')
  })

  it('compacts a single-user-message agentic session over the token budget', () => {
    // One user request at index 0, then a long assistant/tool loop: there is
    // no user boundary to walk back to, but compaction must still happen.
    const messages: ConversationMessage[] = [makeMessage('user', 'do the big task')]
    for (let i = 0; i < 30; i++) {
      messages.push(makeMessage('assistant', `Step ${i}: ${'y'.repeat(2000)}`))
      messages.push(
        makeMessage('tool', 'tool output '.repeat(50), {
          metadata: { toolCallId: `tc-${i}`, toolName: 'bash', toolStatus: 'completed' },
        }),
      )
    }

    const result = compactMessages(messages, { maxTokens: 10_000, keepRecentCount: 10 })
    expect(result.compacted).toBe(true)
    expect(result.summarizedCount).toBeGreaterThan(0)
    expect(result.compactedTokens).toBeLessThan(result.originalTokens)
  })

  it('never starts the kept window on a tool message in the single-user fallback', () => {
    const messages: ConversationMessage[] = [makeMessage('user', 'do the big task')]
    for (let i = 0; i < 30; i++) {
      messages.push(makeMessage('assistant', `Step ${i}: ${'y'.repeat(2000)}`))
      messages.push(
        makeMessage('tool', 'first tool output', {
          metadata: { toolCallId: `tc-${i}-a`, toolName: 'bash', toolStatus: 'completed' },
        }),
      )
      messages.push(
        makeMessage('tool', 'second tool output', {
          metadata: { toolCallId: `tc-${i}-b`, toolName: 'bash', toolStatus: 'completed' },
        }),
      )
    }

    // Sweep keepRecentCount so the naive target lands on every position of the
    // assistant/tool/tool group at least once.
    for (let keepRecentCount = 2; keepRecentCount <= 10; keepRecentCount++) {
      const result = compactMessages(messages, { maxTokens: 10_000, keepRecentCount })
      expect(result.compacted).toBe(true)
      const recent = result.messages.filter((m) => !m.hidden)
      // Splitting before a tool message would sever it from the assistant
      // message that owns the tool call.
      expect(recent[0]?.role).not.toBe('tool')
    }
  })

  it('keeps the new summary when prior summaries already saturate the budget', () => {
    const maxSummaryTokens = 100 // 400 chars
    const priorBody = 'OLDEST-SUMMARY-START ' + 'o'.repeat(400)
    const priorSummary = makeMessage(
      'user',
      `[Context compaction] The following is a summary of the earlier conversation:\n\n${priorBody}\n\n--- End of summary. The recent messages follow verbatim. ---`,
      { hidden: true, metadata: { compactionSummary: true } },
    )
    const messages = [
      priorSummary,
      makeMessage('user', 'NEEDLE_NEW_SUMMARY please handle this'),
      makeMessage('assistant', `working on NEEDLE_NEW_SUMMARY ${'x'.repeat(3000)}`),
      ...Array.from({ length: 60 }, (_, i) =>
        makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(3000)),
      ),
    ]

    const result = compactMessages(messages, { maxTokens: 10_000, keepRecentCount: 10, maxSummaryTokens })
    expect(result.compacted).toBe(true)

    const summaryMsg = result.messages.find((m) => m.metadata?.compactionSummary)
    expect(summaryMsg).toBeDefined()
    // The NEW summary content survives; the OLDEST prior text is what drops.
    expect(summaryMsg!.content).toContain('NEEDLE_NEW_SUMMARY')
    expect(summaryMsg!.content).not.toContain('OLDEST-SUMMARY-START')
  })

  it('keeps only the most recent hidden memory-context injection', () => {
    const oldMemory = makeMessage('user', 'memory: old fact', {
      hidden: true,
      metadata: { memoryContext: true },
    })
    const newMemory = makeMessage('user', 'memory: new fact', {
      hidden: true,
      metadata: { memoryContext: true },
    })
    const otherHidden = makeMessage('system', 'goal context', { hidden: true })
    const messages = [
      oldMemory,
      otherHidden,
      newMemory,
      ...Array.from({ length: 60 }, (_, i) =>
        makeMessage(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(3000)),
      ),
    ]

    const result = compactMessages(messages, { maxTokens: 10000, keepRecentCount: 10 })
    expect(result.compacted).toBe(true)
    expect(result.messages.some((m) => m.id === oldMemory.id)).toBe(false)
    expect(result.messages.some((m) => m.id === newMemory.id)).toBe(true)
    expect(result.messages.some((m) => m.id === otherHidden.id)).toBe(true)
  })
})
