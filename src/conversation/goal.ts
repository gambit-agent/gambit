import { generateId } from '../lib/id'

import type { ConversationMessage } from './conversation-types'

const GOAL_HEADER = 'Current conversation goal:'
const GOAL_INSTRUCTION = 'Use this as durable task context until the user changes or clears it.'

export type GoalCommand =
  | { action: 'show' }
  | { action: 'clear' }
  | { action: 'set'; goal: string }
  | { action: 'run'; goal: string | null }

export function createGoalMessage(goal: string): ConversationMessage {
  const normalizedGoal = normalizeGoal(goal)
  if (!normalizedGoal) {
    throw new Error('Goal must not be empty.')
  }

  return {
    id: `goal-${generateId()}`,
    role: 'system',
    content: `${GOAL_HEADER}\n${normalizedGoal}\n\n${GOAL_INSTRUCTION}`,
    timestamp: new Date().toISOString(),
    hidden: true,
  }
}

export function getConversationGoal(messages: readonly ConversationMessage[]): string | null {
  const goalMessage = [...messages].reverse().find(isGoalMessage)
  if (!goalMessage) {
    return null
  }

  return extractGoal(goalMessage.content)
}

export function setConversationGoal(
  messages: readonly ConversationMessage[],
  goal: string,
): ConversationMessage[] {
  const goalMessage = createGoalMessage(goal)
  return [...messages.filter((message) => !isGoalMessage(message)), goalMessage]
}

export function clearConversationGoal(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return messages.filter((message) => !isGoalMessage(message))
}

export function isClearGoalArgument(argument: string): boolean {
  return /^(clear|reset|none|off)$/i.test(argument.trim())
}

export function parseGoalCommand(argument: string): GoalCommand {
  const trimmed = argument.trim()
  if (!trimmed) {
    return { action: 'show' }
  }
  if (isClearGoalArgument(trimmed)) {
    return { action: 'clear' }
  }

  const setMatch = /^(set|save)(?:\s+(.+))?$/i.exec(trimmed)
  if (setMatch) {
    return { action: 'set', goal: setMatch[2]?.trim() || '' }
  }

  const runMatch = /^(run|start|continue)(?:\s+(.+))?$/i.exec(trimmed)
  if (runMatch) {
    return { action: 'run', goal: runMatch[2]?.trim() || null }
  }

  return { action: 'run', goal: trimmed }
}

export function buildGoalRunPrompt(goal: string): string {
  const normalizedGoal = normalizeGoal(goal)
  if (!normalizedGoal) {
    throw new Error('Goal must not be empty.')
  }

  return [
    `Goal: ${normalizedGoal}`,
    'Work autonomously until this goal is fully met. Keep going across tool calls and intermediate fixes instead of stopping at partial progress.',
    'Before finishing, verify the result when feasible. If the goal cannot be completed, stop only after clearly stating the blocker and the next action needed from the user.',
  ].join('\n\n')
}

export function isGoalMessage(message: ConversationMessage): boolean {
  return message.role === 'system' && message.hidden === true && message.content.startsWith(`${GOAL_HEADER}\n`)
}

export function buildGoalSystemPrompt(messages: readonly ConversationMessage[]): string | null {
  const goal = getConversationGoal(messages)
  if (!goal) {
    return null
  }

  return `${GOAL_HEADER}\n${goal}\n\n${GOAL_INSTRUCTION}`
}

function normalizeGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, ' ')
}

function extractGoal(content: string): string | null {
  if (!content.startsWith(`${GOAL_HEADER}\n`)) {
    return null
  }

  const body = content.slice(GOAL_HEADER.length).trimStart()
  const instructionIndex = body.indexOf(`\n\n${GOAL_INSTRUCTION}`)
  const goal = instructionIndex === -1 ? body.trim() : body.slice(0, instructionIndex).trim()
  return goal || null
}
