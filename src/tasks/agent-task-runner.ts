import type { ToolSet } from 'ai'

import { createAgentRun } from '../agents/agent-runtime'
import { AgentRunner } from '../agents/agent-runner'
import { DEFAULT_AGENT_DEFINITIONS } from '../agents/agent-definitions'
import type { ReasoningEffort } from '../lib/model'
import type { AgentRole } from '../agents/agent-types'
import { readTaskOutputTail } from './task-output'
import { isTerminalTaskStatus, TaskRuntime } from './task-runtime'
import type { TaskRecord } from './task-types'
import type { ToolExecutionContext } from '../tools/tool-types'

const MAX_BATCH_RESULT_OUTPUT_BYTES = 64 * 1024

export interface RunAgentTaskInput {
  role: AgentRole
  prompt: string
  title?: string
  background?: boolean
  apiKey: string
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  providerSlug?: string | null
  baseSystemPrompt: string
  agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions']
  extraTools?: ToolSet
  signal?: AbortSignal
}

export interface AgentTaskResult {
  task: TaskRecord
  output: string
  summary: string
}

export interface RunAgentBatchItemInput {
  role: AgentRole
  prompt: string
  title?: string
}

export interface RunAgentBatchInput {
  agents: RunAgentBatchItemInput[]
  apiKey: string
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  providerSlug?: string | null
  baseSystemPrompt: string
  agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions']
  signal?: AbortSignal
}

export interface AgentBatchTaskResult {
  task: TaskRecord
  output: string
}

export interface AgentBatchResult {
  tasks: AgentBatchTaskResult[]
}

export type AgentBatchEvent =
  | { type: 'started'; tasks: TaskRecord[] }
  | { type: 'progress'; tasks: TaskRecord[] }
  | { type: 'completed'; tasks: AgentBatchTaskResult[] }

export class AgentTaskRunner {
  constructor(
    private readonly taskRuntime: TaskRuntime,
    private readonly agentRunner: AgentRunner,
    private readonly createChildTools: (
      allowedToolIds?: readonly string[],
      agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions'],
    ) => Promise<ToolSet>,
  ) {}

