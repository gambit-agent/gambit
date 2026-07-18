import { appVersion } from '../app/version'
import { generateId } from '../lib/id'
import type { ConversationMessage, ConversationTurnRecord } from '../conversation/conversation-types'
import { ATIF_SCHEMA_VERSION, type AtifContent, type AtifStep, type AtifTrajectory } from './atif-types'
import { assertValidAtifTrajectory } from './atif-validator'

const GAMBIT_EXTRA_KEY = 'gambit'
type ToolStatus = NonNullable<ConversationMessage['metadata']>['toolStatus']

interface GambitStepExtra {
  message_id?: string
  parent_id?: string
  hidden?: boolean
  metadata?: ConversationMessage['metadata']
  turn_records?: ConversationTurnRecord[]
  context_management?: {
    type: string
    boundary: string
  }
}

interface GambitToolExtra {
  tool_message_id?: string
  tool_message_content?: string
  tool_message_timestamp?: string
  tool_status?: ToolStatus
  tool_artifact_path?: string
  raw_arguments?: unknown
  raw_result?: unknown
}

export interface ConversationTrajectoryData {
  messages: ConversationMessage[]
  turnRecords: ConversationTurnRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contentToString(content: AtifContent | undefined): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => (part.type === 'text' ? part.text : `[image: ${part.source.path}]`))
    .join('\n')
}

function toAtifArguments(value: unknown): { arguments: Record<string, unknown>; rawArguments?: unknown } {
  if (isRecord(value)) {
    return { arguments: value }
  }
  return { arguments: {}, rawArguments: value }
}

function getGambitExtra<T>(extra: Record<string, unknown> | undefined): T | undefined {
  if (!extra) {
    return undefined
  }
  const value = extra[GAMBIT_EXTRA_KEY]
  return isRecord(value) ? value as T : undefined
}

function withGambitExtra(value: object): Record<string, unknown> {
  return { [GAMBIT_EXTRA_KEY]: value }
}

function isCompactionMessage(message: ConversationMessage): boolean {
  return message.role === 'system' && message.hidden === true && message.content.startsWith('[Context compaction]')
}

function createMessageStep(stepId: number, message: ConversationMessage): AtifStep {
  const extra: GambitStepExtra = {
    message_id: message.id,
    parent_id: message.parentId,
    hidden: message.hidden,
    metadata: message.metadata,
  }

  const source = message.role === 'assistant'
    ? 'agent'
    : message.role === 'tool'
      ? 'agent'
      : message.role

  const step: AtifStep = {
    step_id: stepId,
    timestamp: message.timestamp,
    source,
    message: message.content,
    extra: withGambitExtra(extra),
  }

  if (isCompactionMessage(message)) {
    extra.context_management = { type: 'compaction', boundary: 'replace' }
    step.observation = { results: [{ content: message.content }] }
  }

  return step
}

function createToolStep(
  stepId: number,
  assistant: ConversationMessage | null,
  toolMessages: ConversationMessage[],
): AtifStep {
  const toolCalls = toolMessages.map((message) => {
    const { arguments: args, rawArguments } = toAtifArguments(message.metadata?.toolArgs)
    const extra: GambitToolExtra = {
      tool_message_id: message.id,
      tool_message_content: message.content,
      tool_message_timestamp: message.timestamp,
      tool_status: message.metadata?.toolStatus,
      tool_artifact_path: message.metadata?.toolArtifactPath,
      raw_arguments: rawArguments,
    }

    return {
      tool_call_id: message.metadata?.toolCallId ?? message.id,
      function_name: message.metadata?.toolName ?? 'tool',
      arguments: args,
      extra: withGambitExtra(extra),
    }
  })

  const results = toolMessages.map((message) => {
    const extra: GambitToolExtra = {
      tool_message_id: message.id,
      tool_message_content: message.content,
      tool_message_timestamp: message.timestamp,
      tool_status: message.metadata?.toolStatus,
      tool_artifact_path: message.metadata?.toolArtifactPath,
      raw_result: message.metadata?.toolResult,
    }

    return {
      source_call_id: message.metadata?.toolCallId ?? message.id,
      content: typeof message.metadata?.toolResult === 'string'
        ? message.metadata.toolResult
        : message.content,
      subagent_trajectory_ref: message.metadata?.subagentTrajectoryRefs,
      extra: withGambitExtra(extra),
    }
  })

  const extra: GambitStepExtra = assistant
    ? {
      message_id: assistant.id,
      parent_id: assistant.parentId,
      hidden: assistant.hidden,
      metadata: assistant.metadata,
    }
    : {}

  return {
    step_id: stepId,
    timestamp: assistant?.timestamp ?? toolMessages[0]?.timestamp,
    source: 'agent',
    message: assistant?.content ?? '',
    tool_calls: toolCalls,
    observation: { results },
    extra: withGambitExtra(extra),
    ...(assistant ? {} : { llm_call_count: 0 }),
  }
}

