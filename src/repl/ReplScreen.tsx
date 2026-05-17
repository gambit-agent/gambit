import { MouseButton, TextAttributes, type MouseEvent, type ParsedKey, type ScrollBoxRenderable, type Selection, type TextareaRenderable } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/react'
import { randomUUID } from 'node:crypto'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import type { LaunchOptions } from '../app/launch-options'
import { defaultModel } from '../config'
import {
  useAppRuntime,
  useConversationSnapshot,
  usePermissionSnapshot,
  useQuestionSnapshot,
  useTaskSnapshot,
} from '../app/providers'
import { copyTextToClipboard } from '../lib/clipboard'
import { useModelPicker } from '../lib/modelPicker'
import { modelRequiresApiKey, type ReasoningEffort } from '../lib/model'
import { executeSlashCommand, type SlashCommandExecution } from '../lib/slashCommands'
import { executePromptTemplate } from '../lib/promptTemplates'
import { estimateContextTokens } from '../conversation/compaction'
import {
  buildGoalRunPrompt,
  clearConversationGoal,
  getConversationGoal,
  parseGoalCommand,
  setConversationGoal,
} from '../conversation/goal'
import { getModelContextLength, getCompactionThreshold } from '../lib/model-info'
import { useInteractiveController } from '../lib/interactive/controller'
import { matchShortcut } from '../lib/interactive/shortcuts'
import type { UIMessage } from '../types/chat'
import type { ConversationSessionSummary } from '../session/conversation-sessions'
import { readModelSelection, writeModelSelection } from '../session/model-selection'
import { routeInput } from './input-router'
import { layout, theme } from '../ui/theme'
import { ModelPickerOverlay } from '../ui/model-picker/ModelPickerOverlay'
import { ConversationPanel } from '../ui/panels/ConversationPanel'
import { TaskPanel } from '../ui/panels/TaskPanel'
import { PermissionOverlay } from '../ui/overlays/PermissionOverlay'
import { PlanApprovalOverlay } from '../ui/overlays/PlanApprovalOverlay'
import { SessionPickerOverlay, type SessionPickerOption } from '../ui/overlays/SessionPickerOverlay'
import { MCPServerManagerOverlay } from '../ui/overlays/MCPServerManagerOverlay'
import {
  AskUserQuestionOverlay,
  useAskUserQuestionController,
} from '../ui/overlays/AskUserQuestionOverlay'
import { listMCPServerConfigs } from '../lib/mcp-config'
import { readPlan } from '../plans/plan-store'

// Textarea key bindings: Enter submits, Shift/Ctrl/Meta+Enter inserts newline
const textareaKeyBindings = [
  { name: 'return', action: 'submit' as const },
  { name: 'enter', action: 'submit' as const },
  { name: 'return', shift: true, action: 'newline' as const },
  { name: 'enter', shift: true, action: 'newline' as const },
  { name: 'return', ctrl: true, action: 'newline' as const },
  { name: 'enter', ctrl: true, action: 'newline' as const },
  { name: 'return', meta: true, action: 'newline' as const },
  { name: 'enter', meta: true, action: 'newline' as const },
]

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const sessionTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const responseSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const responseSpinnerIntervalMs = 80
const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g
const oscPattern = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g
const controlCharsPattern = /[\u0000-\u001f\u007f-\u009f]/g

interface SessionPickerState {
  isOpen: boolean
  filterValue: string
  selectedIndex: number
  sessions: ConversationSessionSummary[]
  fetchState: 'idle' | 'loading' | 'success' | 'error'
  fetchError: string | null
}

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

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return `${tokens}`
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

function formatSessionTimestamp(value: string | null): string {
  if (!value) {
    return 'unknown'
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return 'unknown'
  }

  return sessionTimestampFormatter.format(timestamp)
}

