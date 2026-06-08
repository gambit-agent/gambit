import { type ToolSet } from 'ai'

import { generateId } from '../lib/id'
import { toCoreMessages } from '../lib/messages'
import { buildOpenRouterModelSettings, createModelSelector, type ReasoningEffort } from '../lib/model'
import { ModelStreamRunner } from '../lib/streaming/model-stream-runner'
import { formatToolEvent } from '../lib/toolSummaries'
import { getMemoryPrompt } from '../memory/memory-prompt'
import { maxAgentSteps } from '../config'
import type { AgentDefinition } from './agent-types'
import type { ConversationMessage } from '../conversation/conversation-types'
import type { ToolExecutionContext } from '../tools/tool-types'

const AGENT_PROGRESS_INTERVAL_MS = 250
const AGENT_TEXT_PROGRESS_CHAR_DELTA = 500

/**
 * External dependencies injected into AgentRunner so it can operate
 * independently of the main conversation loop (used for background tasks).
 */
export interface AgentRunnerOptions {
  definition: AgentDefinition
  prompt: string
  apiKey: string
  modelId: string
  reasoningEffort?: ReasoningEffort | null
  providerSlug?: string | null
  baseSystemPrompt: string
  agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions']
  createTools: (
    allowedToolIds?: readonly string[],
    agentExecutionOptions?: ToolExecutionContext['agentExecutionOptions'],
  ) => Promise<ToolSet>
  extraTools?: ToolSet
  appendTranscript: (entry: unknown) => Promise<void>
  updateProgress: (summary: string) => Promise<void>
  signal?: AbortSignal
}

export interface AgentRunnerResult {
  output: string
  summary: string
}

/**
 * Runs a single background agent turn with its own tool context and transcript.
 * Streams reasoning and tool calls back to the caller via progress callbacks.
 */
export class AgentRunner {
  async run(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
    const tools = await options.createTools(options.definition.allowedToolIds, {
      apiKey: options.apiKey,
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort,
      providerSlug: options.providerSlug,
      baseSystemPrompt: options.baseSystemPrompt,
      delegationDepth: options.agentExecutionOptions?.delegationDepth ?? 1,
      maxDelegationDepth: options.agentExecutionOptions?.maxDelegationDepth,
      maxSteps: options.agentExecutionOptions?.maxSteps,
    })
    const mergedTools = {
      ...tools,
      ...(options.extraTools ?? {}),
    }
    const selectModel = createModelSelector(options.apiKey)
    const modelSettings = buildOpenRouterModelSettings({
      reasoningEffort: options.reasoningEffort,
      providerSlug: options.providerSlug,
    })

    // Compose the ephemeral system prompt for this agent run.
    const systemPrompt = [
      options.baseSystemPrompt,
      getMemoryPrompt(),
      options.definition.systemPromptAddendum,
    ]
      .filter(Boolean)
      .join('\n\n')

    const history: ConversationMessage[] = [
      {
        id: `${options.definition.id}-system`,
        role: 'system',
        content: systemPrompt,
        timestamp: new Date().toISOString(),
        hidden: true,
      },
      {
        id: `${options.definition.id}-user`,
        role: 'user',
        content: options.prompt,
        timestamp: new Date().toISOString(),
      },
    ]

    await options.appendTranscript({
      type: 'system',
      content: systemPrompt,
      timestamp: new Date().toISOString(),
    })
    await options.appendTranscript({
      type: 'user',
      content: options.prompt,
      timestamp: new Date().toISOString(),
    })

    const turnId = `agent-${options.definition.id}-${generateId()}`
    let assistantContent = ''
    let reasoningContent = ''
    let reasoningFlushed = false
    let lastTextProgressAt = 0
    let lastTextProgressChars = 0
    let lastReasoningProgressAt = 0

    // Flush reasoning transcript so the user sees agent thinking in real time.
    const flushReasoning = async () => {
      if (reasoningContent.trim() && !reasoningFlushed) {
        reasoningFlushed = true
        await options.appendTranscript({
          type: 'reasoning',
          content: reasoningContent.trim(),
          timestamp: new Date().toISOString(),
        })
      }
    }

    const result = await new ModelStreamRunner().run({
      streamId: turnId,
      model: selectModel(options.modelId, modelSettings),
      messages: toCoreMessages(
        history.map((message) => ({
          ...message,
          timestamp: new Date(message.timestamp),
        })),
      ),
      tools: mergedTools,
      maxSteps: options.agentExecutionOptions?.maxSteps ?? maxAgentSteps,
      signal: options.signal,
      logMetadata: {
        agentId: options.definition.id,
        modelId: options.modelId,
        reasoningEffort: options.reasoningEffort ?? null,
        providerSlug: options.providerSlug ?? null,
        messageCount: history.length,
        toolCount: Object.keys(mergedTools).length,
      },
      handlers: {
        onTextDelta: async (chunk) => {
          assistantContent += chunk
          const now = Date.now()
          if (
            now - lastTextProgressAt >= AGENT_PROGRESS_INTERVAL_MS ||
            assistantContent.length - lastTextProgressChars >= AGENT_TEXT_PROGRESS_CHAR_DELTA
          ) {
            lastTextProgressAt = now
            lastTextProgressChars = assistantContent.length
            await options.updateProgress(`Agent writing response (${assistantContent.length} chars)`)
          }
        },
        onReasoningDelta: async (text) => {
          reasoningContent += text
          const preview = reasoningContent.trim().slice(0, 120)
          const now = Date.now()
          if (now - lastReasoningProgressAt >= AGENT_PROGRESS_INTERVAL_MS) {
            lastReasoningProgressAt = now
            await options.updateProgress(`Agent reasoning: ${preview}`)
          }
          await flushReasoning()
        },
        onToolCall: async (part) => {
          const summary = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'started',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
          })
          await flushReasoning()
          await options.appendTranscript({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? 'unknown',
            input: part.input ?? {},
            timestamp: new Date().toISOString(),
          })
          await options.updateProgress(summary)
        },
        onToolResult: async (part) => {
          if (part.preliminary) {
            return
          }
          const summary = formatToolEvent({
            toolName: part.toolName ?? 'unknown',
            status: 'completed',
            args: part.input ?? {},
            toolCallId: part.toolCallId,
            result: part.output,
          })
          await flushReasoning()
          await options.appendTranscript({
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? 'unknown',
            input: part.input ?? {},
            output: part.output,
            timestamp: new Date().toISOString(),
          })
          await options.updateProgress(summary)
        },
        onToolError: async (part, errorMessage) => {
          await flushReasoning()
          await options.appendTranscript({
            type: 'tool-error',
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? 'unknown',
            input: part.input ?? {},
            error: errorMessage,
            timestamp: new Date().toISOString(),
          })
          await options.updateProgress(`Tool failed: ${part.toolName ?? 'unknown'}`)
        },
      },
    })

    const finalText = result.text || assistantContent.trim()
    const finalOutput = reasoningContent.trim()
      ? `Reasoning:\n${reasoningContent.trim()}\n\n${finalText}`
      : finalText

    await flushReasoning()
    await options.appendTranscript({
      type: 'assistant',
      content: finalOutput,
      timestamp: new Date().toISOString(),
    })

    return {
      output: finalOutput,
      summary: finalText.slice(0, 200) || `Completed ${options.definition.id} agent run`,
    }
  }
}
