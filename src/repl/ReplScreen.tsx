import { MouseButton, TextAttributes, type MouseEvent, type ParsedKey, type ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/react'
import { randomUUID } from 'node:crypto'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import { defaultModel } from '../config'
import { useAppRuntime, useConversationSnapshot, usePermissionSnapshot, useTaskSnapshot } from '../app/providers'
import { copyTextToClipboard } from '../lib/clipboard'
import { useModelPicker } from '../lib/modelPicker'
import type { ReasoningEffort } from '../lib/model'
import { executeSlashCommand, type SlashCommandExecution } from '../lib/slashCommands'
import { useInteractiveController } from '../lib/interactive/controller'
import type { UIMessage } from '../types/chat'
import { routeInput } from './input-router'
import { layout, theme } from '../ui/theme'
import { ModelPickerOverlay } from '../ui/model-picker/ModelPickerOverlay'
import { ConversationPanel } from '../ui/panels/ConversationPanel'
import { TaskPanel } from '../ui/panels/TaskPanel'
import { PermissionOverlay } from '../ui/overlays/PermissionOverlay'

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function formatSlashCommandMessage(execution: SlashCommandExecution): string {
  const scopeLabel = execution.namespace ? `${execution.scope}:${execution.namespace}` : execution.scope
  const header: string[] = [`Command · ${execution.command}`, `Scope · ${scopeLabel}`]

  if (execution.arguments) {
    header.push(`Arguments · ${execution.arguments}`)
  }
  if (execution.allowedTools.length > 0) {
    header.push(`Allowed tools · ${execution.allowedTools.join(', ')}`)
  }
  if (execution.model) {
    header.push(`Preferred model · ${execution.model}`)
  }

  const headerBlock = header.join('\n')
  return execution.content ? `${headerBlock}\n\n${execution.content}` : headerBlock
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }
  parts.push(`${seconds}s`)

  return parts.join(' ')
}

