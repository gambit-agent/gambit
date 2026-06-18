import { useCallback } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import {
  buildGoalRunPrompt,
  clearConversationGoal,
  getConversationGoal,
  parseGoalCommand,
  setConversationGoal,
} from '../../conversation/goal'
import { generateId } from '../../lib/id'
import { modelRequiresApiKey, type ReasoningEffort } from '../../lib/model'
import {
  buildPromptTemplateListDescription,
  executePromptTemplate,
  loadPromptTemplates,
} from '../../lib/promptTemplates'
import {
  clearWorkflowMessages,
  findLatestWorkflowScript,
  formatWorkflowCommandHelp,
  parseWorkflowCommand,
} from '../../workflows/workflow-command'
import { buildWorkflowEditPrompt, buildWorkflowRunPrompt } from '../../workflows/workflow-prompt'
import { executeSlashCommand, loadSlashCommands, type SlashCommandExecution } from '../../lib/slashCommands'
import { activateSkill, loadSkills } from '../../lib/skills'
import { formatSlashCommandMessage } from '../../lib/slash-command-format'
import { formatInteractiveHelp, formatUnknownSlashCommandMessage } from '../help'
import { routeInput } from '../input-router'
import { expandFileMentions } from '../file-mentions'

interface SubmitConversationSnapshot {
  conversationId: string
  initialized: boolean
  status: 'idle' | 'running'
}

interface RunConfig {
  modelId: string
  apiKey: string
}

