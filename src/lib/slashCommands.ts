export {
  loadSlashCommands,
  setSlashCommandDirectoriesForTesting,
} from './slash-command/loader'
export { executeSlashCommand } from './slash-command/executor'
export { buildSlashCommandToolDescription } from './slash-command/descriptor'
export type {
  SlashCommandDefinition,
  SlashCommandExecution,
  SlashCommandScope,
} from './slash-command/types'
