import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { defaultModel } from '../config'
import { setMCPConfigPathOverride } from '../lib/mcp-config'
import { modelRequiresApiKey } from '../lib/model'
import type { PermissionMode } from '../permissions/permission-rules'
import { readModelSelection } from '../session/model-selection'
import { cleanupAllMCPClients } from '../tools/mcp'
import { bootstrapAppRuntime } from './bootstrap'
import type { HeadlessLaunchOptions, HeadlessPermissionMode, LaunchMode, OutputFormat } from './launch-options'

const TOOL_NAME_ALIASES: Record<string, string> = {
  read: 'readFile',
  readfile: 'readFile',
  write: 'writeFile',
  writefile: 'writeFile',
  edit: 'patchFile',
  patch: 'patchFile',
  patchfile: 'patchFile',
  bash: 'executeShell',
  shell: 'executeShell',
  exec: 'executeShell',
  executeshell: 'executeShell',
  task: 'spawnAgent',
  spawnagent: 'spawnAgent',
  slashcommand: 'slashCommand',
  readtaskoutput: 'readTaskOutput',
  writememory: 'writeMemory',
}

function normalizeToolName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('mcp__')) return trimmed
  const mapped = TOOL_NAME_ALIASES[trimmed.toLowerCase()]
  return mapped ?? trimmed
}

function mapPermissionMode(mode: HeadlessPermissionMode): PermissionMode {
  if (mode === 'acceptEdits') return 'Auto-accept'
  return mode
}

export interface RunHeadlessOptions {
  headless: HeadlessLaunchOptions
  sessionMode: LaunchMode
  resumeConversationId?: string
  stdout?: NodeJS.WriteStream
  stderr?: NodeJS.WriteStream
}

type StreamJsonEvent = Record<string, unknown>

