import type { PermissionDecision } from './permission-types'

export type PermissionMode = 'Normal' | 'Plan' | 'Auto-accept'

export interface PermissionEvaluationInput {
  toolId: string
  subject: string
  metadata?: Record<string, unknown>
}

export function cyclePermissionMode(mode: PermissionMode): PermissionMode {
  const order: PermissionMode[] = ['Normal', 'Auto-accept', 'Plan']
  const index = order.indexOf(mode)
  return order[(index + 1) % order.length] ?? 'Normal'
}

/** Tool IDs that are always safe to run (read-only). */
const READ_ONLY_TOOLS = new Set([
  'read',
  'readFile',
  'glob',
  'globFiles',
  'grep',
  'grepFiles',
  'searchFiles',
  'readTaskOutput',
  'listTasks',
  'getTaskStatus',
  'waitForTasks',
  'slashCommand',
  'enterPlanMode',
])

/** Tool IDs that perform write or execution operations. */
const WRITE_TOOLS = new Set([
  'write',
  'writeFile',
  'edit',
  'editFile',
  'patchFile',
  'bash',
  'executeShell',
  'spawnAgent',
  'runAgents',
  'workflow',
  'cancelTask',
  'writeMemory',
])

export function evaluatePermissionMode(
  mode: PermissionMode,
  input: PermissionEvaluationInput,
): PermissionDecision {
  if (mode === 'Auto-accept') {
    return 'allow'
  }

  // Read-only tools are always allowed
  if (READ_ONLY_TOOLS.has(input.toolId)) {
    return 'allow'
  }

  if (mode === 'Plan') {
    // exitPlanMode triggers the Plan approval overlay
    if (input.toolId === 'exitPlanMode') {
      return 'ask'
    }

    // Allow writing to Plan files (detected by metadata)
    if (
      (input.toolId === 'write' || input.toolId === 'writeFile' || input.toolId === 'patchFile') &&
      input.metadata?.isPlanFileWrite
    ) {
      return 'allow'
    }

    // Block all other write/execute tools in Plan mode
    if (WRITE_TOOLS.has(input.toolId)) {
      return 'deny'
    }

    // Default: ask for unknown tools
    return 'ask'
  }

  // Normal mode: ask for write/execute tools
  return 'ask'
}
