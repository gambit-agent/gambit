import type { AgentDefinition } from './agent-types'

export const DEFAULT_AGENT_DEFINITIONS: Record<'default' | 'explorer' | 'worker', AgentDefinition> = {
  default: {
    id: 'default',
    role: 'default',
    description: 'General-purpose local delegated agent.',
  },
  explorer: {
    id: 'explorer',
    role: 'explorer',
    description: 'Search and summarize workspace context.',
    allowedToolIds: ['readFile', 'slashCommand'],
  },
  worker: {
    id: 'worker',
    role: 'worker',
    description: 'Carry out constrained edits or shell work.',
    allowedToolIds: ['readFile', 'writeFile', 'patchFile', 'executeShell', 'slashCommand'],
  },
}
