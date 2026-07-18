import { jsonSchema, tool, type ToolSet } from 'ai'
import type { z } from 'zod'

import {
  createWorkflowSnapshot,
  preview,
  recomputeWorkflowSnapshot,
  renderWorkflowText,
  type WorkflowSnapshot,
} from '../../workflows/workflow-display'
import { maxDelegationDepth as defaultMaxDelegationDepth } from '../../config'
import { createSerialQueue } from '../../lib/serial-queue'
import { writeTaskOutput } from '../../tasks/task-output'
import type { TaskRecord, UpdateTaskInput } from '../../tasks/task-types'
import { parseWorkflowScript } from '../../workflows/workflow-parser'
import { runWorkflow } from '../../workflows/workflow-runtime'
import type { JsonSchema, WorkflowAgentRunOptions } from '../../workflows/workflow-types'
import type { AnyToolDefinition, ToolDefinition, ToolExecutionContext } from '../tool-types'
import { workflowSchema } from './schemas'
import { summarizeBuiltInToolCompletion } from './utils'

type WorkflowInput = z.infer<typeof workflowSchema>

interface StructuredOutputCapture {
  called: boolean
  value: unknown
}

const workflowDescription = [
  'Execute a deterministic JavaScript orchestrator that runs multiple Gambit subagents.',
  "The script must start with export const meta = { name: 'short_snake_case', description: 'non-empty description' }.",
  'Available globals: agent(prompt, opts), parallel(thunks), pipeline(items, ...stages), phase(title), log(message), args, cwd, process.cwd(), and budget.',
  'Date.now(), new Date(), and Math.random() are unavailable in workflow scripts.',
  'Use this only for decomposable multi-agent work such as fan-out/fan-in research, adversarial verification, tournaments, repeated checks, or complex migrations.',
  'Do not use workflow for a single quick file read or edit.',
  'parallel() takes functions, not promises: await parallel(items.map(item => () => agent(...))).',
  'Every agent() call should include a unique short label option.',
  "agent options support label, phase, role ('default' | 'explorer' | 'worker'), agentType, model, isolation, and schema.",
  "isolation: 'worktree' is advisory for the subagent prompt; this tool does not create a separate git worktree.",
  'When opts.schema is a JSON Schema object, the subagent must call structured_output and agent() returns that object.',
  'Return a compact JSON-serializable workflow result with the important outputs and verdict.',
].join(' ')

export function createWorkflowTool(): AnyToolDefinition[] {
  const workflowTool: ToolDefinition<typeof workflowSchema, string> = {
    id: 'workflow',
    displayName: 'Workflow',
    description: workflowDescription,
    inputSchema: workflowSchema,
    requiredCapabilities: ['agents'],
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('workflow', context.input, result, context.artifactPath),
    execute: async (input, context) => executeWorkflowTool(input, context),
    getPermissionRequest: (input) => {
      const script = normalizeWorkflowScript(input.script)
      let name = 'dynamic workflow'
      try {
        name = parseWorkflowScript(script).meta.name
      } catch {
        // Let normal execution produce the parser error after permission evaluation.
      }
      return {
        subject: `Run ${name} with delegated agents`,
        metadata: {
          concurrency: input.concurrency,
          tokenBudget: input.tokenBudget,
        },
      }
    },
  }

  return [workflowTool]
}