export function conversationToAtifTrajectory(input: {
  conversationId: string
  messages: readonly ConversationMessage[]
  turnRecords?: readonly ConversationTurnRecord[]
}): AtifTrajectory {
  const steps: AtifStep[] = []
  let index = 0

  while (index < input.messages.length) {
    const message = input.messages[index]!

    if (message.role === 'assistant') {
      const toolMessages: ConversationMessage[] = []
      let nextIndex = index + 1
      while (input.messages[nextIndex]?.role === 'tool') {
        toolMessages.push(input.messages[nextIndex]!)
        nextIndex += 1
      }

      if (toolMessages.length > 0) {
        steps.push(createToolStep(steps.length + 1, message, toolMessages))
        index = nextIndex
        continue
      }
    }

    if (message.role === 'tool') {
      const toolMessages: ConversationMessage[] = []
      let nextIndex = index
      while (input.messages[nextIndex]?.role === 'tool') {
        toolMessages.push(input.messages[nextIndex]!)
        nextIndex += 1
      }
      steps.push(createToolStep(steps.length + 1, null, toolMessages))
      index = nextIndex
      continue
    }

    steps.push(createMessageStep(steps.length + 1, message))
    index += 1
  }

  const turnRecords = [...(input.turnRecords ?? [])]

  return {
    schema_version: ATIF_SCHEMA_VERSION,
    session_id: input.conversationId,
    trajectory_id: input.conversationId,
    agent: {
      name: 'gambit',
      version: appVersion,
    },
    steps,
    final_metrics: {
      total_steps: steps.length,
    },
    extra: withGambitExtra({
      turn_records: turnRecords,
    }),
  }
}

export function atifTrajectoryToConversation(trajectory: AtifTrajectory): ConversationTrajectoryData {
  const messages: ConversationMessage[] = []
  const steps = [...trajectory.steps].sort((left, right) => left.step_id - right.step_id)

  for (const step of steps) {
    const stepExtra = getGambitExtra<GambitStepExtra>(step.extra)

    if (step.source === 'system' || step.source === 'user') {
      messages.push({
        id: stepExtra?.message_id ?? generateId(),
        parentId: stepExtra?.parent_id,
        role: step.source,
        content: contentToString(step.message),
        timestamp: step.timestamp ?? new Date().toISOString(),
        hidden: stepExtra?.hidden,
        metadata: stepExtra?.metadata,
      })
      continue
    }

    const assistantContent = contentToString(step.message)
    if (assistantContent.trim() || stepExtra?.message_id || !step.tool_calls?.length) {
      messages.push({
        id: stepExtra?.message_id ?? generateId(),
        parentId: stepExtra?.parent_id,
        role: 'assistant',
        content: assistantContent,
        timestamp: step.timestamp ?? new Date().toISOString(),
        hidden: stepExtra?.hidden,
        metadata: stepExtra?.metadata,
      })
    }

    const callsById = new Map((step.tool_calls ?? []).map((call) => [call.tool_call_id, call]))
    for (const result of step.observation?.results ?? []) {
      const call = result.source_call_id ? callsById.get(result.source_call_id) : undefined
      const callExtra = getGambitExtra<GambitToolExtra>(call?.extra)
      const resultExtra = getGambitExtra<GambitToolExtra>(result.extra)
      const toolCallId = result.source_call_id ?? call?.tool_call_id ?? resultExtra?.tool_message_id ?? generateId()
      const rawResult = resultExtra?.raw_result ?? contentToString(result.content)

      messages.push({
        id: resultExtra?.tool_message_id ?? callExtra?.tool_message_id ?? toolCallId,
        role: 'tool',
        content: resultExtra?.tool_message_content ?? contentToString(result.content),
        timestamp: resultExtra?.tool_message_timestamp ?? callExtra?.tool_message_timestamp ?? step.timestamp ?? new Date().toISOString(),
        metadata: {
          toolCallId,
          toolName: call?.function_name ?? 'tool',
          toolArgs: callExtra?.raw_arguments ?? call?.arguments ?? {},
          toolResult: rawResult,
          toolStatus: resultExtra?.tool_status ?? callExtra?.tool_status,
          toolArtifactPath: resultExtra?.tool_artifact_path ?? callExtra?.tool_artifact_path,
          subagentTrajectoryRefs: result.subagent_trajectory_ref,
        },
      })
    }
  }

  const rootExtra = getGambitExtra<GambitStepExtra>(trajectory.extra)

  return {
    messages,
    turnRecords: rootExtra?.turn_records ?? [],
  }
}

export async function readAtifTrajectory(filePath: string): Promise<AtifTrajectory | null> {
  try {
    return await Bun.file(filePath, { type: 'application/json' }).json() as AtifTrajectory
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function writeAtifTrajectory(filePath: string, trajectory: AtifTrajectory): Promise<void> {
  assertValidAtifTrajectory(trajectory)
  await Bun.write(filePath, `${JSON.stringify(trajectory, null, 2)}\n`)
}