export function useReplSubmit({
  runtime,
  conversation,
  modelId,
  apiKey,
  reasoningEffort,
  providerSlug,
  thinkingEnabled,
  clearComposer,
  openModelPicker,
  openSessionPicker,
  startFreshConversation,
  persistApiKey,
  persistModelSelection,
  handleModelFilterSubmit,
  modelPickerFetchState,
  setMcpOverlayOpen,
  openThemesPicker,
}: {
  runtime: AppRuntime
  conversation: SubmitConversationSnapshot
  modelId: string | null
  apiKey: string
  reasoningEffort: ReasoningEffort | null
  providerSlug: string | null
  thinkingEnabled: boolean
  clearComposer: () => void
  openModelPicker: (query?: string) => void
  openSessionPicker: (query?: string) => void
  startFreshConversation: () => Promise<void>
  persistApiKey: (nextApiKey: string) => void
  persistModelSelection: (nextModelId: string, nextReasoningEffort: ReasoningEffort | null) => void
  handleModelFilterSubmit: (value: string) => void
  modelPickerFetchState: string
  setMcpOverlayOpen: (open: boolean) => void
  openThemesPicker: () => void
}) {
  const getRunConfig = useCallback(
    (action: string): RunConfig | null => {
      const selectedModelId = modelId?.trim()
      if (!selectedModelId) {
        runtime.conversationStore.setError(`Select a model before ${action} (/model).`)
        return null
      }

      const trimmedKey = apiKey.trim()
      if (modelRequiresApiKey(selectedModelId) && !trimmedKey) {
        runtime.conversationStore.setError(`Set an OpenRouter API key before ${action} (/key <token>).`)
        return null
      }

      return { modelId: selectedModelId, apiKey: trimmedKey }
    },
    [apiKey, modelId, runtime.conversationStore],
  )

  const runUserPrompt = useCallback(
    async (prompt: string, signal: AbortSignal) => {
      const runConfig = getRunConfig('chatting')
      if (!runConfig) {
        return
      }

      if (!conversation.initialized) {
        await runtime.resetConversation()
      }

      await runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      })

      try {
        await runtime.conversationRunner.runTurn({
          userInput: prompt,
          apiKey: runConfig.apiKey,
          modelId: runConfig.modelId,
          reasoningEffort,
          providerSlug,
          showReasoning: thinkingEnabled,
          signal,
        })
      } catch {
        // Error already surfaced via conversationStore.setError by the runner.
      }
    },
    [conversation.initialized, getRunConfig, providerSlug, reasoningEffort, runtime, thinkingEnabled],
  )

  const handleGoalCommand = useCallback(
    async (
      argument: string,
      commandName: ':goal' | '/goal',
      goalSignal: AbortSignal,
    ): Promise<boolean> => {
      const command = parseGoalCommand(argument)
      const currentMessages = runtime.conversationStore.getSnapshot().messages

      if (command.action === 'show') {
        const goal = getConversationGoal(currentMessages)
        await pushSystemMessage(runtime, goal ? `Current goal: ${goal}` : `No goal is set. Use ${commandName} <goal> to set one.`)
        return true
      }

      if (command.action === 'clear') {
        await runtime.conversationStore.replaceMessages(clearConversationGoal(currentMessages))
        await pushSystemMessage(runtime, 'Cleared the conversation goal.')
        return true
      }

      if (command.action === 'set') {
        if (!command.goal) {
          runtime.conversationStore.setError(`Usage: ${commandName} set <goal>`)
          return true
        }

        await runtime.conversationStore.replaceMessages(setConversationGoal(currentMessages, command.goal))
        const goal = getConversationGoal(runtime.conversationStore.getSnapshot().messages) ?? command.goal
        await pushSystemMessage(runtime, `Goal saved: ${goal}`)
        return true
      }

      const goal = command.goal ?? getConversationGoal(currentMessages)
      if (!goal) {
        runtime.conversationStore.setError(
          `No goal is set. Use ${commandName} run <goal> or ${commandName} <goal> first.`,
        )
        return true
      }

      const runConfig = getRunConfig('running a goal')
      if (!runConfig) {
        return true
      }

      await runtime.conversationStore.replaceMessages(setConversationGoal(currentMessages, goal))
      const prompt = buildGoalRunPrompt(goal)
      await runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      })

      try {
        await runtime.conversationRunner.runTurn({
          userInput: prompt,
          apiKey: runConfig.apiKey,
          modelId: runConfig.modelId,
          reasoningEffort,
          providerSlug,
          showReasoning: thinkingEnabled,
          signal: goalSignal,
        })
      } catch {
        // Error already surfaced via conversationStore.setError by the runner.
      }
      return true
    },
    [getRunConfig, providerSlug, reasoningEffort, runtime, thinkingEnabled],
  )

  return useCallback(
    async (value: string, { signal }: { signal: AbortSignal }) => {
      const routed = routeInput(value)
      if (routed.kind === 'prompt' || ('channel' in routed && routed.channel === 'template')) {
        const expansion = await expandFileMentions(value)
        if (expansion.files.length > 0) {
          await runUserPrompt(expansion.content, signal)
          return
        }
      }

      if (routed.kind === 'prompt') {
        if (!routed.value) {
          return
        }
        await runUserPrompt(routed.value, signal)
        return
      }

      if (routed.channel === 'shell') {
        if (!routed.argument) {
          runtime.conversationStore.setError('Usage: !<command>')
          return
        }

        await runtime.conversationStore.pushMessage({
          id: generateId(),
          role: 'user',
          content: routed.raw,
          timestamp: new Date().toISOString(),
        })

        const result = await runtime.runShellCommand(routed.argument, { background: false })
        await runtime.conversationStore.pushMessage({
          id: generateId(),
          role: 'assistant',
          content: result.output,
          timestamp: new Date().toISOString(),
        })
        return
      }

      if (routed.channel === 'memory') {
        if (!routed.argument) {
          runtime.conversationStore.setError('Usage: # <memory entry>')
          return
        }

        await runtime.conversationStore.pushMessage({
          id: generateId(),
          role: 'user',
          content: routed.raw,
          timestamp: new Date().toISOString(),
        })
        const confirmation = await runtime.saveMemoryEntry(routed.argument)
        await pushSystemMessage(runtime, confirmation)
        return
      }

      if (routed.kind === 'local-ui' && routed.channel === 'slash' && routed.name === 'model') {
        clearComposer()
        openModelPicker(routed.argument)
        if (routed.argument && modelPickerFetchState === 'success') {
          handleModelFilterSubmit(routed.argument)
        }
        return
      }

      if (routed.kind === 'local-ui' && routed.channel === 'slash' && routed.name === 'resume') {
        clearComposer()
        openSessionPicker(routed.argument)
        return
      }

      if (routed.kind === 'local-ui' && routed.channel === 'slash' && routed.name === 'themes') {
        clearComposer()
        openThemesPicker()
        return
      }

      if (routed.channel === 'template') {
        const execution = await executePromptTemplate(routed.name, routed.argument)
        if (!execution) {
          runtime.conversationStore.setError(`Unknown prompt template: @${routed.name}`)
          return
        }

        await runUserPrompt(execution.content, signal)
        return
      }

      if (routed.channel === 'slash') {
        if (routed.name === 'help') {
          const [commands, templates, skills] = await Promise.all([
            loadSlashCommands(),
            loadPromptTemplates(),
            loadSkills(),
          ])
          await pushSystemMessage(runtime, formatInteractiveHelp(
            commands,
            buildPromptTemplateListDescription(templates),
            skills,
          ))
          return
        }

        if (routed.name === 'clear') {
          await startFreshConversation()
          return
        }

        if (routed.name === 'reset') {
          await startFreshConversation()
          return
        }

        if (routed.name === 'key') {
          if (!routed.argument) {
            runtime.conversationStore.setError('Usage: /key <OPENROUTER_API_KEY>')
            return
          }
          persistApiKey(routed.argument)
          await pushSystemMessage(
            runtime,
            `Saved OpenRouter API key to user config (${routed.argument.trim().length} characters provided).`,
          )
          return
        }

        if (routed.name === 'mcp') {
          setMcpOverlayOpen(true)
          return
        }

        if (routed.name === 'compact') {
          if (conversation.status === 'running') {
            runtime.conversationStore.setError('Finish or cancel the current run before compacting.')
            return
          }
          const selectedModelId = modelId?.trim()
          if (!selectedModelId) {
            runtime.conversationStore.setError('Select a model before compacting (/model).')
            return
          }
          try {
            const result = await runtime.conversationRunner.compact({
              apiKey: apiKey.trim() || undefined,
              modelId: selectedModelId,
            })
            await pushSystemMessage(
              runtime,
              result.compacted
                ? `Compacted conversation: ${result.summarizedCount} older messages summarized.`
                : 'No compaction needed — context is within limits.',
            )
          } catch (error) {
            runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
          }
          return
        }

        if (routed.name === 'fork') {
          if (conversation.status === 'running') {
            runtime.conversationStore.setError('Finish or cancel the current run before forking.')
            return
          }
          try {
            const result = await runtime.forkConversation(routed.argument || undefined)
            await pushSystemMessage(
              runtime,
              `Forked conversation -> ${result.conversationId.slice(0, 8)} (${result.messageCount} messages copied).`,
            )
          } catch (error) {
            runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
          }
          return
        }

        if (routed.name === 'tree') {
          try {
            const tree = await runtime.getConversationTree()
            await pushSystemMessage(runtime, `Conversation tree:\n\n${tree}`)
          } catch (error) {
            runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
          }
          return
        }

        if (routed.name === 'goal') {
          if (await handleGoalCommand(routed.argument, '/goal', signal)) {
            return
          }
        }

        if (routed.name === 'workflow') {
          const workflowCommand = parseWorkflowCommand(routed.argument)
          if (workflowCommand.action === 'help') {
            await pushSystemMessage(runtime, formatWorkflowCommandHelp())
            return
          }

          if (workflowCommand.action === 'clear') {
            const currentMessages = runtime.conversationStore.getSnapshot().messages
            const result = clearWorkflowMessages(currentMessages)
            if (result.removedCount === 0) {
              await pushSystemMessage(runtime, 'No workflow result messages found in this conversation.')
              return
            }
            await runtime.conversationStore.replaceMessages(result.messages)
            await pushSystemMessage(runtime, `Cleared ${result.removedCount} workflow result message${result.removedCount === 1 ? '' : 's'}.`)
            return
          }

          if (workflowCommand.action === 'stop') {
            await pushSystemMessage(runtime, 'Active workflows run inside the current generation. Press Ctrl+C to abort the active workflow or model run.')
            return
          }

          if (workflowCommand.action === 'edit') {
            if (!workflowCommand.change) {
              runtime.conversationStore.setError('Usage: /workflow edit <change>')
              return
            }
            const previousScript = findLatestWorkflowScript(runtime.conversationStore.getSnapshot().messages)
            if (!previousScript) {
              runtime.conversationStore.setError('No previous workflow script found to edit.')
              return
            }
            await runUserPrompt(buildWorkflowEditPrompt(previousScript, workflowCommand.change), signal)
            return
          }

          if (!workflowCommand.task) {
            runtime.conversationStore.setError('Usage: /workflow <task>')
            return
          }

          await runUserPrompt(buildWorkflowRunPrompt(workflowCommand.task), signal)
          return
        }

        if (routed.name === 'skill') {
          const [skillName = '', ...taskParts] = routed.argument.split(/\s+/)
          const task = taskParts.join(' ').trim()

          if (!skillName) {
            runtime.conversationStore.setError('Usage: /skill <name> [prompt]')
            return
          }

          try {
            const activation = await activateSkill(skillName)
            const prompt = [
              `Use the installed skill "${activation.name}" for this task.`,
              '',
              activation.content,
              task ? ['User task:', task].join('\n') : 'User task: acknowledge that the skill is ready to use.',
            ].join('\n')
            await runUserPrompt(prompt, signal)
          } catch (error) {
            runtime.conversationStore.setError(
              error instanceof Error ? error.message : String(error),
            )
          }
          return
        }

        let execution: SlashCommandExecution
        try {
          execution = await executeSlashCommand(routed.name, routed.argument, {
            allowDisabledModelInvocation: true,
          })
        } catch (error) {
          const commands = await loadSlashCommands()
          const message =
            error instanceof Error && error.message.startsWith('Slash command not found:')
              ? formatUnknownSlashCommandMessage(routed.name, commands)
              : `Could not run /${routed.name}: ${error instanceof Error ? error.message : String(error)}`
          await pushSystemMessage(runtime, message)
          return
        }

        const rendered = await runtime.hookManager.runCommandBefore({
          command: execution.command,
          sessionID: conversation.conversationId,
          arguments: execution.arguments,
          content: formatSlashCommandMessage(execution),
        })
        await runtime.hookManager.emit({
          type: 'command.executed',
          sessionID: conversation.conversationId,
          data: { command: execution.command, arguments: execution.arguments },
        })
        await runtime.conversationStore.pushMessage({
          id: generateId(),
          role: 'user',
          content: rendered,
          timestamp: new Date().toISOString(),
        })

        const runConfig = getRunConfig('chatting')
        if (!runConfig) {
          return
        }

        try {
          await runtime.conversationRunner.runTurn({
            userInput: rendered,
            apiKey: runConfig.apiKey,
            modelId: runConfig.modelId,
            reasoningEffort,
            providerSlug,
            showReasoning: thinkingEnabled,
            signal,
          })
        } catch {
          // Error already surfaced via conversationStore.setError by the runner.
        }
      }
    },
    [
      clearComposer,
      conversation.conversationId,
      conversation.status,
      getRunConfig,
      handleGoalCommand,
      handleModelFilterSubmit,
      apiKey,
      modelPickerFetchState,
      modelId,
      openModelPicker,
      openSessionPicker,
      persistApiKey,
      providerSlug,
      reasoningEffort,
      runUserPrompt,
      runtime,
      setMcpOverlayOpen,
      openThemesPicker,
      startFreshConversation,
      thinkingEnabled,
    ],
  )
}

async function pushSystemMessage(
  runtime: AppRuntime,
  content: string,
): Promise<void> {
  await runtime.conversationStore.pushMessage({
    id: generateId(),
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
  })
}
