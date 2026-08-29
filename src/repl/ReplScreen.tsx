import { type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core'
import { useRenderer, useTerminalDimensions } from '@opentui/react'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import type { LaunchOptions } from '../app/launch-options'
import { getConversationGoal } from '../conversation/goal'
import { countSteerableEntries } from '../conversation/steering'
import {
  useAppRuntime,
  useConversationSnapshot,
  usePermissionSnapshot,
  useQuestionSnapshot,
  useTaskSnapshot,
} from '../app/providers'
import type { UIMessage } from '../types/chat'
import { routeInput } from './input-router'
import { applyTheme, getActiveThemeId, getThemeList, layout, theme, useTheme } from '../ui/theme'
import { useAskUserQuestionController } from '../ui/overlays/AskUserQuestionOverlay'
import { writeThemePreference } from '../session/user-config'
import { ConversationPanel } from '../ui/panels/ConversationPanel'
import { generateId } from '../lib/id'
import {
  createImageAttachment,
  loadImageAttachment,
  type ImageAttachment,
} from '../lib/image-attachments'
import { insertImageMarker, syncImageAttachments } from '../lib/image-markers'
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
import { useFollowUpDrain } from './hooks/useFollowUpDrain'
import { useConnectProvider } from './hooks/useConnectProvider'
import { usePlanApprovalPreview } from './hooks/usePlanApprovalPreview'
import { useReplKeyboard } from './hooks/useReplKeyboard'
import { useReplModelSettings } from './hooks/useReplModelSettings'
import { useReplSessionLaunch } from './hooks/useReplSessionLaunch'
import { useReplStatus } from './hooks/useReplStatus'
import { useReplSubmit } from './hooks/useReplSubmit'
import { useSessionPicker } from './hooks/useSessionPicker'
import {
  buildActivityRows,
  cycleActivityFilter,
  isCancellableTask,
  splitTaskLists,
  type ActivityFilter,
} from './task-activity-model'
import { copyTextWithRendererClipboard } from '../lib/clipboard'

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
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [taskDrawerSelectedIndex, setTaskDrawerSelectedIndex] = useState(0)
  const [taskFilter, setTaskFilter] = useState<ActivityFilter>('all')
  const [taskSearchQuery, setTaskSearchQuery] = useState('')
  const [taskSearchActive, setTaskSearchActive] = useState(false)
  const [taskDetailFocused, setTaskDetailFocused] = useState(false)
  const [taskOutputExpanded, setTaskOutputExpanded] = useState(false)
  const [mcpOverlayOpen, setMcpOverlayOpen] = useState(false)
  const [transcriptMode, setTranscriptMode] = useState(false)
  const [permissionExplainOpen, setPermissionExplainOpen] = useState(false)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const planScrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const fileMentionRequestIdRef = useRef(0)
  const slashCompletionRequestIdRef = useRef(0)
  const [fileMentionState, setFileMentionState] = useState<FileMentionState>(closedFileMentionState)
  const [slashCompletionState, setSlashCompletionState] = useState<SlashCompletionState>(closedSlashCompletionState)
  const { isLight, activeThemeId, applyTheme, toggleTheme } = useTheme()

  const [themesOverlayOpen, setThemesOverlayOpen] = useState(false)
  const [themePickerIndex, setThemePickerIndex] = useState(0)
  const themePickerOriginalIdRef = useRef<string>(getActiveThemeId())
  const themePickerEntries = useMemo(() => getThemeList(), [])

  const openThemesPicker = useCallback(() => {
    themePickerOriginalIdRef.current = getActiveThemeId()
    const idx = themePickerEntries.findIndex((e) => e.id === getActiveThemeId())
    setThemePickerIndex(idx >= 0 ? idx : 0)
    setThemesOverlayOpen(true)
  }, [themePickerEntries])

  const moveThemeSelection = useCallback((delta: number) => {
    setThemePickerIndex((current) => {
      const next = (current + delta + themePickerEntries.length) % themePickerEntries.length
      applyTheme(themePickerEntries[next]!.id)
      return next
    })
  }, [applyTheme, themePickerEntries])

  const confirmThemeSelection = useCallback(() => {
    void writeThemePreference(getActiveThemeId()).catch((error) => {
      runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
    })
    setThemesOverlayOpen(false)
  }, [runtime.conversationStore])

  const cancelThemePicker = useCallback(() => {
    applyTheme(themePickerOriginalIdRef.current)
    setThemesOverlayOpen(false)
  }, [applyTheme])

  const handleToggleTheme = useCallback(() => {
    toggleTheme()
    void writeThemePreference(getActiveThemeId()).catch((error) => {
      runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
    })
  }, [runtime.conversationStore, toggleTheme])

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
    refreshOpenRouterCredential,
    modelPicker,
  } = useReplModelSettings({
    runtime,
    messages: conversation.messages,
  })

  const connectProvider = useConnectProvider({
    runtime,
    onProviderCredentialChange: (providerId) => {
      if (providerId === 'openrouter') {
        refreshOpenRouterCredential()
      }
    },
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
  // Built from the same helper the drawer renders from, so the highlighted
  // index can never point at a row the filter or search has hidden.
  const drawerRows = useMemo(() => {
    const { activeTasks: active, recentTasks: recent } = splitTaskLists(taskSnapshot.tasks)
    return buildActivityRows(active, recent, taskFilter, taskSearchQuery)
  }, [taskSnapshot.tasks, taskFilter, taskSearchQuery])
  const drawerTaskCount = drawerRows.length
  const selectedDrawerTask = drawerTaskCount > 0
    ? drawerRows[Math.min(Math.max(taskDrawerSelectedIndex, 0), drawerTaskCount - 1)]?.task ?? null
    : null

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

  const closeTaskDrawer = useCallback(() => {
    setTasksOpen(false)
    setTaskSearchActive(false)
    setTaskDetailFocused(false)
    setTaskOutputExpanded(false)
  }, [])

  const cycleTaskFilter = useCallback((delta: number) => {
    setTaskFilter((current) => cycleActivityFilter(current, delta))
    setTaskDrawerSelectedIndex(0)
  }, [])

  const closeTaskSearch = useCallback((options?: { clear?: boolean }) => {
    setTaskSearchActive(false)
    if (options?.clear) {
      setTaskSearchQuery('')
      setTaskDrawerSelectedIndex(0)
    }
  }, [])

  const copySelectedTaskPath = useCallback(() => {
    const path = selectedDrawerTask?.outputPath ?? selectedDrawerTask?.transcriptPath
    if (!path) {
      return
    }
    void copyTextWithRendererClipboard(renderer, path).catch((error: unknown) => {
      runtime.conversationStore.setError(
        error instanceof Error ? error.message : 'Failed to copy task path to clipboard.',
      )
    })
  }, [renderer, runtime.conversationStore, selectedDrawerTask])

  const killSelectedTask = useCallback(() => {
    if (!selectedDrawerTask || !isCancellableTask(selectedDrawerTask)) {
      return
    }
    void runtime.taskRuntime.cancelTask(selectedDrawerTask.id).catch((error: unknown) => {
      runtime.conversationStore.setError(
        error instanceof Error ? error.message : 'Failed to cancel task.',
      )
    })
  }, [runtime.conversationStore, runtime.taskRuntime, selectedDrawerTask])

  const clearComposer = useCallback(() => {
    setInputValue('')
    setAttachments([])
    textareaRef.current?.setText('')
  }, [])

  const handleImagePaste = useCallback((image: {
    bytes?: Uint8Array
    mediaType?: string
    path?: string
  }) => {
    void (async () => {
      try {
        const attachment = image.path
          ? await loadImageAttachment(image.path)
          : createImageAttachment(image.bytes ?? new Uint8Array(), { mediaType: image.mediaType })
        // Drop an `[Image #N]` marker at the cursor so the prompt can refer to
        // this image by position rather than by attachment order alone.
        const textarea = textareaRef.current
        const source = textarea?.plainText ?? ''
        const insertion = insertImageMarker(source, textarea?.cursorOffset ?? source.length)
        setInputValue(insertion.value)
        if (textarea) {
          textarea.setText(insertion.value)
          textarea.cursorOffset = insertion.cursorOffset
        }
        setAttachments((current) => [...current, { ...attachment, marker: insertion.marker }])
      } catch (error) {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [runtime.conversationStore])

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
    planScrollboxRef,
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
    toggleTheme: handleToggleTheme,
    themePicker: {
      isOpen: themesOverlayOpen,
      moveSelection: moveThemeSelection,
      confirm: confirmThemeSelection,
      cancel: cancelThemePicker,
    },
    connectPicker: {
      isOpen: connectProvider.state.isOpen,
      step: connectProvider.state.step,
      moveSelection: connectProvider.moveSelection,
      enterSelected: connectProvider.enterSelected,
      confirmDisconnect: connectProvider.confirmDisconnect,
      back: connectProvider.back,
      close: connectProvider.close,
    },
    setPermissionExplainOpen,
    taskDrawer: {
      isOpen: tasksOpen,
      searchActive: taskSearchActive,
      detailFocused: taskDetailFocused,
      close: closeTaskDrawer,
      moveSelection: moveTaskDrawerSelection,
      selectFirst: () => setTaskDrawerSelectedIndex(0),
      selectLast: () => setTaskDrawerSelectedIndex(Math.max(0, drawerTaskCount - 1)),
      cycleFilter: cycleTaskFilter,
      openSearch: () => setTaskSearchActive(true),
      closeSearch: closeTaskSearch,
      setDetailFocused: setTaskDetailFocused,
      toggleOutputExpanded: () => setTaskOutputExpanded((current) => !current),
      copySelectedPath: copySelectedTaskPath,
      killSelected: killSelectedTask,
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
    persistModelSelection,
    handleModelFilterSubmit: handleFilterSubmit,
    modelPickerFetchState: modelPickerState.fetchState,
    setMcpOverlayOpen,
    openThemesPicker,
    openConnectPicker: connectProvider.open,
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
    !themesOverlayOpen &&
    !connectProvider.state.isOpen &&
    !permissionSnapshot.activeRequest &&
    !questionSnapshot.activeRequest

  // Called before the controller so `scrollToBottom` can be handed to it:
  // the user's own submission must scroll the conversation into view even
  // when they had scrolled up, while streaming updates keep respecting the
  // read-scrollback protection inside the hook.
  const { scrollToBottom } = useConversationAutoScroll(scrollboxRef, conversation.messages)

  const interactive = useInteractiveController({
    inputValue,
    setInputValue,
    attachments,
    setAttachments,
    onImagePaste: handleImagePaste,
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
    onSubmitted: scrollToBottom,
    keyboardEnabled: composerInputActive && !tasksOpen,
    historyNavigationEnabled: composerInputActive && !tasksOpen && !fileMentionState.isOpen && !slashCompletionState.isOpen,
    completionNavigationActive: composerInputActive && (fileMentionState.isOpen || slashCompletionState.isOpen),
    getComposerCursor: useCallback(() => {
      const textarea = textareaRef.current
      if (!textarea) {
        return null
      }
      const { row } = textarea.logicalCursor
      const lineCount = textarea.plainText.split('\n').length
      return { row, lineCount }
    }, []),
  })

  useEffect(() => {
    setThinkingEnabled(interactive.thinkingEnabled)
  }, [interactive.thinkingEnabled])

  useFollowUpDrain({
    status: conversation.status,
    // The queue snapshot's identity changes on every mutation, re-running the
    // drain effect even when the status/handlers stay stable (e.g. an entry
    // queued while idle, or leftovers after a local-only slash command).
    queueVersion: interactive.followUpQueue,
    isRunActive: interactive.isRunActive,
    drainFollowUp: interactive.drainFollowUp,
    submit: interactive.submitFollowUp,
  })

  // Hand the composer's queue to the running turn. Registered here rather than
  // inside the controller because the bridge belongs to the runtime, which the
  // controller does not see.
  useEffect(() => {
    runtime.steering.setSource(interactive.drainSteerable)
    return () => {
      runtime.steering.setSource(null)
    }
  }, [interactive.drainSteerable, runtime.steering])

  useEffect(() => {
    setPermissionExplainOpen(false)
  }, [permissionSnapshot.activeRequest])

  const overlayFocus = getReplOverlayFocus({
    sessionInitializing,
    modelPickerOpen: modelPickerState.isOpen,
    sessionPickerOpen: sessionPickerState.isOpen,
    mcpOverlayOpen,
    themesOverlayOpen,
    connectPickerOpen: connectProvider.state.isOpen,
    permissionOpen: Boolean(permissionSnapshot.activeRequest),
    questionOpen: Boolean(questionSnapshot.activeRequest),
  })

  const { handleTextareaContentChange, handleTextareaSubmit } = useComposerTextarea({
    inputValue,
    textareaRef,
    activeThemeId,
    enabled: overlayFocus.mainInput,
    onInput: (value) => {
      const displayValue = interactive.handleInput(value)
      // Deleting an `[Image #N]` marker detaches the image it stood for.
      setAttachments((current) => syncImageAttachments(displayValue, current))
      return displayValue
    },
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
  // Entries at the head of the queue that the running turn will pick up at its
  // next step boundary, rather than after it finishes.
  const steeringCount =
    conversation.status === 'running' && runtime.steering.isConnected
      ? countSteerableEntries(interactive.followUpQueue)
      : 0
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
    permissionMode: permissionSnapshot.mode,
    isLight,
    terminalWidth,
    followUpCount,
    steeringCount,
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
        isLightTheme={isLight}
        activeThemeId={activeThemeId}
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
        themesOverlayOpen={themesOverlayOpen}
        themePickerEntries={themePickerEntries}
        themePickerIndex={themePickerIndex}
        themePickerActiveId={activeThemeId}
        connectPickerState={connectProvider.state}
        permissionRequest={permissionSnapshot.activeRequest}
        permissionExplainOpen={permissionExplainOpen}
        activePlanContent={activePlanContent}
        planScrollboxRef={planScrollboxRef}
        questionOpen={Boolean(questionSnapshot.activeRequest)}
        questionController={questionController}
        tasksOpen={tasksOpen}
        activeTasks={activeTasks}
        recentTasks={recentTasks}
        selectedTaskIndex={taskDrawerSelectedIndex}
        goal={currentGoal}
        taskFilter={taskFilter}
        taskSearchQuery={taskSearchQuery}
        taskSearchActive={taskSearchActive}
        taskDetailFocused={taskDetailFocused}
        taskOutputExpanded={taskOutputExpanded}
        onTaskSearchChange={(value) => {
          setTaskSearchQuery(value)
          setTaskDrawerSelectedIndex(0)
        }}
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
        onTasksClose={closeTaskDrawer}
        onSessionFilterChange={handleSessionFilterChange}
        onSessionFilterSubmit={handleSessionFilterSubmit}
        onSessionOptionChange={setSessionSelection}
        onSessionOptionSelect={(index) => {
          void selectSessionByIndex(index)
        }}
        onThemeMove={moveThemeSelection}
        onThemeSelect={confirmThemeSelection}
        onThemeClose={cancelThemePicker}
        onConnectMove={connectProvider.moveSelection}
        onConnectEnter={connectProvider.enterSelected}
        onConnectInputChange={connectProvider.handleInputChange}
        onConnectSubmitInput={connectProvider.submitInput}
        onConnectConfirmDisconnect={connectProvider.confirmDisconnect}
        onConnectBack={connectProvider.back}
        onConnectClose={connectProvider.close}
      />

      <ReplComposer
        inputValue={inputValue}
        attachments={attachments}
        onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
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
