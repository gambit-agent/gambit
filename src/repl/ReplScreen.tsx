import { type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/react'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import type { LaunchOptions } from '../app/launch-options'
import { getConversationGoal } from '../conversation/goal'
import {
  useAppRuntime,
  useConversationSnapshot,
  usePermissionSnapshot,
  useQuestionSnapshot,
  useTaskSnapshot,
} from '../app/providers'
import type { UIMessage } from '../types/chat'
import { routeInput } from './input-router'
import { layout, theme, useTheme } from '../ui/theme'
import { useAskUserQuestionController } from '../ui/overlays/AskUserQuestionOverlay'
import { ConversationPanel } from '../ui/panels/ConversationPanel'
import { generateId } from '../lib/id'
import { useInteractiveController } from '../lib/interactive/controller'
import {
  findActiveFileMention,
  getFileMentionMatches,
  replaceActiveFileMention,
  type ActiveFileMention,
} from './file-mentions'
import {
  findActiveSlashCompletion,
  getSlashCompletionMatches,
  replaceActiveSlashCompletion,
  type ActiveSlashCompletion,
  type SlashCompletionMatch,
} from './slash-completions'
import { ReplComposer, type TextareaKeyBinding } from './components/ReplComposer'
import { ReplFooter } from './components/ReplFooter'
import { ReplHeader } from './components/ReplHeader'
import { ReplNotices } from './components/ReplNotices'
import {
  ReplOverlayManager,
  getReplOverlayFocus,
} from './components/ReplOverlayManager'
import { useClipboardSelection } from './hooks/useClipboardSelection'
import { useComposerTextarea } from './hooks/useComposerTextarea'
import { useConversationAutoScroll } from './hooks/useConversationAutoScroll'
import { usePlanApprovalPreview } from './hooks/usePlanApprovalPreview'
import { useReplKeyboard } from './hooks/useReplKeyboard'
import { useReplModelSettings } from './hooks/useReplModelSettings'
import { useReplSessionLaunch } from './hooks/useReplSessionLaunch'
import { useReplStatus } from './hooks/useReplStatus'
import { useReplSubmit } from './hooks/useReplSubmit'
import { useSessionPicker } from './hooks/useSessionPicker'
import { isActiveTaskStatus } from './repl-format'

const textareaKeyBindings: TextareaKeyBinding[] = [
  { name: 'return', action: 'submit' as const },
  { name: 'enter', action: 'submit' as const },
  { name: 'return', shift: true, action: 'newline' as const },
  { name: 'enter', shift: true, action: 'newline' as const },
  { name: 'return', ctrl: true, action: 'newline' as const },
  { name: 'enter', ctrl: true, action: 'newline' as const },
  { name: 'return', meta: true, action: 'newline' as const },
  { name: 'enter', meta: true, action: 'newline' as const },
]

interface FileMentionState {
  isOpen: boolean
  mention: ActiveFileMention | null
  query: string
  selectedIndex: number
  results: string[]
}

const closedFileMentionState: FileMentionState = {
  isOpen: false,
  mention: null,
  query: '',
  selectedIndex: 0,
  results: [],
}

interface SlashCompletionState {
  isOpen: boolean
  completion: ActiveSlashCompletion | null
  query: string
  mode: ActiveSlashCompletion['mode']
  selectedIndex: number
  results: SlashCompletionMatch[]
}

const closedSlashCompletionState: SlashCompletionState = {
  isOpen: false,
  completion: null,
  query: '',
  mode: 'command',
  selectedIndex: 0,
  results: [],
}

export interface ReplScreenProps {
  launchOptions: LaunchOptions
}

export function ReplScreen({ launchOptions }: ReplScreenProps) {
  const renderer = useRenderer()
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()
  const runtime = useAppRuntime()
  const conversation = useConversationSnapshot()
  const taskSnapshot = useTaskSnapshot()
  const permissionSnapshot = usePermissionSnapshot()
  const questionSnapshot = useQuestionSnapshot()
  const questionController = useAskUserQuestionController({
    record: questionSnapshot.activeRequest,
    onResolve: (id, bundle) => runtime.questionEngine.resolve(id, bundle),
    onReject: (id, reason) => runtime.questionEngine.reject(id, new Error(reason)),
  })

  const [inputValue, setInputValue] = useState('')
  const [inputPreview, setInputPreview] = useState<string | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [taskDrawerSelectedIndex, setTaskDrawerSelectedIndex] = useState(0)
  const [mcpOverlayOpen, setMcpOverlayOpen] = useState(false)
  const [transcriptMode, setTranscriptMode] = useState(false)
  const [permissionExplainOpen, setPermissionExplainOpen] = useState(false)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const fileMentionRequestIdRef = useRef(0)
  const slashCompletionRequestIdRef = useRef(0)
  const [fileMentionState, setFileMentionState] = useState<FileMentionState>(closedFileMentionState)
  const [slashCompletionState, setSlashCompletionState] = useState<SlashCompletionState>(closedSlashCompletionState)
  const { isLight, toggleTheme } = useTheme()

  const {
    state: sessionPickerState,
    options: sessionPickerOptions,
    sessionInitializing,
    setSessionInitializing,
    dismiss: dismissSessionPicker,
    refresh: refreshSessionPicker,
    startFreshConversation,
    open: openSessionPicker,
    moveSelection: moveSessionSelection,
    setSelection: setSessionSelection,
    selectByIndex: selectSessionByIndex,
    handleFilterChange: handleSessionFilterChange,
    handleFilterSubmit: handleSessionFilterSubmit,
  } = useSessionPicker({
    runtime,
    conversation,
    initialInitializing: launchOptions.mode !== 'new',
  })

  useReplSessionLaunch({
    launchOptions,
    runtime,
    refreshSessionPicker,
    setSessionInitializing,
  })

  const {
    modelId,
    apiKey,
    reasoningEffort,
    providerSlug,
    contextUsage,
    persistModelSelection,
    persistApiKey,
    modelPicker,
  } = useReplModelSettings({
    runtime,
    messages: conversation.messages,
  })

  const {
    state: modelPickerState,
    open: openModelPicker,
    moveSelection: moveModelSelection,
    close: closeModelPicker,
    handleFilterChange: handleModelFilterChange,
    handleFilterSubmit,
    moveReasoningEffort: moveModelReasoningEffort,
    moveProviderSelection: moveModelProviderSelection,
    setProviderSelection: setModelProviderSelection,
    applyOptionsSelection: applyModelOptionsSelection,
    selectByIndex: selectModelByIndex,
    selectById: selectModelById,
    setSelection: setModelSelection,
  } = modelPicker

  const interactiveMessages = useMemo<UIMessage[]>(
    () =>
      conversation.messages.map((message) => ({
        ...message,
        timestamp: new Date(message.timestamp),
      })),
    [conversation.messages],
  )
  const currentGoal = useMemo(() => getConversationGoal(conversation.messages), [conversation.messages])
  const drawerTaskCount = useMemo(() => {
    const activeCount = taskSnapshot.tasks.filter((task) => isActiveTaskStatus(task.status)).length
    const recentCount = taskSnapshot.tasks
      .filter((task) => !isActiveTaskStatus(task.status))
      .slice(0, 8)
      .length
    return activeCount + recentCount
  }, [taskSnapshot.tasks])

  useEffect(() => {
    setTaskDrawerSelectedIndex((current) => {
      if (drawerTaskCount === 0) {
        return 0
      }
      return Math.min(current, drawerTaskCount - 1)
    })
  }, [drawerTaskCount])

  const moveTaskDrawerSelection = useCallback((delta: number) => {
    setTaskDrawerSelectedIndex((current) => {
      if (drawerTaskCount === 0) {
        return 0
      }
      return (current + delta + drawerTaskCount) % drawerTaskCount
    })
  }, [drawerTaskCount])

  const clearComposer = useCallback(() => {
    setInputValue('')
    textareaRef.current?.setText('')
  }, [])

  useEffect(() => {
    const cursorOffset = textareaRef.current?.cursorOffset ?? inputValue.length
    const mention = findActiveFileMention(inputValue, cursorOffset)
    const requestId = fileMentionRequestIdRef.current + 1
    fileMentionRequestIdRef.current = requestId

    if (!mention) {
      setFileMentionState(closedFileMentionState)
      return
    }

    void getFileMentionMatches(mention.query).then((matches) => {
      if (fileMentionRequestIdRef.current !== requestId) {
        return
      }

      setFileMentionState({
        isOpen: matches.length > 0,
        mention,
        query: mention.query,
        selectedIndex: 0,
        results: matches.map((match) => match.path),
      })
    }).catch(() => {
      if (fileMentionRequestIdRef.current === requestId) {
        setFileMentionState(closedFileMentionState)
      }
    })
  }, [inputValue])

  useEffect(() => {
    const cursorOffset = textareaRef.current?.cursorOffset ?? inputValue.length
    const completion = findActiveSlashCompletion(inputValue, cursorOffset)
    const requestId = slashCompletionRequestIdRef.current + 1
    slashCompletionRequestIdRef.current = requestId

    if (!completion) {
      setSlashCompletionState(closedSlashCompletionState)
      return
    }

    void getSlashCompletionMatches(completion.query, completion.mode).then((matches) => {
      if (slashCompletionRequestIdRef.current !== requestId) {
        return
      }

      setSlashCompletionState({
        isOpen: matches.length > 0,
        completion,
        query: completion.query,
        mode: completion.mode,
        selectedIndex: 0,
        results: matches,
      })
    }).catch(() => {
      if (slashCompletionRequestIdRef.current === requestId) {
        setSlashCompletionState(closedSlashCompletionState)
      }
    })
  }, [inputValue])

  const closeFileMention = useCallback(() => {
    fileMentionRequestIdRef.current += 1
    setFileMentionState(closedFileMentionState)
  }, [])

  const closeSlashCompletion = useCallback(() => {
    slashCompletionRequestIdRef.current += 1
    setSlashCompletionState(closedSlashCompletionState)
  }, [])

  const moveFileMentionSelection = useCallback((delta: number) => {
    setFileMentionState((current) => {
      if (!current.isOpen || current.results.length === 0) {
        return current
      }
      const nextIndex = (current.selectedIndex + delta + current.results.length) % current.results.length
      return { ...current, selectedIndex: nextIndex }
    })
  }, [])

  const moveSlashCompletionSelection = useCallback((delta: number) => {
    setSlashCompletionState((current) => {
      if (!current.isOpen || current.results.length === 0) {
        return current
      }
      const nextIndex = (current.selectedIndex + delta + current.results.length) % current.results.length
      return { ...current, selectedIndex: nextIndex }
    })
  }, [])

  const selectFileMention = useCallback(() => {
    const mention = fileMentionState.mention
    const filePath = fileMentionState.results[fileMentionState.selectedIndex]
    if (!mention || !filePath) {
      closeFileMention()
      return
    }

    const next = replaceActiveFileMention(inputValue, mention, filePath)
    setInputValue(next.value)
    const textarea = textareaRef.current
    if (textarea) {
      textarea.setText(next.value)
      textarea.cursorOffset = next.cursorOffset
    }
    closeFileMention()
  }, [closeFileMention, fileMentionState, inputValue])

  const selectSlashCompletion = useCallback(() => {
    const completion = slashCompletionState.completion
    const match = slashCompletionState.results[slashCompletionState.selectedIndex]
    if (!completion || !match) {
      closeSlashCompletion()
      return
    }

    const next = replaceActiveSlashCompletion(inputValue, completion, match)
    setInputValue(next.value)
    const textarea = textareaRef.current
    if (textarea) {
      textarea.setText(next.value)
      textarea.cursorOffset = next.cursorOffset
    }
    closeSlashCompletion()
  }, [closeSlashCompletion, inputValue, slashCompletionState])

  useReplKeyboard({
    runtime,
    scrollboxRef,
    conversation,
    permissionSnapshot,
    questionSnapshot,
    questionController,
    modelPickerState,
    openModelPicker,
    closeModelPicker,
    moveModelSelection,
    moveModelReasoningEffort,
    moveModelProviderSelection,
    applyModelOptionsSelection,
    sessionPickerState,
    dismissSessionPicker,
    startFreshConversation,
    moveSessionSelection,
    mcpOverlayOpen,
    setMcpOverlayOpen,
    transcriptMode,
    setTranscriptMode,
    toggleTheme,
    setPermissionExplainOpen,
    taskDrawer: {
      isOpen: tasksOpen,
      close: () => setTasksOpen(false),
      moveSelection: moveTaskDrawerSelection,
      selectFirst: () => setTaskDrawerSelectedIndex(0),
      selectLast: () => setTaskDrawerSelectedIndex(Math.max(0, drawerTaskCount - 1)),
    },
    fileMentionCompletion: {
      isOpen: fileMentionState.isOpen,
      moveSelection: moveFileMentionSelection,
      selectCurrent: selectFileMention,
      close: closeFileMention,
    },
    slashCompletion: {
      isOpen: slashCompletionState.isOpen,
      moveSelection: moveSlashCompletionSelection,
      selectCurrent: selectSlashCompletion,
      close: closeSlashCompletion,
    },
  })

  const performSubmit = useReplSubmit({
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
    handleModelFilterSubmit: handleFilterSubmit,
    modelPickerFetchState: modelPickerState.fetchState,
    setMcpOverlayOpen,
  })

  const setConversationMessages = useCallback(
    (next: SetStateAction<UIMessage[]>) => {
      const resolvedMessages = typeof next === 'function' ? next(interactiveMessages) : next

      void runtime.conversationStore.replaceMessages(
        resolvedMessages.map((message) => ({
          ...message,
          timestamp: message.timestamp.toISOString(),
        })),
      )
    },
    [interactiveMessages, runtime.conversationStore],
  )

  const composerInputActive =
    !sessionInitializing &&
    !modelPickerState.isOpen &&
    !sessionPickerState.isOpen &&
    !mcpOverlayOpen &&
    !permissionSnapshot.activeRequest &&
    !questionSnapshot.activeRequest

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
      const newMode = runtime.permissionEngine.cycleMode()
      const activeRequest = runtime.permissionEngine.getSnapshot().activeRequest
      if (newMode === 'Auto-accept' && activeRequest) {
        void runtime.permissionEngine.resolve(activeRequest.id, 'allow')
      }
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
        setTasksOpen(true)
        return false
      }

      void (async () => {
        try {
          const result = await runtime.runShellCommand(routed.argument, { background: true })
          await runtime.conversationStore.pushMessage({
            id: generateId(),
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
    onToggleBackgroundTasks: () => {
      setTasksOpen((current) => !current)
    },
    keyboardEnabled: composerInputActive && !tasksOpen,
    historyNavigationEnabled: composerInputActive && !tasksOpen && !fileMentionState.isOpen && !slashCompletionState.isOpen,
    completionNavigationActive: composerInputActive && (fileMentionState.isOpen || slashCompletionState.isOpen),
  })

  useEffect(() => {
    setThinkingEnabled(interactive.thinkingEnabled)
  }, [interactive.thinkingEnabled])

  useEffect(() => {
    if (conversation.status !== 'idle') {
      return
    }
    const next = interactive.drainFollowUp()
    if (next) {
      void interactive.handleSubmit(next)
    }
  }, [conversation.status, interactive])

  useConversationAutoScroll(scrollboxRef, conversation.messages)

  useEffect(() => {
    setPermissionExplainOpen(false)
  }, [permissionSnapshot.activeRequest])

  const overlayFocus = getReplOverlayFocus({
    sessionInitializing,
    modelPickerOpen: modelPickerState.isOpen,
    sessionPickerOpen: sessionPickerState.isOpen,
    mcpOverlayOpen,
    permissionOpen: Boolean(permissionSnapshot.activeRequest),
    questionOpen: Boolean(questionSnapshot.activeRequest),
  })

  const { handleTextareaContentChange, handleTextareaSubmit } = useComposerTextarea({
    inputValue,
    textareaRef,
    isLight,
    enabled: overlayFocus.mainInput,
    onInput: interactive.handleInput,
    onSubmit: (value) => {
      if (slashCompletionState.isOpen) {
        selectSlashCompletion()
        return
      }
      if (fileMentionState.isOpen) {
        selectFileMention()
        return
      }
      void interactive.handleSubmit(value)
    },
  })

  const handleMouseUp = useClipboardSelection(renderer, runtime)
  const activePlanContent = usePlanApprovalPreview(
    permissionSnapshot.activeRequest,
    conversation.conversationId,
  )
  const followUpCount = interactive.followUpQueue.length
  const {
    shortModelDisplay,
    activeTasks,
    recentTasks,
    footerSegments,
  } = useReplStatus({
    conversation,
    tasks: taskSnapshot.tasks,
    modelId,
    reasoningEffort,
    providerSlug,
    thinkingEnabled,
    permissionMode: permissionSnapshot.mode,
    isLight,
    terminalWidth,
    followUpCount,
  })
  const handleConversationClipboardError = useCallback((error: Error) => {
    runtime.conversationStore.setError(error.message)
  }, [runtime.conversationStore])

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      paddingX={layout.screenPadding}
      backgroundColor={theme.background}
      onMouseUp={handleMouseUp}
    >
      <ReplHeader />

      <ConversationPanel
        messages={conversation.messages}
        scrollboxRef={scrollboxRef}
        transcriptMode={transcriptMode}
        onClipboardError={handleConversationClipboardError}
      />

      <ReplNotices
        error={conversation.error}
        historySearch={interactive.historySearch}
        exitPending={interactive.exitPending}
        transcriptMode={transcriptMode}
        sessionInitializing={sessionInitializing}
      />

      <ReplOverlayManager
        sessionInitializing={sessionInitializing}
        modelId={modelId}
        modelPickerState={modelPickerState}
        sessionPickerState={sessionPickerState}
        sessionPickerOptions={sessionPickerOptions}
        mcpOverlayOpen={mcpOverlayOpen}
        permissionRequest={permissionSnapshot.activeRequest}
        permissionExplainOpen={permissionExplainOpen}
        activePlanContent={activePlanContent}
        questionOpen={Boolean(questionSnapshot.activeRequest)}
        questionController={questionController}
        tasksOpen={tasksOpen}
        activeTasks={activeTasks}
        recentTasks={recentTasks}
        selectedTaskIndex={taskDrawerSelectedIndex}
        goal={currentGoal}
        terminalWidth={terminalWidth}
        terminalHeight={terminalHeight}
        onModelFilterChange={handleModelFilterChange}
        onModelFilterSubmit={handleFilterSubmit}
        onModelOptionChange={(index) => setModelSelection(index)}
        onModelOptionSelect={(index, modelOptionId) => {
          if (modelOptionId) {
            selectModelById(modelOptionId)
            return
          }
          selectModelByIndex(index)
        }}
        onModelProviderOptionChange={setModelProviderSelection}
        onModelProviderOptionSelect={(index) => {
          setModelProviderSelection(index)
          applyModelOptionsSelection(index)
        }}
        onModelClose={closeModelPicker}
        onTasksClose={() => setTasksOpen(false)}
        onSessionFilterChange={handleSessionFilterChange}
        onSessionFilterSubmit={handleSessionFilterSubmit}
        onSessionOptionChange={setSessionSelection}
        onSessionOptionSelect={(index) => {
          void selectSessionByIndex(index)
        }}
      />

      <ReplComposer
        inputValue={inputValue}
        inputPreview={inputPreview}
        textareaRef={textareaRef}
        focused={overlayFocus.mainInput && !tasksOpen}
        keyBindings={textareaKeyBindings}
        onContentChange={handleTextareaContentChange}
        onSubmit={handleTextareaSubmit}
        fileMention={{
          isOpen: fileMentionState.isOpen,
          query: fileMentionState.query,
          selectedIndex: fileMentionState.selectedIndex,
          results: fileMentionState.results,
        }}
        slashCompletion={{
          isOpen: slashCompletionState.isOpen,
          query: slashCompletionState.query,
          mode: slashCompletionState.mode,
          selectedIndex: slashCompletionState.selectedIndex,
          results: slashCompletionState.results,
        }}
      />
      <ReplFooter
        segments={footerSegments}
        contextUsage={contextUsage}
        shortModelDisplay={shortModelDisplay}
        activeTasks={activeTasks}
        goalActive={Boolean(currentGoal)}
      />
    </box>
  )
}
