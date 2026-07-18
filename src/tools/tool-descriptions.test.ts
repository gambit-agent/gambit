import { expect, test } from 'bun:test'

import { DEFAULT_AGENT_DEFINITIONS } from '../agents/agent-definitions'
import { createAiToolMap, createRuntimeToolSuite } from './index'
import { askUserQuestionTool } from './ask-user-question'
import { mcpManagementTools } from './mcp'
import { enterPlanModeTool, exitPlanModeTool } from './plan-mode'
import { createAgentTools } from './builtins/agent-tools'
import { createCommandTools } from './builtins/command-tools'
import { createFileTools } from './builtins/file-tools'
import { createMemoryTool } from './builtins/memory-tool'
import { createTaskTools } from './builtins/task-tools'
import { createWorkflowTool } from './builtins/workflow-tool'
import type { AnyToolDefinition } from './tool-types'

function catalog(): Map<string, AnyToolDefinition> {
  return new Map(
    [
      ...createFileTools(),
      ...createCommandTools([]),
      ...createTaskTools(),
      ...createWorkflowTool(),
      createMemoryTool(),
      enterPlanModeTool,
      exitPlanModeTool,
      askUserQuestionTool,
      ...mcpManagementTools,
      ...createAgentTools(),
    ].map((tool) => [tool.id, tool]),
  )
}

function description(tools: Map<string, AnyToolDefinition>, id: string): string {
  const tool = tools.get(id)
  if (!tool) {
    throw new Error(`Missing tool: ${id}`)
  }
  return tool.description
}

test('core tool descriptions document behavior-shaping constraints', () => {
  const tools = catalog()

  expect(description(tools, 'read')).toContain('offset')
  expect(description(tools, 'readFile')).toContain('Compatibility alias')
  expect(description(tools, 'glob')).toContain('glob pattern')
  expect(description(tools, 'grep')).toContain('regex pattern')
  expect(description(tools, 'searchFiles')).toContain('Compatibility alias')
  expect(description(tools, 'edit')).toContain('oldString')
  expect(description(tools, 'editFile')).toContain('Compatibility alias')
  expect(description(tools, 'write')).toContain('complete content')
  expect(description(tools, 'writeFile')).toContain('Compatibility alias')
  expect(description(tools, 'patchFile')).toContain('multi-file')
  expect(description(tools, 'patchFile')).toContain('apply_patch')
  expect(description(tools, 'bash')).toContain('terminal commands')
  expect(description(tools, 'executeShell')).toContain('Compatibility alias')
  expect(description(tools, 'spawnAgent')).toContain('task_id')
  expect(description(tools, 'runAgents')).toContain('concurrently')
  expect(description(tools, 'workflow')).toContain("isolation: 'worktree' is advisory")
  expect(description(tools, 'writeMemory')).toContain('non-derivable')
  expect(description(tools, 'askUserQuestion')).toContain('Ask only when')
  expect(description(tools, 'enterPlanMode')).toContain('write only')
  expect(description(tools, 'exitPlanMode')).toContain('user approval')
})

test('legacy aliases are registered but hidden from the default model tool map', async () => {
  const { registry, executor } = await createRuntimeToolSuite({
    includeMCPTools: false,
    includeSpawnAgent: false,
  })
  const tools = createAiToolMap(registry, executor)

  expect(registry.get('readFile')).toBeTruthy()
  expect(registry.get('executeShell')).toBeTruthy()
  expect(Object.keys(tools)).toContain('read')
  expect(Object.keys(tools)).toContain('bash')
  expect(Object.keys(tools)).not.toContain('readFile')
  expect(Object.keys(tools)).not.toContain('executeShell')
})

test('mcp tool descriptions distinguish discovery, resources, and fallback calls', () => {
  const tools = catalog()

  expect(description(tools, 'list-mcp-servers')).toContain('server name is unknown')
  expect(description(tools, 'list-mcp-resources')).toContain('mcp://')
  expect(description(tools, 'read-mcp-resource')).toContain('list-mcp-resources')
  expect(description(tools, 'list-mcp-tools')).toContain('input schemas')
  expect(description(tools, 'call-mcp-tool')).toContain('Fallback generic caller')
  expect(description(tools, 'call-mcp-tool')).toContain('auto-discovered')
  expect(description(tools, 'add-mcp-server')).toContain('stdio requires command')
})

test('agent role descriptions reflect intended tool scope', () => {
  expect(DEFAULT_AGENT_DEFINITIONS.default.description).toContain('broad default tool set')
  expect(DEFAULT_AGENT_DEFINITIONS.explorer.description).toContain('Read-only')
  expect(DEFAULT_AGENT_DEFINITIONS.worker.description).toContain('edits')
  expect(DEFAULT_AGENT_DEFINITIONS.worker.description).toContain('shell')
})