export async function runHeadless(options: RunHeadlessOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const { headless } = options

  const apiKey = Bun.env.OPENROUTER_API_KEY?.trim() ?? ''

  const trimmedPrompt = headless.prompt.trim()
  if (!trimmedPrompt) {
    stderr.write('Error: --prompt/-p requires a non-empty prompt.\n')
    return 1
  }

  if (headless.mcpConfigPath) {
    setMCPConfigPathOverride(headless.mcpConfigPath)
  }

  let appendSystemPrompt = headless.appendSystemPrompt ?? ''
  if (headless.appendSystemPromptFiles?.length) {
    for (const filePath of headless.appendSystemPromptFiles) {
      try {
        const contents = await readFile(filePath, 'utf8')
        appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${contents}` : contents
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        stderr.write(`Error: failed to read ${filePath}: ${message}\n`)
        return 1
      }
    }
  }

  const deferInit = options.sessionMode === 'continue' || options.sessionMode === 'resume-id'
  const runtime = await bootstrapAppRuntime({ deferConversationInitialization: deferInit })

  const permissionMode: PermissionMode = headless.permissionMode
    ? mapPermissionMode(headless.permissionMode)
    : 'Auto-accept'
  runtime.permissionEngine.setMode(permissionMode)

  const allowedToolIds = headless.allowedTools?.map(normalizeToolName)

  let sessionId: string
  if (options.sessionMode === 'continue') {
    const summary = await runtime.resumeLatestConversation()
    sessionId = summary ? summary.conversationId : await runtime.resetConversation()
  } else if (options.sessionMode === 'resume-id' && options.resumeConversationId) {
    const summary = await runtime.resumeConversation(options.resumeConversationId)
    sessionId = summary.conversationId
  } else {
    sessionId = await runtime.resetConversation()
  }

  const selection = await readModelSelection().catch(() => null)
  const modelId = selection?.modelId ?? defaultModel
  const reasoningEffort = selection?.reasoningEffort ?? null

  if (modelRequiresApiKey(modelId) && !apiKey) {
    stderr.write('Error: OPENROUTER_API_KEY environment variable is required for -p mode with OpenRouter models.\n')
    return 1
  }

  const format: OutputFormat = headless.outputFormat
  const startTime = Date.now()

  const emitJsonLine = (event: StreamJsonEvent) => {
    stdout.write(`${JSON.stringify(event)}\n`)
  }

  if (format === 'stream-json') {
    emitJsonLine({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      model: modelId,
      cwd: process.cwd(),
      permission_mode: permissionMode,
      tools: allowedToolIds ?? null,
    })
    emitJsonLine({
      type: 'user',
      session_id: sessionId,
      message: { role: 'user', content: trimmedPrompt },
    })
  }

  const printedAssistantChars = new Map<string, number>()
  const toolStage = new Map<string, number>()

  const unsubscribe = runtime.conversationStore.subscribe(() => {
    const snapshot = runtime.conversationStore.getSnapshot()
    for (const message of snapshot.messages) {
      if (message.hidden) continue

      if (message.role === 'assistant') {
        const already = printedAssistantChars.get(message.id) ?? 0
        const content = message.content ?? ''
        if (format === 'text') {
          if (content.length > already) {
            stdout.write(content.slice(already))
            printedAssistantChars.set(message.id, content.length)
          }
        } else if (format === 'stream-json' && headless.verbose && headless.includePartialMessages) {
          const delta = content.slice(already)
          if (delta) {
            emitJsonLine({
              type: 'stream_event',
              session_id: sessionId,
              message_id: message.id,
              event: { delta: { type: 'text_delta', text: delta } },
            })
            printedAssistantChars.set(message.id, content.length)
          }
        } else {
          printedAssistantChars.set(message.id, content.length)
        }
        continue
      }

      if (message.role === 'tool') {
        const stage = toolStage.get(message.id) ?? 0
        const toolName = (message.metadata?.toolName as string | undefined) ?? 'tool'
        const status = (message.metadata?.toolStatus as string | undefined) ?? 'started'
        const toolCallId = (message.metadata?.toolCallId as string | undefined) ?? message.id

        if (format === 'text' && stage === 0) {
          stderr.write(`\n[${toolName}:${status}]\n`)
          toolStage.set(message.id, 1)
          continue
        }

        if (format === 'stream-json') {
          if (stage < 1) {
            emitJsonLine({
              type: 'tool_use',
              session_id: sessionId,
              id: toolCallId,
              name: toolName,
              input: message.metadata?.toolArgs ?? {},
            })
            toolStage.set(message.id, 1)
          }
          if ((status === 'completed' || status === 'failed') && (toolStage.get(message.id) ?? 0) < 2) {
            emitJsonLine({
              type: 'tool_result',
              session_id: sessionId,
              tool_use_id: toolCallId,
              is_error: status === 'failed',
              content: message.metadata?.toolResult ?? message.content ?? '',
            })
            toolStage.set(message.id, 2)
          }
        }
      }
    }
  })

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  let exitCode = 0
  let finalAssistant = ''
  let errorMessage: string | undefined

  try {
    await runtime.conversationStore.pushMessage({
      id: randomUUID(),
      role: 'user',
      content: trimmedPrompt,
      timestamp: new Date().toISOString(),
    })

    const turn = await runtime.conversationRunner.runTurn({
      userInput: trimmedPrompt,
      apiKey,
      modelId,
      reasoningEffort,
      signal: controller.signal,
      allowedToolIds,
      systemPromptOverride: headless.systemPromptOverride,
      appendSystemPrompt: appendSystemPrompt || undefined,
    })

    finalAssistant = turn.assistantOutput ?? ''

    if (format === 'text') {
      stdout.write('\n')
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    exitCode = 1
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    unsubscribe()

    const durationMs = Date.now() - startTime

    if (format === 'stream-json') {
      if (finalAssistant) {
        emitJsonLine({
          type: 'assistant',
          session_id: sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: finalAssistant }] },
        })
      }
      emitJsonLine({
        type: 'result',
        session_id: sessionId,
        result: finalAssistant,
        is_error: Boolean(errorMessage),
        ...(errorMessage ? { error: errorMessage } : {}),
        duration_ms: durationMs,
        num_turns: 1,
        model: modelId,
      })
    } else if (format === 'json') {
      emitJsonLine({
        type: 'result',
        session_id: sessionId,
        result: finalAssistant,
        is_error: Boolean(errorMessage),
        ...(errorMessage ? { error: errorMessage } : {}),
        duration_ms: durationMs,
        num_turns: 1,
        model: modelId,
      })
    } else if (errorMessage) {
      stderr.write(`\nError: ${errorMessage}\n`)
    }

    await Promise.race([
      cleanupAllMCPClients(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => undefined)
  }

  return exitCode
}
