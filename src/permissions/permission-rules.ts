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
  'enterPlanMode',
])

/**
 * Delegation tools Plan mode runs without prompting. Explorer subagents are the
 * main way a plan gets researched, and every tool the child calls goes through
 * this same gate, so allowing the spawn itself grants no extra reach.
 */
const DELEGATION_TOOLS = new Set(['spawnAgent', 'runAgents', 'workflow'])

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

    // Slash commands are prompt expansions, but any embedded `!` shell
    // directives execute immediately — deny those in Plan mode. Directive-free
    // commands never reach the permission gate, but keep them allowed here for
    // defense in depth.
    if (input.toolId === 'slashCommand') {
      return input.metadata?.hasShellDirectives ? 'deny' : 'allow'
    }

    // Allow writing to Plan files (detected by metadata)
    if (
      (input.toolId === 'write' || input.toolId === 'writeFile' || input.toolId === 'patchFile') &&
      input.metadata?.isPlanFileWrite
    ) {
      return 'allow'
    }

    if (DELEGATION_TOOLS.has(input.toolId)) {
      return 'allow'
    }

    // Plan mode has the full tool set: research commands, builds, and even
    // edits are available, they just stay behind the same prompt Normal mode
    // uses. Nothing is hard-denied, so the model never hits a dead end
    // mid-plan.
    return 'ask'
  }

  // Normal mode: ask for write/execute tools
  return 'ask'
}
