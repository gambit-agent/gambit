import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"
import { useAppContext } from "@opentui/react"
import type { ParsedKey } from "@opentui/core"

import { DOUBLE_ESC_INTERVAL_MS } from "../../config"
import type { UIMessage } from "../../types/chat"
import {
  resolveDownArrowAction,
  resolveUpArrowAction,
  type ComposerCursor,
} from "./composer-navigation"
import { useFollowUpQueue } from "./follow-up-queue"
import type { InteractiveHistory } from "./history"
import { usePasteDetection } from "./paste-detection"
import { InteractiveSession, type PermissionMode } from "./session"
import { matchShortcut } from "./shortcuts"
import { useExitShortcuts } from "./useExitShortcuts"
import { useInteractiveHistorySearch, type HistorySearchState } from "./useInteractiveHistorySearch"
import { useInteractiveKeyboard } from "./useInteractiveKeyboard"

type SubmitOptions = { signal: AbortSignal }

/**
 * What `handleSubmit` did with the value:
 * - 'submitted': a model run was started (resolves when the run finishes).
 * - 'queued': a run was already active, so the value was queued as a follow-up.
 * - 'continuation': the value ended in '\'; it was stuffed back into the
 *   composer as a multi-line draft and nothing was submitted.
 * - 'empty': the value was blank; nothing happened.
 */
export type SubmitOutcome = 'submitted' | 'queued' | 'continuation' | 'empty'

export interface HandleSubmitOptions {
  /**
   * Set by the follow-up drain. If the value cannot run because a run is
   * already active, it is requeued at the HEAD of the follow-up queue
   * (instead of the tail) so FIFO order is preserved.
   */
  fromFollowUpDrain?: boolean
}

export interface UseInteractiveControllerOptions {
  inputValue: string
  setInputValue: Dispatch<SetStateAction<string>>
  inputPreview: string | null
  setInputPreview: Dispatch<SetStateAction<string | null>>
  messages: UIMessage[]
  setMessages: Dispatch<SetStateAction<UIMessage[]>>
  isRunning: boolean
  permissionMode?: PermissionMode
  onCyclePermissionMode?: () => void
  performSubmit: (value: string, options: SubmitOptions) => Promise<void>
  onAbort?: () => void
  onRewind?: () => void
  onBackgroundRequest?: (command: string) => boolean
  onToggleBackgroundTasks?: () => void
  /**
   * Invoked synchronously whenever a submission is accepted (a run starts or
   * the value is queued as a follow-up). Used by the REPL to scroll the
   * conversation to the bottom on the user's own submission.
   */
  onSubmitted?: () => void
  keyboardEnabled?: boolean
  historyNavigationEnabled?: boolean
  completionNavigationActive?: boolean
  /**
   * Returns the composer cursor position so bare up/down only navigate
   * history from the first/last line of a multi-line draft. When omitted,
   * navigation behaves as if the composer were single-line.
   */
  getComposerCursor?: () => ComposerCursor | null
}

export interface UseInteractiveControllerResult {
  thinkingEnabled: boolean
  permissionMode: PermissionMode
  historySearch: HistorySearchState
  exitPending: boolean
  followUpQueue: string[]
  handleSubmit: (value: string, options?: HandleSubmitOptions) => Promise<SubmitOutcome>
  handleInput: (value: string) => void
  exitHistorySearch: () => void
  drainFollowUp: () => string | undefined
  /** Synchronous run indicator (flips in `startRun`, before store snapshots update). */
  isRunActive: () => boolean
}

