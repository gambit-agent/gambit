import { expect, test } from 'bun:test'

import {
  buildGoalRunPrompt,
  buildGoalSystemPrompt,
  clearConversationGoal,
  createGoalMessage,
  getConversationGoal,
  isClearGoalArgument,
  parseGoalCommand,
  setConversationGoal,
} from './goal'
import type { ConversationMessage } from './conversation-types'

const userMessage: ConversationMessage = {
  id: 'user-1',
  role: 'user',
  content: 'hello',
  timestamp: '2026-01-01T00:00:00.000Z',
}

test('creates a hidden system message for the active goal', () => {
  const message = createGoalMessage(' ship the resume picker ')

  expect(message.id).toStartWith('goal-')
  expect(message.role).toBe('system')
  expect(message.hidden).toBe(true)
  expect(message.content).toContain('Current conversation goal:\nship the resume picker')
})

test('sets and replaces the conversation goal', () => {
  const withGoal = setConversationGoal([userMessage], 'first goal')
  const replaced = setConversationGoal(withGoal, 'second goal')

  expect(replaced).toHaveLength(2)
  expect(replaced[0]).toBe(userMessage)
  expect(getConversationGoal(replaced)).toBe('second goal')
})

test('builds system prompt content from the active goal', () => {
  const messages = setConversationGoal([userMessage], 'complete /goal support')

  expect(buildGoalSystemPrompt(messages)).toContain('Current conversation goal:\ncomplete /goal support')
})

test('clears the conversation goal without removing other messages', () => {
  const withGoal = setConversationGoal([userMessage], 'finish docs')
  const cleared = clearConversationGoal(withGoal)

  expect(cleared).toEqual([userMessage])
  expect(getConversationGoal(cleared)).toBeNull()
})

test('detects clear goal aliases', () => {
  expect(isClearGoalArgument('clear')).toBe(true)
  expect(isClearGoalArgument(' reset ')).toBe(true)
  expect(isClearGoalArgument('ship it')).toBe(false)
})

test('parses goal commands with run as the default action', () => {
  expect(parseGoalCommand('')).toEqual({ action: 'show' })
  expect(parseGoalCommand('clear')).toEqual({ action: 'clear' })
  expect(parseGoalCommand('set ship the feature')).toEqual({ action: 'set', goal: 'ship the feature' })
  expect(parseGoalCommand('run')).toEqual({ action: 'run', goal: null })
  expect(parseGoalCommand('run ship the feature')).toEqual({ action: 'run', goal: 'ship the feature' })
  expect(parseGoalCommand('ship the feature')).toEqual({ action: 'run', goal: 'ship the feature' })
})

test('builds an autonomous run prompt', () => {
  const prompt = buildGoalRunPrompt(' ship the feature ')

  expect(prompt).toContain('Goal: ship the feature')
  expect(prompt).toContain('Work autonomously until this goal is fully met')
})
