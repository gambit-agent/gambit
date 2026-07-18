import {
  activateSkill,
  buildActivateSkillToolDescription,
  type SkillDefinition,
} from '../../lib/skills'
import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import { activateSkillSchema } from './schemas'
import { summarizeBuiltInToolCompletion } from './utils'

export function createActivateSkillTool(skills: readonly SkillDefinition[]): AnyToolDefinition | null {
  if (skills.length === 0) {
    return null
  }

  const activateSkillTool: ToolDefinition<typeof activateSkillSchema, string> = {
    id: 'activateSkill',
    displayName: 'Activate Skill',
    description: buildActivateSkillToolDescription([...skills]),
    inputSchema: activateSkillSchema,
    execute: async ({ name }) => {
      const activation = await activateSkill(name)
      return activation.content
    },
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('activateSkill', context.input, result, context.artifactPath),
  }

  return activateSkillTool
}
