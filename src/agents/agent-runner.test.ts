import { expect, test } from 'bun:test'

import { agentToolIds } from './agent-tool-policy'
import { DEFAULT_AGENT_DEFINITIONS } from './agent-definitions'
import { AgentRunner } from './agent-runner'

test('default delegated agent uses the scoped child-agent tool policy', async () => {
  const runner = new AgentRunner()
  let capturedAllowedToolIds: readonly string[] | undefined

  await expect(
    runner.run({
      definition: DEFAULT_AGENT_DEFINITIONS.default,
      prompt: 'inspect',
      apiKey: 'test-key',
      modelId: 'test-model',
      baseSystemPrompt: 'base',
      createTools: async (allowedToolIds) => {
        capturedAllowedToolIds = allowedToolIds
        throw new Error('stop before model stream')
      },
      appendTranscript: async () => {},
      updateProgress: async () => {},
    }),
  ).rejects.toThrow('stop before model stream')

  expect(capturedAllowedToolIds).toEqual([...agentToolIds])
})

test('explorer delegated agent cannot spawn higher-privilege child agents', () => {
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.allowedToolIds).not.toContain('spawnAgent')
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.allowedToolIds).not.toContain('runAgents')
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.allowedToolIds).not.toContain('workflow')
})

test('transcript captures the full accumulated reasoning, not just the first delta', async () => {
  const runner = new AgentRunner()
  const transcript: Array<{ type?: string; content?: string }> = []

  const result = await runner.run({
    definition: DEFAULT_AGENT_DEFINITIONS.default,
    prompt: 'inspect',
    apiKey: 'test-key',
    modelId: 'test-model',
    baseSystemPrompt: 'base',
    createTools: async () => ({}),
    appendTranscript: async (entry) => {
      transcript.push(entry as { type?: string; content?: string })
    },
    updateProgress: async () => {},
    streamRunner: {
      run: async (options) => {
        await options.handlers?.onReasoningDelta?.('first thought, ', { type: 'reasoning-delta' })
        await options.handlers?.onReasoningDelta?.('second thought', { type: 'reasoning-delta' })
        await options.handlers?.onToolCall?.({
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'readFile',
          input: { path: 'a.txt' },
        })
        await options.handlers?.onToolResult?.({
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'readFile',
          input: { path: 'a.txt' },
          output: 'contents',
        })
        await options.handlers?.onReasoningDelta?.('third thought after the tool', { type: 'reasoning-delta' })
        await options.handlers?.onTextDelta?.('final answer', { type: 'text-delta' })
        return {
          text: 'final answer',
          streamedText: 'final answer',
          reasoning: 'first thought, second thoughtthird thought after the tool',
          aborted: false,
          finishReason: 'stop',
          stepCount: 2,
        }
      },
    },
  })

  const reasoningEntries = transcript.filter((entry) => entry.type === 'reasoning')
  // Flushed at the tool-call boundary and again at the end of the run.
  expect(reasoningEntries).toHaveLength(2)
  expect(reasoningEntries[0]?.content).toBe('first thought, second thought')
  expect(reasoningEntries[1]?.content).toBe('third thought after the tool')
  expect(result.output).toContain('final answer')
})

test('marks in-flight tool calls as cancelled in the transcript when the run aborts', async () => {
  const runner = new AgentRunner()
  const transcript: Array<{ type?: string; toolCallId?: string; toolName?: string }> = []

  await runner.run({
    definition: DEFAULT_AGENT_DEFINITIONS.default,
    prompt: 'inspect',
    apiKey: 'test-key',
    modelId: 'test-model',
    baseSystemPrompt: 'base',
    createTools: async () => ({}),
    appendTranscript: async (entry) => {
      transcript.push(entry as { type?: string; toolCallId?: string; toolName?: string })
    },
    updateProgress: async () => {},
    streamRunner: {
      run: async (options) => {
        // First tool completes; the second is still in flight when the user aborts.
        await options.handlers?.onToolCall?.({
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'readFile',
          input: { path: 'a.txt' },
        })
        await options.handlers?.onToolResult?.({
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'readFile',
          input: { path: 'a.txt' },
          output: 'contents',
        })
        await options.handlers?.onToolCall?.({
          type: 'tool-call',
          toolCallId: 'tc-2',
          toolName: 'executeShell',
          input: { command: 'sleep 100' },
        })
        return {
          text: '',
          streamedText: '',
          reasoning: '',
          aborted: true,
          finishReason: 'stop',
          stepCount: 1,
        }
      },
    },
  })

  const cancelledEntries = transcript.filter((entry) => entry.type === 'tool-cancelled')
  expect(cancelledEntries).toHaveLength(1)
  expect(cancelledEntries[0]).toMatchObject({ toolCallId: 'tc-2', toolName: 'executeShell' })

  // The completed tool call must not be marked cancelled.
  expect(cancelledEntries.some((entry) => entry.toolCallId === 'tc-1')).toBe(false)
})