export function useInteractiveController({
  inputValue,
  setInputValue,
  inputPreview,
  setInputPreview,
  messages,
  setMessages,
  isRunning,
  permissionMode: externalPermissionMode,
  onCyclePermissionMode,
  performSubmit,
  onAbort,
  onRewind,
  onBackgroundRequest,
  onToggleBackgroundTasks,
  onSubmitted,
  keyboardEnabled = true,
  historyNavigationEnabled = true,
  completionNavigationActive = false,
  getComposerCursor,
}: UseInteractiveControllerOptions): UseInteractiveControllerResult {
  // Lazy init so the session is only constructed once, not on every render.
  const lazySessionRef = useRef<InteractiveSession | null>(null)
  if (lazySessionRef.current === null) {
    lazySessionRef.current = new InteractiveSession()
  }
  const sessionRef = lazySessionRef as MutableRefObject<InteractiveSession>
  const historyRef = useRef<InteractiveHistory | null>(null)
  // The session is the single source of truth for the thinking toggle; the
  // React state mirrors it for rendering.
  const [thinkingEnabled, setThinkingEnabled] = useState(() => sessionRef.current.isThinkingEnabled)
  const [localPermissionMode, setLocalPermissionMode] = useState<PermissionMode>("Normal")
  const {
    followUpQueue,
    enqueueFollowUp,
    drainFollowUp,
    popFollowUp,
    requeueFrontFollowUp,
    getFollowUpQueueSize,
  } = useFollowUpQueue()
  const lastEscTimestamp = useRef<number | null>(null)
  const stashedPromptRef = useRef<string | null>(null)
  // Provenance of composer content that was popped off the follow-up queue,
  // so down-arrow can re-enqueue it instead of navigating history.
  const poppedFollowUpRef = useRef<string | null>(null)
  const { renderer } = useAppContext()
  const inputValueRef = useRef(inputValue)
  const suppressNextInputRef = useRef(false)
  const permissionMode = externalPermissionMode ?? localPermissionMode
  const { exitPending, handleAbortRun, handleExitSession } = useExitShortcuts({ renderer, sessionRef, onAbort })

  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  const setInputValueWithRef = useCallback(
    (next: SetStateAction<string>) => {
      if (typeof next === "function") {
        setInputValue((prev) => {
          const computed = (next as (value: string) => string)(prev)
          inputValueRef.current = computed
          return computed
        })
      } else {
        setInputValue(next)
        inputValueRef.current = next
      }
    },
    [setInputValue],
  )

  const {
    inputPreviewRef,
    lastPasteLabelRef,
    clearPreviewLabel,
    detectInferredPaste,
  } = usePasteDetection({
    renderer,
    inputPreview,
    setInputPreview,
    setInputValueWithRef,
    historyRef,
    suppressNextInputRef,
    enabled: keyboardEnabled,
  })

  const {
    historySearch,
    ensureHistoryLoaded,
    persistHistory,
    exitHistorySearch,
    handleHistoryNavigation,
    updateHistorySearch,
  } = useInteractiveHistorySearch({
    historyRef,
    suppressNextInputRef,
    setInputValueWithRef,
    clearPreviewLabel,
    getCurrentInputValue: useCallback(() => inputValueRef.current, []),
  })

  const handleSubmit = useCallback(
    async (displayValue: string, options?: HandleSubmitOptions): Promise<SubmitOutcome> => {
      const session = sessionRef.current
      const previewLabel = inputPreviewRef.current
      const actualValue = previewLabel ? inputValueRef.current : displayValue

      if (actualValue.endsWith("\\")) {
        suppressNextInputRef.current = true
        setInputValueWithRef(`${actualValue.slice(0, -1)}\n`)
        clearPreviewLabel()
        return "continuation"
      }

      const trimmed = actualValue.trim()
      if (!trimmed) {
        setInputValueWithRef("")
        clearPreviewLabel()
        return "empty"
      }

      poppedFollowUpRef.current = null

      // `isRunning` comes from a store snapshot that lags behind the actual
      // submission; `session.isRunActive` flips synchronously in `startRun`,
      // so a rapid double-Enter queues a follow-up instead of double-running.
      if (isRunning || session.isRunActive) {
        if (options?.fromFollowUpDrain) {
          // The value was just drained from the head of the queue; putting it
          // back at the tail would rotate FIFO order, so requeue at the head.
          requeueFrontFollowUp(trimmed)
        } else {
          enqueueFollowUp(trimmed)
        }
        clearPreviewLabel()
        setInputValueWithRef("")
        onSubmitted?.()
        return "queued"
      }

      session.pushSnapshot(messages)
      const signal = session.startRun()

      clearPreviewLabel()
      setInputValueWithRef("")
      onSubmitted?.()

      void (async () => {
        try {
          const history = await ensureHistoryLoaded()
          history.clearCursor()
          history.add(trimmed)
          await persistHistory()
        } catch (error) {
          console.warn("Failed to record submitted prompt history", error)
        }
      })()

      try {
        await performSubmit(actualValue, { signal })
      } finally {
        session.clearRun()
      }
      return "submitted"
    },
    [
      clearPreviewLabel,
      ensureHistoryLoaded,
      enqueueFollowUp,
      isRunning,
      messages,
      onSubmitted,
      performSubmit,
      persistHistory,
      requeueFrontFollowUp,
      setInputValueWithRef,
    ],
  )

  const handleInput = useCallback(
    (value: string) => {
      if (historySearch.active) {
        return
      }

      const previousValue = inputValueRef.current
      historyRef.current?.clearCursor()

      if (suppressNextInputRef.current) {
        suppressNextInputRef.current = false
        setInputValueWithRef(value)
        return
      }

      setInputValueWithRef(value)

      if (lastPasteLabelRef.current && previousValue !== value) {
        clearPreviewLabel()
        return
      }

      if (previousValue === value) {
        return
      }

      detectInferredPaste(previousValue, value)
    },
    [clearPreviewLabel, detectInferredPaste, historySearch.active, setInputValueWithRef],
  )

  const handleEscape = useCallback(() => {
    if (historySearch.active) {
      exitHistorySearch()
      return
    }

    const now = Date.now()
    if (lastEscTimestamp.current && now - lastEscTimestamp.current <= DOUBLE_ESC_INTERVAL_MS) {
      const snapshot = sessionRef.current.popSnapshot()
      if (snapshot) {
        sessionRef.current.abortRun()
        setMessages(snapshot)
        onRewind?.()
      }
      lastEscTimestamp.current = null
      return
    }

    lastEscTimestamp.current = now
  }, [exitHistorySearch, historySearch.active, setMessages])

  const handleShortcut = useCallback(
    (key: ParsedKey) => {
      const match = matchShortcut(key)
      if (!match) {
        return false
      }

      switch (match.action) {
        case "abort-run": {
          handleAbortRun()
          return match.preventDefault ?? false
        }
        case "exit-session": {
          handleExitSession()
          return match.preventDefault ?? false
        }
        case "clear-screen": {
          try {
            renderer?.console?.clear()
          } catch (error) {
          }
          return match.preventDefault ?? false
        }
        case "history-search": {
          if (!historySearch.active) {
            updateHistorySearch("")
          } else {
            updateHistorySearch(historySearch.query, true)
          }
          return match.preventDefault ?? false
        }
        case "history-previous": {
          if (!historyNavigationEnabled || historySearch.active) {
            return false
          }
          // Read the length synchronously from the queue ref: the React
          // snapshot lags mutations, so two key events in one frame would
          // misroute (history recall instead of pop, or a pop of undefined).
          const action = resolveUpArrowAction({
            composerValue: inputValueRef.current,
            followUpQueueLength: getFollowUpQueueSize(),
            cursor: getComposerCursor?.() ?? null,
          })
          if (action === "pop-follow-up") {
            // A queued follow-up takes priority: up-arrow on an empty composer
            // pulls the most recently queued message back for editing.
            const queued = popFollowUp()
            if (queued !== undefined) {
              clearPreviewLabel()
              if (queued !== inputValueRef.current) {
                suppressNextInputRef.current = true
                setInputValueWithRef(queued)
              }
              poppedFollowUpRef.current = queued
              return true
            }
            return false
          }
          if (action === "history-previous") {
            const popped = poppedFollowUpRef.current
            if (popped !== null) {
              // Navigating away from a popped follow-up puts it (or its
              // edited form) back in the queue first so it is never lost and
              // the history draft stash starts from an empty composer.
              poppedFollowUpRef.current = null
              enqueueFollowUp(inputValueRef.current.trim() || popped)
              if (inputValueRef.current !== "") {
                suppressNextInputRef.current = true
                setInputValueWithRef("")
              }
              handleHistoryNavigation("previous")
              return true
            }
            return handleHistoryNavigation("previous")
          }
          // Cursor is mid-draft: let the textarea move the cursor instead.
          return false
        }
        case "history-next": {
          if (!historyNavigationEnabled || historySearch.active) {
            return false
          }
          const action = resolveDownArrowAction({
            composerValue: inputValueRef.current,
            poppedFollowUp: poppedFollowUpRef.current,
            cursor: getComposerCursor?.() ?? null,
          })
          if (action === "re-enqueue-popped") {
            // Symmetric to the up-arrow pop: down-arrow restores the popped
            // follow-up (or its edited form) to the queue.
            const popped = poppedFollowUpRef.current
            poppedFollowUpRef.current = null
            const restored = inputValueRef.current.trim() || (popped ?? "")
            if (restored) {
              enqueueFollowUp(restored)
            }
            clearPreviewLabel()
            if (inputValueRef.current !== "") {
              suppressNextInputRef.current = true
              setInputValueWithRef("")
            }
            return true
          }
          if (action === "history-next") {
            return handleHistoryNavigation("next")
          }
          return false
        }
        case "toggle-thinking": {
          const enabled = sessionRef.current.toggleThinking()
          setThinkingEnabled(enabled)
          return match.preventDefault ?? false
        }
        case "cycle-permission": {
          if (onCyclePermissionMode) {
            onCyclePermissionMode()
          } else {
            const mode = sessionRef.current.cyclePermissionMode()
            setLocalPermissionMode(mode)
          }
          return match.preventDefault ?? false
        }
        case "newline": {
          clearPreviewLabel()
          return false
        }
        case "background": {
          const currentValue = inputValueRef.current
          const trimmed = currentValue.trim()
          if (!trimmed) {
            onToggleBackgroundTasks?.()
            return match.preventDefault ?? false
          }
          const handled = onBackgroundRequest ? onBackgroundRequest(trimmed) : false
          if (handled) {
            poppedFollowUpRef.current = null
            historyRef.current?.clearCursor()
            historyRef.current?.add(trimmed)
            void persistHistory()
            setInputValueWithRef("")
            clearPreviewLabel()
          }
          return match.preventDefault ?? false
        }
        case "follow-up": {
          const currentValue = inputValueRef.current.trim()
          if (currentValue) {
            poppedFollowUpRef.current = null
            enqueueFollowUp(currentValue)
            historyRef.current?.clearCursor()
            historyRef.current?.add(currentValue)
            void persistHistory()
            clearPreviewLabel()
            suppressNextInputRef.current = true
            setInputValueWithRef("")
          }
          return match.preventDefault ?? false
        }
        case "stash-prompt": {
          const currentValue = inputValueRef.current.trim()
          if (currentValue) {
            poppedFollowUpRef.current = null
            stashedPromptRef.current = currentValue
            clearPreviewLabel()
            suppressNextInputRef.current = true
            setInputValueWithRef("")
          } else if (stashedPromptRef.current) {
            clearPreviewLabel()
            suppressNextInputRef.current = true
            setInputValueWithRef(stashedPromptRef.current)
            stashedPromptRef.current = null
          }
          return match.preventDefault ?? false
        }
        default:
          return false
      }
    },
    [
      clearPreviewLabel,
      enqueueFollowUp,
      getComposerCursor,
      getFollowUpQueueSize,
      handleHistoryNavigation,
      historySearch,
      handleAbortRun,
      handleExitSession,
      historyNavigationEnabled,
      onBackgroundRequest,
      onToggleBackgroundTasks,
      onCyclePermissionMode,
      persistHistory,
      popFollowUp,
      setInputValueWithRef,
      updateHistorySearch,
    ],
  )

  useInteractiveKeyboard({
    historySearch,
    handleEscape,
    handleShortcut,
    updateHistorySearch,
    exitHistorySearch,
    enabled: keyboardEnabled,
    completionNavigationActive,
  })

  useEffect(() => {
    if (!isRunning) {
      sessionRef.current.clearRun()
    }
  }, [isRunning])

  const isRunActive = useCallback(() => sessionRef.current.isRunActive, [])

  return useMemo(
    () => ({
      thinkingEnabled,
      permissionMode,
      historySearch,
      exitPending,
      followUpQueue,
      handleSubmit,
      handleInput,
      exitHistorySearch,
      drainFollowUp,
      isRunActive,
    }),
    [drainFollowUp, exitHistorySearch, exitPending, followUpQueue, handleInput, handleSubmit, historySearch, isRunActive, permissionMode, thinkingEnabled],
  )
}