async function executeWorkflowTool(input: WorkflowInput, context: ToolExecutionContext): Promise<string> {
  if (!context.agentTaskRunner || !context.agentExecutionOptions) {
    throw new Error('Agent task runner is not configured.')
  }

  const currentDepth = context.agentExecutionOptions.delegationDepth ?? 0
  const maxDepth = context.agentExecutionOptions.maxDelegationDepth ?? defaultMaxDelegationDepth
  if (currentDepth >= maxDepth) {
    throw new Error(`Maximum delegation depth reached (${maxDepth}).`)
  }

  const script = normalizeWorkflowScript(input.script)
  const parsed = parseWorkflowScript(script)
  let snapshot: WorkflowSnapshot = createWorkflowSnapshot(parsed.meta)
  let workflowTask: TaskRecord | null = null
  const workflowUpdateQueue = createSerialQueue()

  const workflowMetadata = () => ({
    workflowName: snapshot.name,
    workflowDescription: snapshot.description,
    workflowSnapshot: snapshot,
    concurrency: input.concurrency ?? null,
    tokenBudget: input.tokenBudget ?? null,
  })

  const queueWorkflowTaskUpdate = (patch: UpdateTaskInput) => {
    if (!context.taskRuntime || !workflowTask) {
      return
    }

    const taskId = workflowTask.id
    void workflowUpdateQueue
      .run(async () => {
        const updated = await context.taskRuntime!.updateTask(taskId, {
          ...patch,
          metadata: {
            ...(workflowTask?.metadata ?? {}),
            ...(patch.metadata ?? {}),
          },
        })
        if (updated) {
          workflowTask = updated
        }
      })
      .catch(() => undefined)
  }

  const flushWorkflowTaskUpdates = async () => {
    await workflowUpdateQueue.flush()
  }

  const update = () => {
    snapshot = recomputeWorkflowSnapshot(snapshot)
    queueWorkflowTaskUpdate({
      progressSummary: formatWorkflowProgressSummary(snapshot),
      metadata: workflowMetadata(),
    })
  }

  const recordPhase = (title: string | undefined) => {
    if (!title) {
      return
    }
    if (!snapshot.phases.includes(title)) {
      snapshot.phases.push(title)
    }
  }

  if (context.taskRuntime) {
    workflowTask = await context.taskRuntime.createTask({
      kind: 'workflow',
      title: `Workflow - ${parsed.meta.name}`,
      background: false,
      status: 'running',
      startedAt: new Date().toISOString(),
      progressSummary: parsed.meta.description || 'Workflow running',
      metadata: workflowMetadata(),
    })
  }

  const agent = {
    run: async (prompt: string, options: WorkflowAgentRunOptions) => {
      const capture: StructuredOutputCapture = { called: false, value: undefined }
      const extraTools = options.schema ? createStructuredOutputTools(options.schema, capture) : undefined
      const result = await context.agentTaskRunner!.run({
        role: options.role,
        prompt: buildWorkflowAgentPrompt(prompt, options, Boolean(options.schema)),
        title: options.label,
        background: false,
        apiKey: context.agentExecutionOptions!.apiKey,
        modelId: options.modelId ?? context.agentExecutionOptions!.modelId,
        reasoningEffort: context.agentExecutionOptions!.reasoningEffort,
        providerSlug: context.agentExecutionOptions!.providerSlug,
        baseSystemPrompt: context.agentExecutionOptions!.baseSystemPrompt,
        agentExecutionOptions: {
          ...context.agentExecutionOptions!,
          delegationDepth: currentDepth + 1,
          maxDelegationDepth: maxDepth,
        },
        extraTools,
        signal: options.signal ?? context.signal,
      })

      if (options.schema) {
        if (!capture.called) {
          throw new Error('Workflow subagent finished without calling structured_output')
        }
        return capture.value
      }

      return result.output
    },
  }

  try {
    const result = await runWorkflow(script, {
      cwd: context.cwd ?? context.workspaceRoot,
      args: input.args,
      agent,
      signal: context.signal,
      concurrency: input.concurrency,
      tokenBudget: input.tokenBudget,
      onLog(message) {
        snapshot.logs.push(message)
        update()
      },
      onPhase(title) {
        snapshot.currentPhase = title
        recordPhase(title)
        update()
      },
      onAgentStart(event) {
        recordPhase(event.phase)
        snapshot.agents.push({
          id: snapshot.agents.length + 1,
          label: event.label,
          phase: event.phase,
          prompt: event.prompt,
          status: 'running',
        })
        update()
      },
      onAgentEnd(event) {
        const agentSnapshot = [...snapshot.agents]
          .reverse()
          .find((item) => item.label === event.label && item.status === 'running')
        if (agentSnapshot) {
          agentSnapshot.status = event.result === null ? 'error' : 'done'
          agentSnapshot.resultPreview = preview(event.result)
        }
        update()
      },
    })

    if (result.agentCount === 0) {
      throw new Error('workflow scripts must call agent() at least once')
    }

    snapshot.result = result.result
    snapshot.durationMs = result.durationMs
    snapshot = recomputeWorkflowSnapshot(snapshot)

    const output = [
      `Workflow ${result.meta.name} completed with ${result.agentCount} agent(s).`,
      '',
      renderWorkflowText(snapshot, true, { maxAgents: 12, maxLogs: 4, showResultPreviews: true }),
      '',
      'Result:',
      JSON.stringify(result.result, null, 2),
    ].join('\n')

    await flushWorkflowTaskUpdates()
    if (context.taskRuntime && workflowTask) {
      await writeTaskOutput(workflowTask.id, output)
      await context.taskRuntime.updateTask(workflowTask.id, {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        progressSummary: formatWorkflowProgressSummary(snapshot),
        metadata: workflowMetadata(),
      })
    }

    return output
  } catch (error) {
    await flushWorkflowTaskUpdates()
    if (context.taskRuntime && workflowTask) {
      await context.taskRuntime.updateTask(workflowTask.id, {
        status: context.signal?.aborted ? 'cancelled' : 'failed',
        finishedAt: new Date().toISOString(),
        progressSummary: context.signal?.aborted ? 'Workflow cancelled' : 'Workflow failed',
        error: context.signal?.aborted ? null : error instanceof Error ? error.message : String(error),
        metadata: workflowMetadata(),
      })
    }
    throw error
  }
}

