import { appVersion } from '../app/version'
import type { AgentDefinition } from '../agents/agent-types'
import { ATIF_SCHEMA_VERSION, type AtifStep, type AtifTrajectory } from './atif-types'

interface AgentTranscriptEntry {
  type?: unknown
  kind?: unknown
  role?: unknown
  content?: unknown
  timestamp?: unknown
  toolCallId?: unknown
  toolName?: unknown
  input?: unknown
  output?: unknown
  error?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function timestamp(entry: AgentTranscriptEntry): string | undefined {
  return typeof entry.timestamp === 'string' ? entry.timestamp : undefined
}

function content(entry: AgentTranscriptEntry): string {
  if (typeof entry.content === 'string') {
    return entry.content
  }
  if (typeof entry.output === 'string') {
    return entry.output
  }
  if (typeof entry.error === 'string') {
    return entry.error
  }
  return ''
}

function argumentsObject(value: unknown): { arguments: Record<string, unknown>; rawArguments?: unknown } {
  if (isRecord(value)) {
    return { arguments: value }
  }
  return { arguments: {}, rawArguments: value }
}

function createMessageStep(stepId: number, source: 'system' | 'user' | 'agent', entry: AgentTranscriptEntry): AtifStep {
  return {
    step_id: stepId,
    timestamp: timestamp(entry),
    source,
    message: content(entry),
    extra: {
      gambit: {
        transcript_entry: entry,
      },
    },
  }
}

export function agentTranscriptToAtifTrajectory(input: {
  runId: string
  definition: AgentDefinition
  entries: readonly unknown[]
}): AtifTrajectory {
  const steps: AtifStep[] = []
  let pendingReasoning = ''

  for (const rawEntry of input.entries) {
    const entry = isRecord(rawEntry) ? rawEntry as AgentTranscriptEntry : {}
    const type = typeof entry.type === 'string' ? entry.type : typeof entry.kind === 'string' ? entry.kind : ''
    const role = typeof entry.role === 'string' ? entry.role : ''

    if (type === 'reasoning') {
      const text = content(entry).trim()
      if (text) {
        pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${text}` : text
      }
      continue
    }

    if (type === 'system' || role === 'system') {
      steps.push(createMessageStep(steps.length + 1, 'system', entry))
      continue
    }
    if (type === 'user' || role === 'user') {
      steps.push(createMessageStep(steps.length + 1, 'user', entry))
      continue
    }
    if (type === 'assistant' || role === 'assistant') {
      steps.push({
        ...createMessageStep(steps.length + 1, 'agent', entry),
        ...(pendingReasoning ? { reasoning_content: pendingReasoning } : {}),
      })
      pendingReasoning = ''
      continue
    }

    if (type === 'tool-call') {
      const toolCallId = typeof entry.toolCallId === 'string' ? entry.toolCallId : `call-${steps.length + 1}`
      const { arguments: args, rawArguments } = argumentsObject(entry.input)
      steps.push({
        step_id: steps.length + 1,
        timestamp: timestamp(entry),
        source: 'agent',
        message: '',
        ...(pendingReasoning ? { reasoning_content: pendingReasoning } : {}),
        tool_calls: [
          {
            tool_call_id: toolCallId,
            function_name: typeof entry.toolName === 'string' ? entry.toolName : 'tool',
            arguments: args,
            extra: {
              gambit: {
                transcript_entry: entry,
                raw_arguments: rawArguments,
              },
            },
          },
        ],
        extra: {
          gambit: {
            transcript_entry: entry,
          },
        },
      })
      pendingReasoning = ''
      continue
    }

    if (type === 'tool-result' || type === 'tool-error') {
      const toolCallId = typeof entry.toolCallId === 'string' ? entry.toolCallId : undefined
      const step = toolCallId
        ? [...steps].reverse().find((candidate) =>
            candidate.tool_calls?.some((call) => call.tool_call_id === toolCallId),
          )
        : undefined
      const result = {
        ...(toolCallId ? { source_call_id: toolCallId } : {}),
        content: type === 'tool-error' ? `Error: ${content(entry)}` : content(entry),
        extra: {
          gambit: {
            transcript_entry: entry,
            raw_result: type === 'tool-error' ? entry.error : entry.output,
          },
        },
      }

      if (step) {
        step.observation = {
          results: [...(step.observation?.results ?? []), result],
        }
      } else {
        steps.push({
          step_id: steps.length + 1,
          timestamp: timestamp(entry),
          source: 'agent',
          message: '',
          llm_call_count: 0,
          observation: { results: [result] },
          extra: {
            gambit: {
              transcript_entry: entry,
            },
          },
        })
      }
    }
  }

  return {
    schema_version: ATIF_SCHEMA_VERSION,
    session_id: input.runId,
    trajectory_id: input.runId,
    agent: {
      name: 'gambit-agent',
      version: appVersion,
      extra: {
        agent_id: input.definition.id,
        role: input.definition.role,
      },
    },
    steps,
    final_metrics: {
      total_steps: steps.length,
    },
    extra: {
      gambit: {
        transcript_entry_count: input.entries.length,
      },
    },
  }
}
