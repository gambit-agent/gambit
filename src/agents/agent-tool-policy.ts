/** Tool IDs available to child agents when an agent definition does not narrow access further. */
export const agentToolIds = [
  'readFile',
  'searchFiles',
  'writeFile',
  'patchFile',
  'executeShell',
  'slashCommand',
  'readTaskOutput',
  'listTasks',
  'getTaskStatus',
  'waitForTasks',
  'cancelTask',
  'spawnAgent',
  'runAgents',
  'writeMemory',
  'askUserQuestion',
] as const

export type AgentToolId = (typeof agentToolIds)[number]
