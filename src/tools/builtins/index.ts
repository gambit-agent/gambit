import { loadSlashCommands } from '../../lib/slashCommands'
import { loadSkills } from '../../lib/skills'
import type { AnyToolDefinition } from '../tool-types'
import { discoverMCPTools, mcpManagementTools } from '../mcp'
import { enterPlanModeTool, exitPlanModeTool } from '../plan-mode'
import { askUserQuestionTool } from '../ask-user-question'
import { createAgentTools } from './agent-tools'
import { createCommandTools } from './command-tools'
import { createFileTools } from './file-tools'
import { createMemoryTool } from './memory-tool'
import { createActivateSkillTool } from './skill-tool'
import { createTaskTools } from './task-tools'
import { createWorkflowTool } from './workflow-tool'

export interface CreateBuiltInToolDefinitionOptions {
  includeSpawnAgent?: boolean
  includeMCPTools?: boolean
  discoverMCPServerTools?: boolean
}

export async function createBuiltInToolDefinitions(
  options: CreateBuiltInToolDefinitionOptions = {},
): Promise<AnyToolDefinition[]> {
  const [cachedSlashCommands, cachedSkills] = await Promise.all([loadSlashCommands(), loadSkills()])

  const tools: AnyToolDefinition[] = [
    ...createFileTools(),
    ...createCommandTools(cachedSlashCommands),
    ...createTaskTools(),
    ...createWorkflowTool(),
    createMemoryTool(),
    enterPlanModeTool,
    exitPlanModeTool,
    askUserQuestionTool,
  ]

  const activateSkillTool = createActivateSkillTool(cachedSkills)
  if (activateSkillTool) {
    tools.push(activateSkillTool)
  }

  if (options.includeMCPTools !== false) {
    tools.push(...mcpManagementTools)

    if (options.discoverMCPServerTools) {
      try {
        const discovered = await discoverMCPTools()
        tools.push(...discovered)
      } catch (error) {
        console.warn('Failed to discover MCP tools:', error)
      }
    }
  }

  if (options.includeSpawnAgent !== false) {
    tools.push(...createAgentTools())
  }

  return tools
}