export function ReplScreen() {
  const renderer = useRenderer()
  const runtime = useAppRuntime()
  const conversation = useConversationSnapshot()
  const taskSnapshot = useTaskSnapshot()
  const permissionSnapshot = usePermissionSnapshot()
  const [inputValue, setInputValue] = useState('')
  const [inputPreview, setInputPreview] = useState<string | null>(null)
  const [modelId, setModelId] = useState(defaultModel)
  const [apiKey, setApiKey] = useState<string>(Bun.env.OPENROUTER_API_KEY ?? '')
  const [statusElapsed, setStatusElapsed] = useState<string | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const statusStartedAtRef = useRef<Date | null>(null)
  const interactiveMessages = useMemo<UIMessage[]>(
    () =>
      conversation.messages.map((message) => ({
        ...message,
        timestamp: new Date(message.timestamp),
      })),
    [conversation.messages],
  )

  const modelPicker = useModelPicker({
    apiKey: apiKey.trim().length > 0 ? apiKey.trim() : null,
    currentModelId: modelId,
    currentReasoning: reasoningEffort,
    onSelect: (model, effort) => {
      setModelId(model.id)
      setReasoningEffort(effort)
      void runtime.conversationStore.pushMessage({
        id: randomUUID(),
        role: 'system',
        content: `Model set to ${model.id}${effort ? ` with ${effort} reasoning effort` : ''}.`,
        timestamp: new Date().toISOString(),
      })
    },
  })

  const {
    state: modelPickerState,
    open: openModelPicker,
    moveSelection: moveModelSelection,
    close: closeModelPicker,
    handleFilterChange: handleModelFilterChange,
    handleFilterSubmit,
    handleReasoningInput,
    handleReasoningSubmit,
    selectByIndex: selectModelByIndex,
    setSelection: setModelSelection,
  } = modelPicker

  useEffect(() => {
    const scrollbox = scrollboxRef.current
    if (!scrollbox) {
      return
    }

    const viewportHeight = scrollbox.viewport.height ?? 0
    const maxScrollTop = Math.max(0, scrollbox.scrollHeight - viewportHeight)
    scrollbox.scrollTo(maxScrollTop)
  }, [conversation.messages])

  useEffect(() => {
    if (conversation.status !== 'running') {
      statusStartedAtRef.current = null
      setStatusElapsed(null)
      return
    }

    statusStartedAtRef.current = new Date()
    setStatusElapsed(formatDuration(0))
    const intervalId = setInterval(() => {
      const startedAt = statusStartedAtRef.current
      if (!startedAt) {
        return
      }
      setStatusElapsed(formatDuration(Date.now() - startedAt.getTime()))
    }, 1000)

    return () => {
      clearInterval(intervalId)
    }
  }, [conversation.status])

  useKeyboard(
    useCallback(
      async (key: ParsedKey) => {
        if (permissionSnapshot.activeRequest) {
          if (key.name === 'y') {
            await runtime.permissionEngine.resolve(permissionSnapshot.activeRequest.id, 'allow')
            return
          }
          if (key.name === 'n' || key.name === 'escape') {
            await runtime.permissionEngine.resolve(permissionSnapshot.activeRequest.id, 'deny')
            return
          }
        }

        if (!modelPickerState.isOpen) {
          return
        }

        if (key.name === 'escape') {
          closeModelPicker()
          return
        }

        if (modelPickerState.mode === 'list') {
          if (key.name === 'up') {
            moveModelSelection(-1)
            return
          }
          if (key.name === 'down') {
            moveModelSelection(1)
          }
        }
      },
      [closeModelPicker, modelPickerState.isOpen, modelPickerState.mode, moveModelSelection, permissionSnapshot.activeRequest, runtime.permissionEngine],
    ),
  )

  const performSubmit = useCallback(
    async (value: string, { signal }: { signal: AbortSignal }) => {
      const routed = routeInput(value)
      if (routed.kind === 'prompt') {
        if (!routed.value) {
          setInputValue('')
          return
        }

        if (!apiKey.trim()) {
          runtime.conversationStore.setError('Set an OpenRouter API key before chatting (:key <token>).')
          return
        }

        const userMessage = {
          id: randomUUID(),
          role: 'user' as const,
          content: routed.value,
          timestamp: new Date().toISOString(),
        }
        await runtime.conversationStore.pushMessage(userMessage)
        await runtime.conversationRunner.runTurn({
          userInput: routed.value,
          apiKey: apiKey.trim(),
          modelId,
          reasoningEffort,
          showReasoning: thinkingEnabled,
          signal,
        })
        return
      }

      if (routed.channel === 'colon') {
        if (routed.name === 'model') {
          if (!routed.argument) {
            runtime.conversationStore.setError('Usage: :model <model-id>')
            return
          }
          setModelId(routed.argument)
          setReasoningEffort(null)
          await runtime.conversationStore.pushMessage({
            id: randomUUID(),
            role: 'system',
            content: `Model set to ${routed.argument}`,
            timestamp: new Date().toISOString(),
          })
          return
        }

        if (routed.name === 'key') {
          if (!routed.argument) {
            runtime.conversationStore.setError('Usage: :key <OPENROUTER_API_KEY>')
            return
          }
          setApiKey(routed.argument)
          await runtime.conversationStore.pushMessage({
            id: randomUUID(),
            role: 'system',
            content: `Updated OpenRouter API key (${routed.argument.length} characters provided).`,
            timestamp: new Date().toISOString(),
          })
          return
        }

        if (routed.name === 'reset') {
          runtime.resetConversation()
          return
        }

        runtime.conversationStore.setError(`Unknown command: ${routed.name}`)
        return
      }

      if (routed.channel === 'shell') {
        if (!routed.argument) {
          runtime.conversationStore.setError('Usage: !<command>')
          return
        }

        await runtime.conversationStore.pushMessage({
          id: randomUUID(),
          role: 'user',
          content: routed.raw,
          timestamp: new Date().toISOString(),
        })

        const result = await runtime.runShellCommand(routed.argument, { background: false })
        await runtime.conversationStore.pushMessage({
          id: randomUUID(),
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
          id: randomUUID(),
          role: 'user',
          content: routed.raw,
          timestamp: new Date().toISOString(),
        })
        const confirmation = await runtime.saveMemoryEntry(routed.argument)
        await runtime.conversationStore.pushMessage({
          id: randomUUID(),
          role: 'system',
          content: confirmation,
          timestamp: new Date().toISOString(),
        })
        return
      }

      if (routed.kind === 'local-ui' && routed.channel === 'slash' && routed.name === 'model') {
        openModelPicker(routed.argument)
        if (routed.argument && modelPickerState.fetchState === 'success') {
          handleFilterSubmit(routed.argument)
        }
        return
      }

      if (routed.channel === 'slash') {
        if (routed.name === 'clear') {
          runtime.resetConversation()
          return
        }

        const execution = await executeSlashCommand(routed.name, routed.argument)
        const rendered = formatSlashCommandMessage(execution)
        await runtime.conversationStore.pushMessage({
          id: randomUUID(),
          role: 'user',
          content: rendered,
          timestamp: new Date().toISOString(),
        })

        if (!apiKey.trim()) {
          runtime.conversationStore.setError('Set an OpenRouter API key before chatting (:key <token>).')
          return
        }

        await runtime.conversationRunner.runTurn({
          userInput: rendered,
          apiKey: apiKey.trim(),
          modelId,
          reasoningEffort,
          showReasoning: thinkingEnabled,
          signal,
        })
      }
    },
    [
      apiKey,
      handleFilterSubmit,
      modelId,
      modelPickerState.fetchState,
      openModelPicker,
      reasoningEffort,
      runtime,
      thinkingEnabled,
    ],
  )

  const setConversationMessages = useCallback(
    (next: SetStateAction<UIMessage[]>) => {
      const resolvedMessages =
        typeof next === 'function' ? next(interactiveMessages) : next

      runtime.conversationStore.reset(
        resolvedMessages.map((message) => ({
          ...message,
          timestamp: message.timestamp.toISOString(),
        })),
      )
    },
    [interactiveMessages, runtime.conversationStore],
  )

  const interactive = useInteractiveController({
    inputValue,
    setInputValue,
    inputPreview,
    setInputPreview,
    messages: interactiveMessages,
    setMessages: setConversationMessages,
    isRunning: conversation.status === 'running',
    permissionMode: permissionSnapshot.mode,
    onCyclePermissionMode: () => {
      runtime.permissionEngine.cycleMode()
    },
    performSubmit,
    onAbort: () => {
      runtime.conversationStore.setError('Generation cancelled.')
      runtime.conversationStore.setStatus('idle')
    },
    onRewind: () => {
      runtime.conversationStore.setError(null)
      runtime.conversationStore.setStatus('idle')
    },
    onBackgroundRequest: (rawCommand) => {
      const routed = routeInput(rawCommand)
      if (routed.kind !== 'local' || routed.channel !== 'shell' || !routed.argument) {
        runtime.conversationStore.setError('Background mode requires a !command input.')
        return false
      }

      void (async () => {
        try {
          const result = await runtime.runShellCommand(routed.argument, { background: true })
          await runtime.conversationStore.pushMessage({
            id: randomUUID(),
            role: 'system',
            content: `Started background task ${result.taskId} (${routed.argument}).`,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
        }
      })()

      return true
    },
  })

  useEffect(() => {
    setThinkingEnabled(interactive.thinkingEnabled)
  }, [interactive.thinkingEnabled])

  const handleInputSubmit = useCallback(
    (value: unknown) => {
      if (typeof value === 'string') {
        void interactive.handleSubmit(value)
      }
    },
    [interactive.handleSubmit],
  )

  const handleMouseUp = useCallback(
    (event: MouseEvent) => {
      if (event.button !== MouseButton.RIGHT) {
        return
      }

      const selection = renderer.getSelection()
      const selectedText = selection?.getSelectedText() ?? ''
      if (!selectedText.trim()) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      void copyTextToClipboard(selectedText).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })
    },
    [renderer, runtime.conversationStore],
  )

  const modelDisplay = reasoningEffort ? `${modelId} (effort: ${reasoningEffort})` : modelId
  const statusDisplay =
    conversation.status === 'running' && statusElapsed ? `running - ${statusElapsed}` : conversation.status
  const isPermissionDialogOpen = Boolean(permissionSnapshot.activeRequest)
  const isMainInputFocused = !modelPickerState.isOpen && !isPermissionDialogOpen
  const isModelPickerFocused = modelPickerState.isOpen && !isPermissionDialogOpen

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      padding={layout.screenPadding}
      gap={layout.sectionGap}
      onMouseUp={handleMouseUp}
      style={{ backgroundColor: theme.background }}
    >
      <box
        flexDirection="column"
        style={{
          border: ['left'],
          borderColor: theme.headerBorder,
          paddingTop: layout.panelPaddingY,
          paddingRight: layout.panelPaddingX,
          paddingBottom: layout.panelPaddingY,
          paddingLeft: layout.panelPaddingX,
          backgroundColor: theme.header,
        }}
      >
        <box justifyContent="space-between" flexDirection="row">
          <ascii-font font="tiny" text="Gambit" />
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
            Model · {modelDisplay}
          </text>
        </box>
      </box>

      {conversation.error ? (
        <box
          style={{
            border: ['left'],
            paddingTop: layout.panelPaddingY,
            paddingRight: layout.panelPaddingX,
            paddingBottom: layout.panelPaddingY,
            paddingLeft: layout.panelPaddingX,
            backgroundColor: theme.systemBg,
          }}
        >
          <text fg="#ff6b6b" content={`Error: ${conversation.error}`} />
        </box>
      ) : null}

      <ConversationPanel messages={conversation.messages} scrollboxRef={scrollboxRef} />

      {interactive.historySearch.active ? (
        <box
          flexDirection="column"
          gap={layout.panelGap}
          style={{
            border: ['left'],
            borderColor: theme.headerBorder,
            backgroundColor: theme.header,
            paddingTop: layout.panelPaddingY,
            paddingRight: layout.panelPaddingX,
            paddingBottom: layout.panelPaddingY,
            paddingLeft: layout.panelPaddingX,
          }}
        >
          <text
            fg={theme.headerAccent}
            attributes={TextAttributes.BOLD}
            content={`reverse-search: ${interactive.historySearch.query || '...'}${
              interactive.historySearch.match ? ` -> ${interactive.historySearch.match}` : ''
            }`}
          />
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content="Esc to cancel, Ctrl+R to search older matches"
          />
        </box>
      ) : null}

      <box
        flexDirection="row"
        flexWrap="wrap"
        gap={layout.statusGap}
        style={{
          border: ['left'],
          borderColor: theme.bodyBorder,
          paddingTop: layout.panelPaddingY,
          paddingRight: layout.panelPaddingX,
          paddingBottom: layout.panelPaddingY,
          paddingLeft: layout.panelPaddingX,
          backgroundColor: theme.background,
        }}
      >
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={`Thinking · ${thinkingEnabled ? 'on' : 'off'}`}
        />
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={`Permissions · ${permissionSnapshot.mode}`}
        />
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`Status · ${statusDisplay}`} />
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={`Updated · ${timestampFormatter.format(new Date())}`}
        />
      </box>

      <TaskPanel tasks={taskSnapshot.tasks} />

      {modelPickerState.isOpen ? (
        <ModelPickerOverlay
          state={modelPickerState}
          currentModelId={modelId}
          hasFocus={isModelPickerFocused}
          onFilterChange={handleModelFilterChange}
          onFilterSubmit={handleFilterSubmit}
          onReasoningChange={handleReasoningInput}
          onReasoningSubmit={handleReasoningSubmit}
          onOptionChange={(index) => setModelSelection(index)}
          onOptionSelect={(index) => selectModelByIndex(index)}
        />
      ) : null}

      {permissionSnapshot.activeRequest ? <PermissionOverlay request={permissionSnapshot.activeRequest} /> : null}

      <box
        flexDirection="column"
        gap={inputPreview ? layout.panelGap : 0}
        style={{
          border: ['left'],
          borderStyle: 'heavy',
          borderColor: theme.inputBorder,
          paddingRight: layout.panelPaddingX,
          paddingLeft: layout.panelPaddingX,
          backgroundColor: theme.header,
        }}
      >
        {inputPreview ? <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={inputPreview} /> : null}
        <box
          flexDirection="column"
          minHeight={layout.inputRowMinHeight}
          justifyContent="center"
          paddingTop={1}
          paddingBottom={1}
        >
          <input
            value={inputValue}
            onInput={interactive.handleInput}
            onSubmit={handleInputSubmit}
            focused={isMainInputFocused}
            backgroundColor={theme.header}
            focusedBackgroundColor={theme.header}
            textColor={theme.userFg}
            placeholderColor={theme.statusFg}
            cursorColor={theme.headerAccent}
          />
        </box>
      </box>
    </box>
  )
}
