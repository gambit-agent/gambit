import type { PermissionDecision } from './permission-types'

export type PermissionMode = 'normal' | 'plan' | 'auto-accept'

export interface PermissionEvaluationInput {
  toolId: string
  subject: string
  metadata?: Record<string, unknown>
}

export function cyclePermissionMode(mode: PermissionMode): PermissionMode {
  const order: PermissionMode[] = ['normal', 'plan', 'auto-accept']
  const index = order.indexOf(mode)
  return order[(index + 1) % order.length] ?? 'normal'
}

export function evaluatePermissionMode(
  mode: PermissionMode,
  input: PermissionEvaluationInput,
): PermissionDecision {
  if (mode === 'auto-accept') {
    return 'allow'
  }

  if (
    input.toolId === 'readFile' ||
    input.toolId === 'readTaskOutput' ||
    input.toolId === 'slashCommand'
  ) {
    return 'allow'
  }

  if (mode === 'plan') {
    return 'ask'
  }

  return 'ask'
}