  async *streamBatch(input: RunAgentBatchInput): AsyncGenerator<AgentBatchEvent, AgentBatchResult> {
    if (input.agents.length === 0) {
      const empty = { tasks: [] }
      yield { type: 'completed', tasks: [] }
      return empty
    }

    const launched: AgentTaskResult[] = []

    const launchResults = await Promise.allSettled(
      input.agents.map((agent) =>
        this.run({
          role: agent.role,
          prompt: agent.prompt,
          title: agent.title,
          background: true,
          apiKey: input.apiKey,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          providerSlug: input.providerSlug,
          baseSystemPrompt: input.baseSystemPrompt,
          agentExecutionOptions: input.agentExecutionOptions,
          signal: input.signal,
        }),
      ),
    )
    const failedLaunch = launchResults.find((result) => result.status === 'rejected')
    launched.push(...launchResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
    if (failedLaunch?.status === 'rejected') {
      await Promise.allSettled(launched.map((result) => this.taskRuntime.cancelTask(result.task.id)))
      throw failedLaunch.reason
    }

    const startedTasks = launched.map((result) => result.task)
    const taskIds = startedTasks.map((task) => task.id)
    yield { type: 'started', tasks: startedTasks }

    let latestTasks = startedTasks
    for await (const tasks of this.taskRuntime.watchTasks(taskIds, { signal: input.signal })) {
      latestTasks = tasks
      yield { type: 'progress', tasks }
    }

    const missing = taskIds.filter((id) => !latestTasks.some((task) => task.id === id))
    if (missing.length > 0) {
      throw new Error(`Agent tasks disappeared before completion: ${missing.join(', ')}`)
    }

    const nonTerminal = latestTasks.filter((task) => !isTerminalTaskStatus(task.status))
    if (nonTerminal.length > 0) {
      throw new Error(`Agent tasks did not finish: ${nonTerminal.map((task) => task.id).join(', ')}`)
    }

    const tasks = await Promise.all(
      latestTasks.map(async (task) => ({
        task,
        output: await readTaskOutputTail(task.id, MAX_BATCH_RESULT_OUTPUT_BYTES),
      })),
    )
    const result = { tasks }
    yield { type: 'completed', tasks }
    return result
  }

  async runBatch(input: RunAgentBatchInput): Promise<AgentBatchResult> {
    const stream = this.streamBatch(input)
    let next = await stream.next()
    while (!next.done) {
      next = await stream.next()
    }
    return next.value
  }

  async run(input: RunAgentTaskInput): Promise<AgentTaskResult> {
    const definition = DEFAULT_AGENT_DEFINITIONS[input.role]
    if (!definition) {
      throw new Error(`Unknown agent role: ${input.role}`)
    }

    const runHandle = await createAgentRun(
      definition,
      input.title ?? `${definition.role} · ${input.prompt.slice(0, 40)}`,
    )

    const createdTask = await this.taskRuntime.createTask({
      kind: 'agent',
      title: input.title ?? `Agent · ${definition.role}`,
      background: input.background ?? true,
      status: 'running',
      startedAt: new Date().toISOString(),
      progressSummary: 'Starting delegated agent',
      outputPath: runHandle.record.outputPath,
      transcriptPath: runHandle.record.transcriptPath,
      metadata: {
        agentRunId: runHandle.record.id,
        agentRole: definition.role,
      },
    })

    const controller = new AbortController()
    const unregister = this.taskRuntime.registerController(createdTask.id, controller)
    const onAbort = () => controller.abort()
    if (input.signal) {
      if (input.signal.aborted) {
        controller.abort()
      } else {
        input.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    const execute = async (): Promise<AgentTaskResult> => {
      try {
        const result = await this.agentRunner.run({
          definition,
          prompt: input.prompt,
          apiKey: input.apiKey,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          providerSlug: input.providerSlug,
          baseSystemPrompt: input.baseSystemPrompt,
          agentExecutionOptions: input.agentExecutionOptions,
          createTools: this.createChildTools,
          extraTools: input.extraTools,
          appendTranscript: runHandle.appendTranscript,
          updateProgress: async (summary) => {
            await runHandle.updateProgress(summary)
            await this.taskRuntime.updateTask(createdTask.id, {
              progressSummary: summary,
            })
          },
          signal: controller.signal,
        })

        await runHandle.complete(result.output, result.summary)
        const completedTask = await this.taskRuntime.updateTask(createdTask.id, {
          status: 'completed',
          finishedAt: new Date().toISOString(),
          progressSummary: result.summary,
        })

        return {
          task: completedTask ?? createdTask,
          output: result.output,
          summary: result.summary,
        }
      } catch (error) {
        await runHandle.fail(error)
        const message = error instanceof Error ? error.message : String(error)
        const cancelled = controller.signal.aborted
        const failedTask = await this.taskRuntime.updateTask(createdTask.id, {
          status: cancelled ? 'cancelled' : 'failed',
          finishedAt: new Date().toISOString(),
          progressSummary: cancelled ? 'Delegated agent cancelled' : 'Delegated agent failed',
          error: cancelled ? null : message,
        })
        if (cancelled) {
          return {
            task: failedTask ?? createdTask,
            output: '',
            summary: 'Delegated agent cancelled',
          }
        }
        throw Object.assign(new Error(message), { task: failedTask ?? createdTask })
      } finally {
        if (input.signal) {
          input.signal.removeEventListener('abort', onAbort)
        }
        unregister()
      }
    }

    if (input.background ?? true) {
      void execute().catch(() => {
        // background errors are persisted through task state
      })

      return {
        task: createdTask,
        output: '',
        summary: 'Delegated agent running in background',
      }
    }

    return execute()
  }
}