function formatTaskTitle(value: string): string {
  return value
    .replace(oscPattern, '')
    .replace(ansiPattern, '')
    .replace(controlCharsPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isActiveBackgroundTaskStatus(status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'): boolean {
  return status === 'pending' || status === 'running'
}

function describeSessionOption(summary: ConversationSessionSummary, isCurrent: boolean): string {
  const parts = [
    summary.conversationId.slice(0, 8),
    `updated ${formatSessionTimestamp(summary.updatedAt)}`,
    `${summary.messageCount} msgs`,
  ]

  if (isCurrent) {
    parts.push('current')
  }

  if (summary.preview) {
    parts.push(summary.preview)
  }

  return parts.join(' · ')
}

export interface ReplScreenProps {
  launchOptions: LaunchOptions
}

/**
 * Main TUI screen for the interactive REPL. Orchestrates:
 * - Keyboard input routing (prompts, colon commands, slash commands, shell, memory)
 * - Overlay management (model picker, session picker, permission dialog, questions)
 * - Live streaming display with reasoning and tool call animations
 * - Background task panel and status bar
 */
export function ReplScreen({ launchOptions }: ReplScreenProps) {
  const renderer = useRenderer()
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
  const [modelId, setModelId] = useState(defaultModel)
  const [apiKey, setApiKey] = useState<string>(Bun.env.OPENROUTER_API_KEY ?? '')
  const [statusElapsed, setStatusElapsed] = useState<string | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [backgroundTasksOpen, setBackgroundTasksOpen] = useState(false)
  const [responseSpinnerFrame, setResponseSpinnerFrame] = useState(0)
  const [sessionInitializing, setSessionInitializing] = useState(launchOptions.mode !== 'new')
  const [sessionPickerState, setSessionPickerState] = useState<SessionPickerState>({
    isOpen: false,
    filterValue: '',
    selectedIndex: 0,
    sessions: [],
    fetchState: 'idle',
    fetchError: null,
  })
  const [mcpOverlayOpen, setMcpOverlayOpen] = useState(false)
  const [activePlanContent, setActivePlanContent] = useState<string | null>(null)
  const [transcriptMode, setTranscriptMode] = useState(false)
  const [permissionExplainOpen, setPermissionExplainOpen] = useState(false)
  const [contextUsage, setContextUsage] = useState<{ used: number; max: number } | null>(null)
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const textareaRef = useRef<TextareaRenderable | null>(null)
  const statusStartedAtRef = useRef<Date | null>(null)
  const launchHandledRef = useRef(false)
  const modelSelectionDirtyRef = useRef(false)
  const interactiveMessages = useMemo<UIMessage[]>(
    () =>
      conversation.messages.map((message) => ({
        ...message,
        timestamp: new Date(message.timestamp),
      })),
    [conversation.messages],
  )

  const sessionPickerOptions = useMemo<SessionPickerOption[]>(() => {
    const filter = sessionPickerState.filterValue.trim().toLowerCase()
    const filteredSessions = sessionPickerState.sessions.filter((session) => {
      if (!filter) {
        return true
      }

      const haystack = [
        session.conversationId,
        session.title,
        session.preview ?? '',
      ]
        .join('\n')
        .toLowerCase()

      return haystack.includes(filter)
    })

    const sessionOptions: SessionPickerOption[] = filteredSessions.map((session) => ({
      key: session.conversationId,
      kind: 'session',
      title: session.title,
      description: describeSessionOption(session, session.conversationId === conversation.conversationId),
    }))

    const newOption: SessionPickerOption = {
      key: 'new',
      kind: 'new',
      title: 'Start new conversation',
      description: 'Create a fresh session with a new conversation ID.',
    }

    if (sessionOptions.length === 0) {
      return [newOption]
    }

    return [
      ...sessionOptions,
      newOption,
    ]
  }, [conversation.conversationId, sessionPickerState.filterValue, sessionPickerState.sessions])

  const clearComposer = useCallback(() => {
    setInputValue('')
    textareaRef.current?.setText('')
  }, [])

  const persistModelSelection = useCallback(
    (nextModelId: string, nextReasoningEffort: ReasoningEffort | null) => {
      modelSelectionDirtyRef.current = true
      setModelId(nextModelId)
      setReasoningEffort(nextReasoningEffort)

      void writeModelSelection({
        modelId: nextModelId,
        reasoningEffort: nextReasoningEffort,
      }).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })
    },
    [runtime.conversationStore],
  )

  const modelPicker = useModelPicker({
    apiKey: apiKey.trim().length > 0 ? apiKey.trim() : null,
    currentModelId: modelId,
    currentReasoning: reasoningEffort,
    onSelect: (model, effort) => {
      persistModelSelection(model.id, effort)
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
    selectById: selectModelById,
    setSelection: setModelSelection,
  } = modelPicker

  const dismissSessionPicker = useCallback(() => {
    setSessionPickerState((current) => ({
      ...current,
      isOpen: false,
      selectedIndex: 0,
      fetchError: null,
    }))
  }, [])

  const refreshSessionPicker = useCallback(
    async (filterValue: string = '') => {
      setSessionPickerState((current) => ({
        ...current,
        isOpen: true,
        filterValue,
        selectedIndex: 0,
        fetchState: 'loading',
        fetchError: null,
      }))

      try {
        const sessions = await runtime.listConversationSessions()
        setSessionPickerState((current) => ({
          ...current,
          isOpen: true,
          filterValue,
          selectedIndex: 0,
          sessions,
          fetchState: 'success',
          fetchError: null,
        }))
      } catch (error) {
        setSessionPickerState((current) => ({
          ...current,
          isOpen: true,
          filterValue,
          selectedIndex: 0,
          fetchState: 'error',
          fetchError: error instanceof Error ? error.message : String(error),
        }))
      }
    },
    [runtime],
  )

  const startFreshConversation = useCallback(async () => {
    if (conversation.status === 'running') {
      runtime.conversationStore.setError('Finish or cancel the current run before starting a new conversation.')
      return
    }

    setSessionInitializing(true)
    try {
      await runtime.resetConversation()
      dismissSessionPicker()
    } catch (error) {
      runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionInitializing(false)
    }
  }, [conversation.status, dismissSessionPicker, runtime])

  const openSessionPicker = useCallback(
    (initialFilter: string = '') => {
      if (conversation.status === 'running') {
        runtime.conversationStore.setError('Finish or cancel the current run before switching conversations.')
        return
      }

      void refreshSessionPicker(initialFilter)
    },
    [conversation.status, refreshSessionPicker, runtime],
  )

  const moveSessionSelection = useCallback(
    (delta: number) => {
      setSessionPickerState((current) => {
        const maxIndex = Math.max(0, sessionPickerOptions.length - 1)
        const nextIndex = Math.min(maxIndex, Math.max(0, current.selectedIndex + delta))
        return {
          ...current,
          selectedIndex: nextIndex,
        }
      })
    },
    [sessionPickerOptions.length],
  )

  const setSessionSelection = useCallback(
    (index: number) => {
      setSessionPickerState((current) => ({
        ...current,
        selectedIndex: Math.min(Math.max(index, 0), Math.max(0, sessionPickerOptions.length - 1)),
      }))
    },
    [sessionPickerOptions.length],
  )

  const selectSessionByIndex = useCallback(
    async (index: number) => {
      const option = sessionPickerOptions[index]
      if (!option) {
        return
      }

      if (option.kind === 'new') {
        await startFreshConversation()
        return
      }

      setSessionInitializing(true)
      try {
        await runtime.resumeConversation(option.key)
        dismissSessionPicker()
      } catch (error) {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      } finally {
        setSessionInitializing(false)
      }
    },
    [dismissSessionPicker, runtime, sessionPickerOptions, startFreshConversation],
  )

  const handleSessionFilterChange = useCallback((value: string) => {
    setSessionPickerState((current) => ({
      ...current,
      filterValue: value,
      selectedIndex: 0,
    }))
  }, [])

  const handleSessionFilterSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim().toLowerCase()
      if (trimmed === 'cancel') {
        if (conversation.initialized) {
          dismissSessionPicker()
        } else {
          void startFreshConversation()
        }
        return
      }

      if (trimmed === 'new') {
        void startFreshConversation()
        return
      }

      if (trimmed === 'retry' && sessionPickerState.fetchState === 'error') {
        void refreshSessionPicker(sessionPickerState.filterValue)
        return
      }

      void selectSessionByIndex(sessionPickerState.selectedIndex)
    },
    [
      conversation.initialized,
      dismissSessionPicker,
      refreshSessionPicker,
      selectSessionByIndex,
      sessionPickerState.fetchState,
      sessionPickerState.filterValue,
      sessionPickerState.selectedIndex,
      startFreshConversation,
    ],
  )

  // Restore persisted model selection on mount (unless already dirty).
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const persistedSelection = await readModelSelection()
        if (!persistedSelection || cancelled || modelSelectionDirtyRef.current) {
          return
        }

        setModelId(persistedSelection.modelId)
        setReasoningEffort(persistedSelection.reasoningEffort)
      } catch (error) {
        if (!cancelled) {
          runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [runtime.conversationStore])

  // Live context usage tracking — updates whenever messages or model change
  useEffect(() => {
    let cancelled = false
    const used = estimateContextTokens(
      conversation.messages.map((m) => ({ ...m, timestamp: m.timestamp })),
    )

    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setContextUsage({ used, max: 128_000 })
      return
    }

    void getModelContextLength(modelId, trimmedKey).then((contextLength) => {
      if (!cancelled) {
        setContextUsage({ used, max: contextLength })
      }
    })

    return () => {
      cancelled = true
    }
  }, [conversation.messages, modelId, apiKey])

  // Handle launch-time session restoration (-c, -r, resume-picker).
  useEffect(() => {
    if (launchHandledRef.current) {
      return
    }
    launchHandledRef.current = true

    if (launchOptions.mode === 'new') {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        if (launchOptions.mode === 'continue') {
          const latest = await runtime.resumeLatestConversation()
          if (!latest) {
            await runtime.resetConversation()
            runtime.conversationStore.setError('No saved conversations found. Started a new conversation instead.')
          }
          return
        }

        if (launchOptions.mode === 'resume-id' && launchOptions.conversationId) {
          try {
            await runtime.resumeConversation(launchOptions.conversationId)
          } catch (error) {
            await runtime.resetConversation()
            runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
          }
          return
        }

        if (launchOptions.mode === 'resume-picker') {
          await refreshSessionPicker(launchOptions.query ?? '')
        }
      } finally {
        if (!cancelled) {
          setSessionInitializing(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [launchOptions, refreshSessionPicker, runtime])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollbox = scrollboxRef.current
    if (!scrollbox) {
      return
    }

    const viewportHeight = scrollbox.viewport.height ?? 0
    const maxScrollTop = Math.max(0, scrollbox.scrollHeight - viewportHeight)
    scrollbox.scrollTo(maxScrollTop)
  }, [conversation.messages])

  // Elapsed timer while a turn is running
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

  // Animated spinner while the assistant is streaming
  useEffect(() => {
    if (conversation.status !== 'running') {
      setResponseSpinnerFrame(0)
      return
    }

    setResponseSpinnerFrame(0)
    const intervalId = setInterval(() => {
      setResponseSpinnerFrame((current) => (current + 1) % responseSpinnerFrames.length)
    }, responseSpinnerIntervalMs)

    return () => {
      clearInterval(intervalId)
    }
  }, [conversation.status])

  // Load plan content when a plan approval request becomes active
  useEffect(() => {
    const req = permissionSnapshot.activeRequest
    if (req?.metadata?.isPlanApproval) {
      readPlan(conversation.conversationId).then(
        (content) => setActivePlanContent(content),
        () => setActivePlanContent(null),
      )
    } else {
      setActivePlanContent(null)
    }
  }, [permissionSnapshot.activeRequest, conversation.conversationId])

  // Reset explanation toggle when permission request changes
  useEffect(() => {
    setPermissionExplainOpen(false)
  }, [permissionSnapshot.activeRequest])

  useKeyboard(
    useCallback(
      async (key: ParsedKey) => {
        // Scroll shortcuts work globally regardless of overlays
        const scrollShortcut = matchShortcut(key)
        if (scrollShortcut) {
          const sb = scrollboxRef.current
          if (sb) {
            const pageHeight = sb.viewport.height ?? 20
            switch (scrollShortcut.action) {
              case 'scroll-page-up':
                sb.scrollTo(Math.max(0, sb.scrollTop - pageHeight))
                return
              case 'scroll-page-down': {
                const maxScroll = Math.max(0, sb.scrollHeight - pageHeight)
                sb.scrollTo(Math.min(maxScroll, sb.scrollTop + pageHeight))
                return
              }
              case 'scroll-top':
                sb.scrollTo(0)
                return
              case 'scroll-bottom': {
                const maxScroll = Math.max(0, sb.scrollHeight - (sb.viewport.height ?? 0))
                sb.scrollTo(maxScroll)
                return
              }
            }
          }
        }

        // Transcript mode: ctrl+o toggles, q/Escape/ctrl+c exits
        if (scrollShortcut?.action === 'toggle-transcript') {
          setTranscriptMode((prev) => !prev)
          return
        }
        if (transcriptMode) {
          if (key.name === 'q' || key.name === 'escape' || (key.name === 'c' && key.ctrl)) {
            setTranscriptMode(false)
            return
          }
        }

        // Permission dialog shortcuts
        if (permissionSnapshot.activeRequest) {
          if (key.name === 'y' || key.name === 'return' || key.name === 'enter') {
            await runtime.permissionEngine.resolve(permissionSnapshot.activeRequest.id, 'allow')
            return
          }
          if (key.name === 'n' || key.name === 'escape') {
            await runtime.permissionEngine.resolve(permissionSnapshot.activeRequest.id, 'deny')
            return
          }
          // Shift+Tab cycles permission mode within the dialog
          const permShortcut = matchShortcut(key)
          if (permShortcut?.action === 'cycle-permission') {
            const newMode = runtime.permissionEngine.cycleMode()
            if (newMode === 'Auto-accept' && permissionSnapshot.activeRequest) {
              await runtime.permissionEngine.resolve(permissionSnapshot.activeRequest.id, 'allow')
            }
            return
          }
          if (permShortcut?.action === 'permission-explain') {
            setPermissionExplainOpen((prev) => !prev)
            return
          }
          return
        }

        if (questionSnapshot.activeRequest) {
          if (questionController.handleKey(key)) {
            return
          }
          return
        }

        if (mcpOverlayOpen) {
          if (key.name === 'escape') {
            setMcpOverlayOpen(false)
          }
          return
        }

        if (sessionPickerState.isOpen) {
          if (key.name === 'escape') {
            if (conversation.initialized) {
              dismissSessionPicker()
            } else {
              await startFreshConversation()
            }
            return
          }

          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            moveSessionSelection(-1)
            return
          }

          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            moveSessionSelection(1)
            return
          }
        }

        if (conversation.error && key.name === 'escape') {
          runtime.conversationStore.setError(null)
          return
        }

        if (!modelPickerState.isOpen) {
          return
        }

        if (key.name === 'escape') {
          closeModelPicker()
          return
        }

        if (modelPickerState.mode === 'list') {
          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            moveModelSelection(-1)
            return
          }
          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            moveModelSelection(1)
          }
        }
      },
      [
        closeModelPicker,
        conversation.error,
        conversation.initialized,
        dismissSessionPicker,
        modelPickerState.isOpen,
        modelPickerState.mode,
        moveModelSelection,
        moveSessionSelection,
        permissionSnapshot.activeRequest,
        questionSnapshot.activeRequest,
        questionController,
        runtime.conversationStore,
        runtime.permissionEngine,
        sessionPickerState.isOpen,
        startFreshConversation,
        mcpOverlayOpen,
        transcriptMode,
      ],
    ),
  )

  const performSubmit = useCallback(
    async (value: string, { signal }: { signal: AbortSignal }) => {
      /**
       * Handle `:goal` and `/goal` commands. Supports show, clear, set, and run
       * actions, and automatically injects the goal as a system prompt before
       * sending the user message to the runner.
       */
      const handleGoalCommand = async (
        argument: string,
        commandName: ':goal' | '/goal',
        goalSignal: AbortSignal,
      ): Promise<boolean> => {
        const command = parseGoalCommand(argument)
        const currentMessages = runtime.conversationStore.getSnapshot().messages

        if (command.action === 'show') {
          const goal = getConversationGoal(currentMessages)
          await runtime.conversationStore.pushMessage({
            id: randomUUID(),
            role: 'system',
            content: goal ? `Current goal: ${goal}` : `No goal is set. Use ${commandName} <goal> to set one.`,
            timestamp: new Date().toISOString(),
          })
          return true
        }

        if (command.action === 'clear') {
          await runtime.conversationStore.replaceMessages(clearConversationGoal(currentMessages))
          await runtime.conversationStore.pushMessage({
            id: randomUUID(),
            role: 'system',
            content: 'Cleared the conversation goal.',
            timestamp: new Date().toISOString(),
          })
          return true
        }

        if (command.action === 'set') {
          if (!command.goal) {
            runtime.conversationStore.setError(`Usage: ${commandName} set <goal>`)
            return true
          }

          await runtime.conversationStore.replaceMessages(setConversationGoal(currentMessages, command.goal))
          const goal = getConversationGoal(runtime.conversationStore.getSnapshot().messages) ?? command.goal
          await runtime.conversationStore.pushMessage({
            id: randomUUID(),
            role: 'system',
            content: `Goal saved: ${goal}`,
            timestamp: new Date().toISOString(),
          })
          return true
        }

        const goal = command.goal ?? getConversationGoal(currentMessages)
        if (!goal) {
          runtime.conversationStore.setError(
            `No goal is set. Use ${commandName} run <goal> or ${commandName} <goal> first.`,
          )
          return true
        }

        if (modelRequiresApiKey(modelId) && !apiKey.trim()) {
          runtime.conversationStore.setError('Set an OpenRouter API key before running a goal (:key <token>).')
          return true
        }

        await runtime.conversationStore.replaceMessages(setConversationGoal(currentMessages, goal))
        const prompt = buildGoalRunPrompt(goal)
        await runtime.conversationStore.pushMessage({
          id: randomUUID(),
          role: 'user',
          content: prompt,
          timestamp: new Date().toISOString(),
        })

        try {
          await runtime.conversationRunner.runTurn({
            userInput: prompt,
            apiKey: apiKey.trim(),
            modelId,
            reasoningEffort,
            showReasoning: thinkingEnabled,
            signal: goalSignal,
          })
        } catch {
          // Error already surfaced via conversationStore.setError by the runner.
        }
        return true
      }

      const routed = routeInput(value)
      if (routed.kind === 'prompt') {
        if (!routed.value) {
          setInputValue('')
          return
        }

        if (modelRequiresApiKey(modelId) && !apiKey.trim()) {
          runtime.conversationStore.setError('Set an OpenRouter API key before chatting (:key <token>).')
          return
        }

        if (!conversation.initialized) {
          await runtime.resetConversation()
        }

        const userMessage = {
          id: randomUUID(),
          role: 'user' as const,
          content: routed.value,
          timestamp: new Date().toISOString(),
        }
        await runtime.conversationStore.pushMessage(userMessage)
        try {
          await runtime.conversationRunner.runTurn({
            userInput: routed.value,
            apiKey: apiKey.trim(),
            modelId,
            reasoningEffort,
            showReasoning: thinkingEnabled,
            signal,
          })
        } catch {
          // Error already surfaced via conversationStore.setError by the runner.
        }
        return
      }

      if (routed.channel === 'colon') {
        if (routed.name === 'model') {
          if (!routed.argument) {
            runtime.conversationStore.setError('Usage: :model <model-id>')
            return
          }
          persistModelSelection(routed.argument, null)
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
          await startFreshConversation()
          return
        }

        if (routed.name === 'resume') {
          openSessionPicker(routed.argument)
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
          try {
            const result = await runtime.conversationRunner.compact({ apiKey: apiKey.trim() || undefined, modelId })
            if (result.compacted) {
              await runtime.conversationStore.pushMessage({
                id: randomUUID(),
                role: 'system',
                content: `Compacted conversation: ${result.summarizedCount} older messages summarized.`,
                timestamp: new Date().toISOString(),
              })
            } else {
              await runtime.conversationStore.pushMessage({
                id: randomUUID(),
                role: 'system',
                content: 'No compaction needed — context is within limits.',
                timestamp: new Date().toISOString(),
              })
            }
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
            await runtime.conversationStore.pushMessage({
              id: randomUUID(),
              role: 'system',
              content: `Forked conversation → ${result.conversationId.slice(0, 8)} (${result.messageCount} messages copied).`,
              timestamp: new Date().toISOString(),
            })
          } catch (error) {
            runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
          }
          return
        }

        if (routed.name === 'tree') {
          try {
            const tree = await runtime.getConversationTree()
            await runtime.conversationStore.pushMessage({
              id: randomUUID(),
              role: 'system',
              content: `Conversation tree:\n\n${tree}`,
              timestamp: new Date().toISOString(),
            })
          } catch (error) {
            runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
          }
          return
        }

        if (routed.name === 'goal') {
          const handled = await handleGoalCommand(routed.argument, ':goal', signal)
          if (handled) {
            return
          }
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
        clearComposer()
        openModelPicker(routed.argument)
        if (routed.argument && modelPickerState.fetchState === 'success') {
          handleFilterSubmit(routed.argument)
        }
        return
      }

      if (routed.kind === 'local-ui' && routed.channel === 'slash' && routed.name === 'resume') {
        clearComposer()
        openSessionPicker(routed.argument)
        return
      }

      if (routed.channel === 'template') {
        const execution = await executePromptTemplate(routed.name, routed.argument)
        if (!execution) {
          runtime.conversationStore.setError(`Unknown prompt template: @${routed.name}`)
          return
        }

        if (modelRequiresApiKey(modelId) && !apiKey.trim()) {
          runtime.conversationStore.setError('Set an OpenRouter API key before chatting (:key <token>).')
          return
        }

        if (!conversation.initialized) {
          await runtime.resetConversation()
        }

        await runtime.conversationStore.pushMessage({
          id: randomUUID(),
          role: 'user',
          content: execution.content,
          timestamp: new Date().toISOString(),
        })

        try {
          await runtime.conversationRunner.runTurn({
            userInput: execution.content,
            apiKey: apiKey.trim(),
            modelId,
            reasoningEffort,
            showReasoning: thinkingEnabled,
            signal,
          })
        } catch {
          // Error already surfaced via conversationStore.setError by the runner.
        }
        return
      }

      if (routed.channel === 'slash') {
        if (routed.name === 'clear') {
          await startFreshConversation()
          return
        }

        if (routed.name === 'goal') {
          const handled = await handleGoalCommand(routed.argument, '/goal', signal)
          if (handled) {
            return
          }
        }

        const execution = await executeSlashCommand(routed.name, routed.argument)
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
          id: randomUUID(),
          role: 'user',
          content: rendered,
          timestamp: new Date().toISOString(),
        })

        if (modelRequiresApiKey(modelId) && !apiKey.trim()) {
          runtime.conversationStore.setError('Set an OpenRouter API key before chatting (:key <token>).')
          return
        }

        try {
          await runtime.conversationRunner.runTurn({
            userInput: rendered,
            apiKey: apiKey.trim(),
            modelId,
            reasoningEffort,
            showReasoning: thinkingEnabled,
            signal,
          })
        } catch {
          // Error already surfaced via conversationStore.setError by the runner.
        }
      }
    },
    [
      apiKey,
      conversation.initialized,
      clearComposer,
      handleFilterSubmit,
      modelId,
      modelPickerState.fetchState,
      openModelPicker,
      openSessionPicker,
      persistModelSelection,
      reasoningEffort,
      runtime,
      startFreshConversation,
      thinkingEnabled,
    ],
  )

  const setConversationMessages = useCallback(
    (next: SetStateAction<UIMessage[]>) => {
      const resolvedMessages =
        typeof next === 'function' ? next(interactiveMessages) : next

      void runtime.conversationStore.replaceMessages(
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
        setBackgroundTasksOpen(true)
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
    onToggleBackgroundTasks: () => {
      setBackgroundTasksOpen((current) => !current)
    },
  })

  useEffect(() => {
    setThinkingEnabled(interactive.thinkingEnabled)
  }, [interactive.thinkingEnabled])

  // Process follow-up queue when a turn completes
  useEffect(() => {
    if (conversation.status !== 'idle') return
    const next = interactive.drainFollowUp()
    if (next) {
      void interactive.handleSubmit(next)
    }
  }, [conversation.status, interactive])

  // Sync external inputValue changes into the textarea buffer
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    if (ta.plainText !== inputValue) {
      ta.setText(inputValue)
    }
  }, [inputValue])

  const handleTextareaContentChange = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const text = ta.plainText
    interactive.handleInput(text)
  }, [interactive])

  const handleTextareaSubmit = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const text = ta.plainText
    void interactive.handleSubmit(text)
  }, [interactive])

  const handleInputSubmit = useCallback(
    (value: unknown) => {
      if (typeof value === 'string') {
        void interactive.handleSubmit(value)
      }
    },
    [interactive.handleSubmit],
  )

  // Auto-copy text selection to clipboard via OSC 52
  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      const text = selection.getSelectedText()
      if (text?.trim() && renderer.isOsc52Supported()) {
        renderer.copyToClipboardOSC52(text)
      }
    }
    renderer.on('selection', handleSelection)
    return () => {
      renderer.off('selection', handleSelection)
    }
  }, [renderer])

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

      if (renderer.isOsc52Supported()) {
        renderer.copyToClipboardOSC52(selectedText)
      } else {
        void copyTextToClipboard(selectedText).catch((error) => {
          runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
        })
      }
    },
    [renderer, runtime.conversationStore],
  )

  const [gitBranch, setGitBranch] = useState<string>('')

  // Detect current git branch for the status bar
  useEffect(() => {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    Promise.all([new Response(proc.stdout).text(), proc.exited])
      .then(([branch, exitCode]) => {
        setGitBranch(exitCode === 0 ? branch.trim() : '')
      })
      .catch(() => setGitBranch(''))
  }, [])

  const modelDisplay = reasoningEffort ? `${modelId} (effort: ${reasoningEffort})` : modelId
  const followUpCount = interactive.followUpQueue.length
  const statusDisplay =
    conversation.status === 'running' && statusElapsed
      ? `running - ${statusElapsed}${followUpCount > 0 ? ` (${followUpCount} queued)` : ''}`
      : conversation.status
  const responseSpinner = responseSpinnerFrames[responseSpinnerFrame] ?? responseSpinnerFrames[0]
  const permissionModeColor =
    permissionSnapshot.mode === 'Auto-accept'
      ? '#7ee787'
      : permissionSnapshot.mode === 'Plan'
        ? '#79c0ff'
        : permissionSnapshot.mode === 'Normal'
          ? '#f2cc60'
          : theme.statusFg
  const isPermissionDialogOpen = Boolean(permissionSnapshot.activeRequest)
  const isQuestionDialogOpen = Boolean(questionSnapshot.activeRequest)
  const isMainInputFocused =
    !modelPickerState.isOpen &&
    !sessionPickerState.isOpen &&
    !isPermissionDialogOpen &&
    !isQuestionDialogOpen &&
    !sessionInitializing
  const isModelPickerFocused = modelPickerState.isOpen && !isPermissionDialogOpen && !isQuestionDialogOpen
  const isSessionPickerFocused =
    sessionPickerState.isOpen && !isPermissionDialogOpen && !isQuestionDialogOpen && !modelPickerState.isOpen
  const isQuestionOverlayFocused = isQuestionDialogOpen && !isPermissionDialogOpen
  const backgroundTasks = taskSnapshot.tasks.filter((task) => task.background)
  const activeBackgroundTasks = backgroundTasks.filter((task) => isActiveBackgroundTaskStatus(task.status))
  const recentBackgroundTasks = backgroundTasks
    .filter((task) => !isActiveBackgroundTaskStatus(task.status))
    .slice(0, 8)

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      paddingX={layout.screenPadding}
      backgroundColor={theme.background}
      onMouseUp={handleMouseUp}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingBottom={1}
      >
        <text fg={theme.systemFg}>
          GAMBIT |  <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{sessionTimestampFormatter.format(new Date())}</span>
        </text>
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
          <box marginTop={1}>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Press Esc to dismiss" />
          </box>
        </box>
      ) : null}

      <ConversationPanel messages={conversation.messages} scrollboxRef={scrollboxRef} transcriptMode={transcriptMode} />

      {interactive.historySearch.active ? (
        <box
          flexDirection="column"
          paddingY={1}
          paddingX={layout.panelPaddingX}
        >
          <text
            fg={theme.headerAccent}
            attributes={TextAttributes.BOLD}
            content={`reverse-search: ${interactive.historySearch.query || '...'}${interactive.historySearch.match ? ` -> ${interactive.historySearch.match}` : ''
              }`}
          />
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content="Esc to cancel, Ctrl+R to search older matches"
          />
        </box>
      ) : null}

      {interactive.exitPending ? (
        <box paddingY={0} paddingX={layout.panelPaddingX}>
          <text fg="#ff6b6b" attributes={TextAttributes.BOLD} content="Press again to exit." />
        </box>
      ) : null}

      {transcriptMode ? (
        <box paddingY={0} paddingX={layout.panelPaddingX}>
          <text fg={theme.headerAccent} attributes={TextAttributes.DIM} content="Transcript mode — press q, Esc, or Ctrl+C to exit" />
        </box>
      ) : null}

      {sessionInitializing ? (
        <box paddingY={1} paddingX={layout.panelPaddingX}>
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content="Preparing conversation session…"
          />
        </box>
      ) : null}

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
          onOptionSelect={(index, modelOptionId) => {
            if (modelOptionId) {
              selectModelById(modelOptionId)
              return
            }
            selectModelByIndex(index)
          }}
        />
      ) : null}

      {sessionPickerState.isOpen ? (
        <SessionPickerOverlay
          isOpen={sessionPickerState.isOpen}
          hasFocus={isSessionPickerFocused}
          filterValue={sessionPickerState.filterValue}
          selectedIndex={sessionPickerState.selectedIndex}
          fetchState={sessionPickerState.fetchState}
          fetchError={sessionPickerState.fetchError}
          options={sessionPickerOptions}
          onFilterChange={handleSessionFilterChange}
          onFilterSubmit={handleSessionFilterSubmit}
          onOptionChange={setSessionSelection}
          onOptionSelect={(index) => {
            void selectSessionByIndex(index)
          }}
        />
      ) : null}

      {mcpOverlayOpen ? <MCPServerManagerOverlay servers={listMCPServerConfigs()} /> : null}

      {permissionSnapshot.activeRequest ? (
        permissionSnapshot.activeRequest.metadata?.isPlanApproval ? (
          <PlanApprovalOverlay
            request={permissionSnapshot.activeRequest}
            planContent={activePlanContent}
          />
        ) : (
          <PermissionOverlay request={permissionSnapshot.activeRequest} showExplanation={permissionExplainOpen} />
        )
      ) : null}

      {isQuestionDialogOpen ? (
        <AskUserQuestionOverlay controller={questionController} hasFocus={isQuestionOverlayFocused} />
      ) : null}

      {backgroundTasksOpen ? (
        <box
          flexDirection="column"
          border={['top', 'bottom', 'left', 'right']}
          borderStyle="rounded"
          paddingX={1}
          paddingY={1}
          marginBottom={1}
          style={{
            borderColor: theme.bodyBorder,
            backgroundColor: theme.background,
          }}
        >
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Background tasks" />
          {activeBackgroundTasks.length === 0 && recentBackgroundTasks.length === 0 ? (
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No background tasks yet." />
          ) : null}
          {activeBackgroundTasks.length > 0 ? (
            activeBackgroundTasks.map((task) => (
              <box key={task.id} flexDirection="column">
                <text
                  fg={theme.assistantFg}
                  content={`- ${task.id.slice(0, 8)} [${task.status}] ${formatTaskTitle(task.title)}`}
                />
                {task.progressSummary ? (
                  <text
                    fg={theme.statusFg}
                    attributes={TextAttributes.DIM}
                    content={`  ${task.progressSummary.slice(0, 80)}`}
                  />
                ) : null}
              </box>
            ))
          ) : (
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No active background tasks." />
          )}
          {recentBackgroundTasks.length > 0 ? (
            <>
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Recent" />
              {recentBackgroundTasks.map((task) => (
                <box key={task.id} flexDirection="column">
                  <text
                    fg={theme.statusFg}
                    attributes={TextAttributes.DIM}
                    content={`- ${task.id.slice(0, 8)} [${task.status}] ${formatTaskTitle(task.title)}`}
                  />
                  {task.progressSummary ? (
                    <text
                      fg={theme.statusFg}
                      attributes={TextAttributes.DIM}
                      content={`  ${task.progressSummary.slice(0, 80)}`}
                    />
                  ) : null}
                </box>
              ))}
            </>
          ) : null}
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Ctrl+B to close" />
        </box>
      ) : null}

      <box
        flexDirection="column"
        flexShrink={0}
        border={['top', 'bottom', 'left', 'right']}
        borderStyle="rounded"
        minHeight={6}
        justifyContent="space-between"
        style={{
          borderColor: theme.bodyBorder,
          backgroundColor: theme.background,
        }}
      >
        <box flexDirection="column" gap={inputPreview ? 1 : 0} padding={0}>
          {inputPreview ? <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={inputPreview} /> : null}
          <box
            flexDirection="row"
            paddingLeft={1}
            paddingBottom={2}
          >
            <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="› " />
            <box flexGrow={1} flexDirection="column">
              <textarea
                ref={textareaRef}
                initialValue={inputValue}
                onContentChange={handleTextareaContentChange}
                onSubmit={handleTextareaSubmit}
                focused={isMainInputFocused}
                backgroundColor={theme.background}
                focusedBackgroundColor={theme.background}
                textColor={theme.userFg}
                placeholderColor={theme.statusFg}
                placeholder="Ask anything or @ tag files/folders"
                cursorColor={theme.headerAccent}
                wrapMode="word"
                keyBindings={textareaKeyBindings}
              />
            </box>
          </box>
        </box>

        <box 
        flexDirection="row" 
        gap={3} 
        paddingLeft={1}
        paddingBottom={0}>
          <text fg={theme.headerAccent} content={`* ${modelDisplay}`} />
          <text fg={theme.statusFg} content={thinkingEnabled ? '◉ Thinking' : '○ Direct'} />
          <text fg={permissionModeColor} content={`◇ ${permissionSnapshot.mode}`} />
        </box>
      </box>

      <box flexDirection="row" flexShrink={0} justifyContent="space-between" paddingX={1}>
        <box flexDirection="row" gap={3}>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={'◈ Local'} />
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`⑂ ${gitBranch || 'unknown'}`} />
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content={`◦ ${conversation.conversationId.slice(0, 8)}`}
          />
          {conversation.status === 'running' ? (<text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content={responseSpinner} />) : <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`•`} />}
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`${statusDisplay}`} />
        </box>
        <box flexDirection="row" gap={3}>
          {contextUsage ? (
            <text
              fg={
                contextUsage.used / contextUsage.max > 0.85
                  ? '#ff6b6b'
                  : contextUsage.used / contextUsage.max > 0.6
                    ? '#f2cc60'
                    : theme.statusFg
              }
              attributes={TextAttributes.DIM}
              content={`ctx ${formatTokenCount(contextUsage.used)}/${formatTokenCount(contextUsage.max)} (${Math.round((contextUsage.used / contextUsage.max) * 100)}%)`}
            />
          ) : null}
          <TaskPanel tasks={activeBackgroundTasks} />
        </box>
      </box>
    </box>
  )
}
