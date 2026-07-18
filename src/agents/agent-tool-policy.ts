/** Tool IDs available to child agents when an agent definition does not narrow access further. */
export const agentToolIds = [
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
  'workflow',
  'writeMemory',
  'askUserQuestion',
] as const

export type AgentToolId = (typeof agentToolIds)[number]
