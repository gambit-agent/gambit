import { createAgentRun } from '../agents/agent-runtime'
import { AgentRunner } from '../agents/agent-runner'
import { DEFAULT_AGENT_DEFINITIONS } from '../agents/agent-definitions'
import type { ReasoningEffort } from '../lib/model'
import type { AgentRole } from '../agents/agent-types'
import { TaskRuntime } from './task-runtime'
import type { TaskRecord } from './task-types'
import type { ToolExecutionContext } from '../tools/tool-types'

export interface RunAgentTaskInput {
  role: AgentRole
  prompt: string
  title?: string
  background?: boolean
  apiKey: string
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  baseSystemPrompt: string
  agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions']
  signal?: AbortSignal
}

export interface AgentTaskResult {
  task: TaskRecord
  output: string
  summary: string
}

export class AgentTaskRunner {
  constructor(
    private readonly taskRuntime: TaskRuntime,
    private readonly agentRunner: AgentRunner,
    private readonly createChildTools: (
      allowedToolIds?: readonly string[],
      agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions'],
    ) => Promise<Record<string, any>>,
  ) {}

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
          baseSystemPrompt: input.baseSystemPrompt,
          agentExecutionOptions: input.agentExecutionOptions,
          createTools: this.createChildTools,
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
