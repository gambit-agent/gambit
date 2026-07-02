import { generateId } from '../lib/id'

import { defaultModel } from '../config'
import {
  buildGoalRunPrompt,
  clearConversationGoal,
  getConversationGoal,
  parseGoalCommand,
  setConversationGoal,
} from '../conversation/goal'
import { setMCPConfigPathOverride } from '../lib/mcp-config'
import { modelNeedsOpenRouterApiKey } from '../lib/model'
import { getProviderCredential, isProviderConnected } from '../lib/provider-credentials'
import { getDirectProviderDefinition, parseDirectProviderModelId } from '../lib/providers'
import { executePromptTemplate } from '../lib/promptTemplates'
import { formatSlashCommandMessage } from '../lib/slash-command-format'
import { executeSlashCommand } from '../lib/slashCommands'
import { activateSkill } from '../lib/skills'
import type { PermissionMode } from '../permissions/permission-rules'
import { expandFileMentions } from '../repl/file-mentions'
import { routeInput } from '../repl/input-router'
import { readModelSelection } from '../session/model-selection'
import { cleanupAllMCPClients } from '../tools/mcp'
import {
  clearWorkflowMessages,
  findLatestWorkflowScript,
  formatWorkflowCommandHelp,
  parseWorkflowCommand,
} from '../workflows/workflow-command'
import { buildWorkflowEditPrompt, buildWorkflowRunPrompt } from '../workflows/workflow-prompt'
import { bootstrapAppRuntime } from './bootstrap'
import type { AppRuntime } from './bootstrap'
import type { HeadlessLaunchOptions, HeadlessPermissionMode, LaunchMode, OutputFormat } from './launch-options'
import type { StreamEvent } from './stream-events'

