import type { AgentDefinition } from './agent-types'
import { agentToolIds } from './agent-tool-policy'

export const DEFAULT_AGENT_DEFINITIONS: Record<'default' | 'explorer' | 'worker', AgentDefinition> = {
  default: {
    id: 'default',
    role: 'default',
    description: 'General-purpose delegated agent with the broad default tool set.',
    allowedToolIds: agentToolIds,
  },
  explorer: {
    id: 'explorer',
    role: 'explorer',
    description: 'Read-only delegated agent for searching and summarizing workspace context.',
    allowedToolIds: [
      'read',
      'glob',
      'grep',
      'slashCommand',
      'readTaskOutput',
      'listTasks',
      'getTaskStatus',
      'waitForTasks',
    ],
  },
  worker: {
    id: 'worker',
    role: 'worker',
    description: 'Delegated agent for constrained edits, shell work, and implementation checks.',
    allowedToolIds: [
      'read',
      'glob',
      'grep',
      'edit',
      'write',
      'patchFile',
      'bash',
      'slashCommand',
      'readTaskOutput',
      'listTasks',
      'getTaskStatus',
      'waitForTasks',
      'cancelTask',
      'spawnAgent',
      'runAgents',
    ],
  },
}
