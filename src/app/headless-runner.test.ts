import { expect, test } from 'bun:test'

import type { ConversationMessage } from '../conversation/conversation-types'
import { getConversationGoal } from '../conversation/goal'
import { prepareHeadlessInput, resolveHeadlessTurnOutcome } from './headless-runner'

function createRuntimeStub(initialMessages: ConversationMessage[] = []) {
  let messages = [...initialMessages]
  const emitted: unknown[] = []

  return {
    emitted,
    runtime: {
      conversationStore: {
        getSnapshot: () => ({
          conversationId: 'session-1',
          messages,
        }),
        pushMessage: async (message: ConversationMessage) => {
          messages = [...messages, message]
        },
        replaceMessages: async (nextMessages: ConversationMessage[]) => {
          messages = [...nextMessages]
        },
      },
      conversationRunner: {
        compact: async () => ({ compacted: false, summarizedCount: 0 }),
      },
      runShellCommand: async (command: string) => ({
        taskId: 'task-1',
        output: `ran: ${command}`,
      }),
      saveMemoryEntry: async (content: string) => `Saved memory: ${content}`,
      resetConversation: async () => 'session-2',
      forkConversation: async () => ({ conversationId: 'forked-session', messageCount: messages.length }),
      getConversationTree: async () => 'session-1',
      hookManager: {
        runCommandBefore: async ({ content }: { content: string }) => content,
        emit: async (event: unknown) => {
          emitted.push(event)
        },
      },
    } as any,
  }
}

test('prepareHeadlessInput expands workflow slash commands into workflow prompts', async () => {
  const { runtime } = createRuntimeStub()
  const result = await prepareHeadlessInput(runtime, '/workflow audit the parser')

  expect(result.kind).toBe('run')
  expect(result.kind === 'run' ? result.prompt : '').toContain('Workflow task: audit the parser')
  expect(result.kind === 'run' ? result.prompt : '').toContain('using the workflow tool')
})

test('prepareHeadlessInput manages conversation goals before model runs', async () => {
  const { runtime } = createRuntimeStub()
  const saved = await prepareHeadlessInput(runtime, '/goal set ship headless parity')

  expect(saved).toEqual({ kind: 'local', output: 'Goal saved: ship headless parity' })
  expect(getConversationGoal(runtime.conversationStore.getSnapshot().messages)).toBe('ship headless parity')

  const run = await prepareHeadlessInput(runtime, '/goal run')
  expect(run.kind).toBe('run')
  expect(run.kind === 'run' ? run.prompt : '').toContain('Goal: ship headless parity')
})

test('prepareHeadlessInput keeps shell and memory shortcuts local', async () => {
  const { runtime } = createRuntimeStub()

  const shell = await prepareHeadlessInput(runtime, '!echo hi')
  expect(shell).toEqual({ kind: 'local', output: 'ran: echo hi' })

  const memory = await prepareHeadlessInput(runtime, '# remember this')
  expect(memory).toEqual({ kind: 'local', output: 'Saved memory: remember this' })

  const messages = runtime.conversationStore.getSnapshot().messages
  expect(messages.map((message: ConversationMessage) => message.role)).toEqual(['user', 'assistant', 'user', 'system'])
})

test('resolveHeadlessTurnOutcome surfaces an interrupted turn as an error with exit code 130', () => {
  // A SIGINT/SIGTERM abort returns normally from runTurn with interrupted set;
  // headless must not report the truncated answer as a clean success.
  const outcome = resolveHeadlessTurnOutcome({ assistantOutput: 'partial answer', interrupted: true })

  expect(outcome.finalAssistant).toBe('partial answer')
  expect(outcome.errorMessage).toBe('interrupted')
  expect(outcome.exitCode).toBe(130)
  // The result events for both json and stream-json derive is_error from the
  // error message.
  expect(Boolean(outcome.errorMessage)).toBe(true)
})

test('resolveHeadlessTurnOutcome reports completed turns as success', () => {
  const outcome = resolveHeadlessTurnOutcome({ assistantOutput: 'full answer' })

  expect(outcome).toEqual({ finalAssistant: 'full answer', exitCode: 0 })
})