function createStructuredOutputTools(schema: JsonSchema, capture: StructuredOutputCapture): ToolSet {
  return {
    structured_output: tool({
      description: [
        'Return the final machine-readable result for this workflow subagent.',
        'Call this exactly once when the task is complete.',
        'Do not use prose as the final answer instead of this tool.',
      ].join(' '),
      inputSchema: jsonSchema(schema as any),
      execute: async (params: unknown) => {
        if (capture.called) {
          throw new Error('structured_output was already called')
        }
        capture.called = true
        capture.value = params
        return 'Structured output received.'
      },
    }),
  } as ToolSet
}

function buildWorkflowAgentPrompt(
  prompt: string,
  options: WorkflowAgentRunOptions,
  structured: boolean,
): string {
  const parts = [
    options.instructions,
    `Workflow task label: ${options.label}`,
    prompt,
  ].filter(Boolean)

  if (structured) {
    parts.push(
      [
        'Final output contract:',
        '- Your final action MUST be a structured_output tool call.',
        '- The structured_output arguments are the return value of this workflow subagent.',
        '- Do not emit a prose final answer instead of structured_output.',
        '- If you need to inspect files or run commands first, do so, then call structured_output exactly once.',
      ].join('\n'),
    )
  }

  return parts.join('\n\n')
}

function normalizeWorkflowScript(script: string): string {
  let text = script.trim()
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i)
  if (fence) {
    text = fence[1]?.trim() ?? ''
  }
  return text
}

function formatWorkflowProgressSummary(snapshot: WorkflowSnapshot): string {
  const parts = [`${snapshot.doneCount}/${snapshot.agentCount} agents`]
  if (snapshot.runningCount > 0) {
    parts.push(`${snapshot.runningCount} running`)
  }
  if (snapshot.errorCount > 0) {
    parts.push(`${snapshot.errorCount} failed`)
  }
  if (snapshot.currentPhase) {
    parts.push(snapshot.currentPhase)
  }
  return `Workflow ${snapshot.name}: ${parts.join(' / ')}`
}
