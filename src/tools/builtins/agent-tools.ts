import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import { runAgentsSchema, spawnAgentSchema } from './schemas'
import {
  formatAgentBatchResult,
  summarizeBuiltInToolCompletion,
} from './utils'

export function createAgentTools(): AnyToolDefinition[] {
  const runAgentsTool: ToolDefinition<typeof runAgentsSchema, string> = {
    id: 'runAgents',
    displayName: 'Run Agents',
    description:
      'Run multiple delegated agents concurrently and wait for all results. Use for parallel research, review, or implementation when every result is needed before continuing.',
    inputSchema: runAgentsSchema,
    requiredCapabilities: ['agents'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('runAgents', context.input, result, context.artifactPath),
    execute: async ({ agents }, context) => {
      if (!context.agentTaskRunner || !context.agentExecutionOptions) {
        throw new Error('Agent task runner is not configured.')
      }
      const currentDepth = context.agentExecutionOptions.delegationDepth ?? 0
      const maxDepth = context.agentExecutionOptions.maxDelegationDepth ?? 3
      if (currentDepth >= maxDepth) {
        throw new Error(`Maximum delegation depth reached (${maxDepth}).`)
      }

      const result = await context.agentTaskRunner.runBatch({
        agents: agents.map((agent) => ({
          role: agent.role,
          prompt: agent.prompt,
          title: agent.description ?? `Delegated ${agent.role} agent`,
        })),
        apiKey: context.agentExecutionOptions.apiKey,
        modelId: context.agentExecutionOptions.modelId,
        reasoningEffort: context.agentExecutionOptions.reasoningEffort,
        baseSystemPrompt: context.agentExecutionOptions.baseSystemPrompt,
        agentExecutionOptions: {
          ...context.agentExecutionOptions,
          delegationDepth: currentDepth + 1,
          maxDelegationDepth: maxDepth,
        },
        signal: context.signal,
      })

      return formatAgentBatchResult(result)
    },
    getPermissionRequest: ({ agents }) => ({
      subject: `Run ${agents.length} delegated agent${agents.length === 1 ? '' : 's'} concurrently`,
      metadata: { agents: agents.map(({ role, description }) => ({ role, description })) },
    }),
  }

  const spawnAgentTool: ToolDefinition<typeof spawnAgentSchema, string> = {
    id: 'spawnAgent',
    displayName: 'Spawn Agent',
    description:
      'Spawn one delegated agent task. Use for substantial independent work; background true returns a task_id, otherwise this waits and includes output. Prefer runAgents for several parallel agents and workflow for structured orchestration.',
    inputSchema: spawnAgentSchema,
    requiredCapabilities: ['agents'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('spawnAgent', context.input, result, context.artifactPath),
    execute: async ({ role, prompt, description, background }, context) => {
      if (!context.agentTaskRunner || !context.agentExecutionOptions) {
        throw new Error('Agent task runner is not configured.')
      }
      const currentDepth = context.agentExecutionOptions.delegationDepth ?? 0
      const maxDepth = context.agentExecutionOptions.maxDelegationDepth ?? 3
      if (currentDepth >= maxDepth) {
        throw new Error(`Maximum delegation depth reached (${maxDepth}).`)
      }

      const result = await context.agentTaskRunner.run({
        role,
        prompt,
        title: description ?? `Delegated ${role} agent`,
        background: background ?? false,
        apiKey: context.agentExecutionOptions.apiKey,
        modelId: context.agentExecutionOptions.modelId,
        reasoningEffort: context.agentExecutionOptions.reasoningEffort,
        baseSystemPrompt: context.agentExecutionOptions.baseSystemPrompt,
        agentExecutionOptions: {
          ...context.agentExecutionOptions,
          delegationDepth: currentDepth + 1,
          maxDelegationDepth: maxDepth,
        },
        signal: context.signal,
      })

      if (!result.output) {
        return `Spawned ${role} agent task ${result.task.id}.`
      }

      return `Spawned ${role} agent task ${result.task.id}.\n\n${result.output}`
    },
    getPermissionRequest: ({ role, description }) => ({
      subject: `Spawn ${role} agent${description ? `: ${description}` : ''}`,
      metadata: { role, description },
    }),
  }

  return [runAgentsTool, spawnAgentTool]
}