const TOOL_NAME_ALIASES: Record<string, string> = {
  read: 'read',
  readfile: 'readFile',
  glob: 'glob',
  globfiles: 'globFiles',
  grep: 'grep',
  grepfiles: 'grepFiles',
  search: 'grep',
  searchfiles: 'searchFiles',
  write: 'write',
  writefile: 'writeFile',
  edit: 'edit',
  editfile: 'editFile',
  patch: 'patchFile',
  patchfile: 'patchFile',
  bash: 'bash',
  shell: 'bash',
  exec: 'bash',
  executeshell: 'executeShell',
  task: 'spawnAgent',
  spawnagent: 'spawnAgent',
  slashcommand: 'slashCommand',
  readtaskoutput: 'readTaskOutput',
  listtasks: 'listTasks',
  taskstatus: 'getTaskStatus',
  gettaskstatus: 'getTaskStatus',
  canceltask: 'cancelTask',
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

type StreamJsonEvent = StreamEvent

type HeadlessPreparedInput =
  | { kind: 'run'; prompt: string; hiddenContext?: string }
  | { kind: 'local'; output: string; isError?: boolean }

export async function prepareHeadlessInput(
  runtime: AppRuntime,
  input: string,
): Promise<HeadlessPreparedInput> {
  const routed = routeInput(input)

  if (routed.kind === 'prompt' || ('channel' in routed && routed.channel === 'template')) {
    const expansion = await expandFileMentions(input)
    if (expansion.files.length > 0) {
      return { kind: 'run', prompt: expansion.content }
    }
  }

  if (routed.kind === 'prompt') {
    return routed.value
      ? { kind: 'run', prompt: routed.value }
      : { kind: 'local', output: '' }
  }

  if (routed.channel === 'shell') {
    if (!routed.argument) {
      return { kind: 'local', output: 'Usage: !<command>', isError: true }
    }
    await pushConversationMessage(runtime, 'user', routed.raw)
    const result = await runtime.runShellCommand(routed.argument, { background: false })
    await pushConversationMessage(runtime, 'assistant', result.output)
    return { kind: 'local', output: result.output }
  }

  if (routed.channel === 'memory') {
    if (!routed.argument) {
      return { kind: 'local', output: 'Usage: # <memory entry>', isError: true }
    }
    await pushConversationMessage(runtime, 'user', routed.raw)
    const confirmation = await runtime.saveMemoryEntry(routed.argument)
    await pushConversationMessage(runtime, 'system', confirmation)
    return { kind: 'local', output: confirmation }
  }

  if (routed.kind === 'local-ui') {
    return {
      kind: 'local',
      output: `/${routed.name} is only available in the interactive TUI.`,
      isError: true,
    }
  }

  if (routed.channel === 'template') {
    const execution = await executePromptTemplate(routed.name, routed.argument)
    if (!execution) {
      return { kind: 'local', output: `Unknown prompt template: @${routed.name}`, isError: true }
    }
    return { kind: 'run', prompt: execution.content }
  }

  if (routed.channel !== 'slash') {
    return { kind: 'run', prompt: input.trim() }
  }

  if (routed.name === 'clear' || routed.name === 'reset') {
    await runtime.resetConversation()
    return { kind: 'local', output: 'Started a new conversation.' }
  }

  if (routed.name === 'compact') {
    const result = await runtime.conversationRunner.compact()
    return {
      kind: 'local',
      output: result.compacted
        ? `Compacted conversation: ${result.summarizedCount} older messages summarized.`
        : 'No compaction needed; context is within limits.',
    }
  }

  if (routed.name === 'fork') {
    const result = await runtime.forkConversation(routed.argument || undefined)
    return {
      kind: 'local',
      output: `Forked conversation -> ${result.conversationId.slice(0, 8)} (${result.messageCount} messages copied).`,
    }
  }

  if (routed.name === 'tree') {
    const tree = await runtime.getConversationTree()
    return { kind: 'local', output: `Conversation tree:\n\n${tree}` }
  }

  if (routed.name === 'goal') {
    return prepareHeadlessGoalInput(runtime, routed.argument)
  }

  if (routed.name === 'workflow') {
    return prepareHeadlessWorkflowInput(runtime, routed.argument)
  }

  if (routed.name === 'skill') {
    const [skillName = '', ...taskParts] = routed.argument.split(/\s+/)
    const task = taskParts.join(' ').trim()
    if (!skillName) {
      return { kind: 'local', output: 'Usage: /skill <name> [prompt]', isError: true }
    }
    const activation = await activateSkill(skillName)
    const prompt = [
      `Use the installed skill "${activation.name}" for this task.`,
      '',
      task ? `User task: ${task}` : 'Acknowledge that the skill is ready to use.',
    ].join('\n')
    return { kind: 'run', prompt, hiddenContext: activation.content }
  }

  let execution
  try {
    execution = await executeSlashCommand(routed.name, routed.argument, {
      allowDisabledModelInvocation: true,
    })
  } catch (error) {
    return {
      kind: 'local',
      output: `Could not run /${routed.name}: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }

  const rendered = await runtime.hookManager.runCommandBefore({
    command: execution.command,
    sessionID: runtime.conversationStore.getSnapshot().conversationId,
    arguments: execution.arguments,
    content: formatSlashCommandMessage(execution),
  })
  await runtime.hookManager.emit({
    type: 'command.executed',
    sessionID: runtime.conversationStore.getSnapshot().conversationId,
    data: { command: execution.command, arguments: execution.arguments },
  })
  return { kind: 'run', prompt: rendered }
}

async function prepareHeadlessGoalInput(
  runtime: AppRuntime,
  argument: string,
): Promise<HeadlessPreparedInput> {
  const command = parseGoalCommand(argument)
  const currentMessages = runtime.conversationStore.getSnapshot().messages

  if (command.action === 'show') {
    const goal = getConversationGoal(currentMessages)
    return { kind: 'local', output: goal ? `Current goal: ${goal}` : 'No goal is set. Use /goal <goal> to set one.' }
  }

  if (command.action === 'clear') {
    await runtime.conversationStore.replaceMessages(clearConversationGoal(currentMessages))
    return { kind: 'local', output: 'Cleared the conversation goal.' }
  }

  if (command.action === 'set') {
    if (!command.goal) {
      return { kind: 'local', output: 'Usage: /goal set <goal>', isError: true }
    }
    await runtime.conversationStore.replaceMessages(setConversationGoal(currentMessages, command.goal))
    const goal = getConversationGoal(runtime.conversationStore.getSnapshot().messages) ?? command.goal
    return { kind: 'local', output: `Goal saved: ${goal}` }
  }

  const goal = command.goal ?? getConversationGoal(currentMessages)
  if (!goal) {
    return { kind: 'local', output: 'No goal is set. Use /goal run <goal> or /goal <goal> first.', isError: true }
  }

  await runtime.conversationStore.replaceMessages(setConversationGoal(currentMessages, goal))
  return { kind: 'run', prompt: buildGoalRunPrompt(goal) }
}

async function prepareHeadlessWorkflowInput(
  runtime: AppRuntime,
  argument: string,
): Promise<HeadlessPreparedInput> {
  const command = parseWorkflowCommand(argument)

  if (command.action === 'help') {
    return { kind: 'local', output: formatWorkflowCommandHelp() }
  }

  if (command.action === 'clear') {
    const result = clearWorkflowMessages(runtime.conversationStore.getSnapshot().messages)
    if (result.removedCount === 0) {
      return { kind: 'local', output: 'No workflow result messages found in this conversation.' }
    }
    await runtime.conversationStore.replaceMessages(result.messages)
    return {
      kind: 'local',
      output: `Cleared ${result.removedCount} workflow result message${result.removedCount === 1 ? '' : 's'}.`,
    }
  }

  if (command.action === 'stop') {
    return { kind: 'local', output: 'Active workflows run inside the current generation. Press Ctrl+C to abort the active workflow or model run.' }
  }

  if (command.action === 'edit') {
    if (!command.change) {
      return { kind: 'local', output: 'Usage: /workflow edit <change>', isError: true }
    }
    const previousScript = findLatestWorkflowScript(runtime.conversationStore.getSnapshot().messages)
    if (!previousScript) {
      return { kind: 'local', output: 'No previous workflow script found to edit.', isError: true }
    }
    return { kind: 'run', prompt: buildWorkflowEditPrompt(previousScript, command.change) }
  }

  if (!command.task) {
    return { kind: 'local', output: 'Usage: /workflow <task>', isError: true }
  }
  return { kind: 'run', prompt: buildWorkflowRunPrompt(command.task) }
}

async function pushConversationMessage(
  runtime: AppRuntime,
  role: 'assistant' | 'system' | 'user',
  content: string,
): Promise<void> {
  await runtime.conversationStore.pushMessage({
    id: generateId(),
    role,
    content,
    timestamp: new Date().toISOString(),
  })
}

export async function runHeadless(options: RunHeadlessOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const { headless } = options

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
        const contents = await Bun.file(filePath).text()
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
  const apiKey = getProviderCredential('openrouter')?.apiKey ?? ''

  const permissionMode: PermissionMode = headless.permissionMode
    ? mapPermissionMode(headless.permissionMode)
    : 'Auto-accept'
  runtime.permissionEngine.setMode(permissionMode)
  const resolvedPermissionRequestIds = new Set<string>()
  const unsubscribePermissions = runtime.permissionEngine.subscribe(() => {
    const activeRequest = runtime.permissionEngine.getSnapshot().activeRequest
    if (!activeRequest || resolvedPermissionRequestIds.has(activeRequest.id)) {
      return
    }
    resolvedPermissionRequestIds.add(activeRequest.id)
    void runtime.permissionEngine.resolve(activeRequest.id, 'deny')
  })

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

  const format: OutputFormat = headless.outputFormat
  const startTime = Date.now()

  const emitJsonLine = (event: StreamJsonEvent) => {
    stdout.write(`${JSON.stringify(event)}\n`)
  }

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  let exitCode = 0
  let finalAssistant = ''
  let errorMessage: string | undefined
  let prepared: HeadlessPreparedInput | null = null

  try {
    prepared = await prepareHeadlessInput(runtime, trimmedPrompt)
  } catch (error) {
    prepared = {
      kind: 'local',
      output: error instanceof Error ? error.message : String(error),
      isError: true,
    }
  }

  if (prepared.kind === 'local') {
    finalAssistant = prepared.output
    errorMessage = prepared.isError ? prepared.output : undefined
    exitCode = prepared.isError ? 1 : 0
  }

  const selection = await readModelSelection().catch(() => null)
  const modelId = selection?.modelId ?? defaultModel
  const reasoningEffort = selection?.reasoningEffort ?? null
  const providerSlug = selection?.providerSlug ?? null

  if (prepared.kind === 'run' && !modelId) {
    stderr.write('Error: no model selected. Set GAMBIT_MODEL/OPENROUTER_MODEL or choose one in the TUI with :model <model-id>.\n')
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    unsubscribePermissions()
    await cleanupAllMCPClients().catch(() => undefined)
    return 1
  }

  if (prepared.kind === 'run') {
    const directProviderRef = parseDirectProviderModelId(modelId!)
    if (directProviderRef && !isProviderConnected(directProviderRef.providerId)) {
      const name = getDirectProviderDefinition(directProviderRef.providerId).name
      stderr.write(`Error: ${name} is not connected. Run /connect ${directProviderRef.providerId} in the TUI first.\n`)
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      unsubscribePermissions()
      await cleanupAllMCPClients().catch(() => undefined)
      return 1
    }

    if (!directProviderRef && modelNeedsOpenRouterApiKey(modelId!) && !apiKey) {
      stderr.write('Error: an OpenRouter API key is required for -p mode with OpenRouter models. Run /connect openrouter in the TUI first.\n')
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      unsubscribePermissions()
      await cleanupAllMCPClients().catch(() => undefined)
      return 1
    }
  }

  if (format === 'stream-json') {
    emitJsonLine({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      model: modelId ?? '',
      provider: providerSlug,
      cwd: process.cwd(),
      permission_mode: permissionMode,
      tools: allowedToolIds ?? null,
    })
    emitJsonLine({
      type: 'user',
      session_id: sessionId,
      message: { role: 'user', content: prepared.kind === 'run' ? prepared.prompt : trimmedPrompt },
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

        if (format === 'stream-json' && headless.verbose) {
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

  try {
    if (prepared.kind === 'run') {
      if (prepared.hiddenContext?.trim()) {
        await runtime.conversationStore.pushMessage({
          id: generateId(),
          role: 'system',
          content: prepared.hiddenContext,
          hidden: true,
          timestamp: new Date().toISOString(),
        })
      }

      await runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'user',
        content: prepared.prompt,
        timestamp: new Date().toISOString(),
      })

      const turn = await runtime.conversationRunner.runTurn({
        userInput: prepared.prompt,
        apiKey,
        modelId: modelId!,
        reasoningEffort,
        providerSlug,
        signal: controller.signal,
        allowedToolIds,
        systemPromptOverride: headless.systemPromptOverride,
        appendSystemPrompt: appendSystemPrompt || undefined,
      })

      finalAssistant = turn.assistantOutput ?? ''
    }

    if (format === 'text') {
      if (prepared.kind === 'local') {
        if (!prepared.isError) {
          stdout.write(finalAssistant ? `${finalAssistant}\n` : '')
        }
      } else {
        stdout.write('\n')
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    exitCode = 1
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    unsubscribe()
    unsubscribePermissions()

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
        model: modelId ?? '',
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
        model: modelId ?? '',
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
