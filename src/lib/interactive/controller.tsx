import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useAppContext } from "@opentui/react"
import type { ParsedKey } from "@opentui/core"

import { DOUBLE_ESC_INTERVAL_MS } from "../../config"
import type { UIMessage } from "../../types/chat"
import { useFollowUpQueue } from "./follow-up-queue"
import type { InteractiveHistory } from "./history"
import { usePasteDetection } from "./paste-detection"
import { InteractiveSession, type PermissionMode } from "./session"
import { matchShortcut } from "./shortcuts"
import { useExitShortcuts } from "./useExitShortcuts"
import { useInteractiveHistorySearch, type HistorySearchState } from "./useInteractiveHistorySearch"
import { useInteractiveKeyboard } from "./useInteractiveKeyboard"

type SubmitOptions = { signal: AbortSignal }

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
}

export interface UseInteractiveControllerResult {
  thinkingEnabled: boolean
  permissionMode: PermissionMode
  historySearch: HistorySearchState
  exitPending: boolean
  followUpQueue: string[]
  handleSubmit: (value: string) => Promise<void>
  handleInput: (value: string) => void
  exitHistorySearch: () => void
  drainFollowUp: () => string | undefined
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
}: UseInteractiveControllerOptions): UseInteractiveControllerResult {
  const sessionRef = useRef(new InteractiveSession())
  const historyRef = useRef<InteractiveHistory | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [localPermissionMode, setLocalPermissionMode] = useState<PermissionMode>("Normal")
  const { followUpQueue, enqueueFollowUp, drainFollowUp } = useFollowUpQueue()
  const lastEscTimestamp = useRef<number | null>(null)
  const stashedPromptRef = useRef<string | null>(null)
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
    inputValueRef,
    suppressNextInputRef,
    setInputValueWithRef,
    clearPreviewLabel,
  })

  const handleSubmit = useCallback(
    async (displayValue: string) => {
      const session = sessionRef.current
      const previewLabel = inputPreviewRef.current
      const actualValue = previewLabel ? inputValueRef.current : displayValue

      if (actualValue.endsWith("\\")) {
        suppressNextInputRef.current = true
        setInputValueWithRef(`${actualValue.slice(0, -1)}\n`)
        clearPreviewLabel()
        return
      }

      const trimmed = actualValue.trim()
      if (!trimmed) {
        setInputValueWithRef("")
        clearPreviewLabel()
        return
      }

      if (isRunning) {
        enqueueFollowUp(trimmed)
        clearPreviewLabel()
        setInputValueWithRef("")
        return
      }

      await ensureHistoryLoaded()

      historyRef.current?.clearCursor()
      historyRef.current?.add(trimmed)
      await persistHistory()

      session.pushSnapshot(messages)
      const signal = session.startRun()

      clearPreviewLabel()
      setInputValueWithRef("")

      try {
        await performSubmit(actualValue, { signal })
      } finally {
        session.clearRun()
      }
    },
    [
      clearPreviewLabel,
      ensureHistoryLoaded,
      enqueueFollowUp,
      isRunning,
      messages,
      performSubmit,
      persistHistory,
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
          if (!historySearch.active) {
            handleHistoryNavigation("previous")
          }
          return match.preventDefault ?? false
        }
        case "history-next": {
          if (!historySearch.active) {
            handleHistoryNavigation("next")
          }
          return match.preventDefault ?? false
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
      handleHistoryNavigation,
      historySearch,
      handleAbortRun,
      handleExitSession,
      onBackgroundRequest,
      onToggleBackgroundTasks,
      onCyclePermissionMode,
      persistHistory,
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
  })

  useEffect(() => {
    if (!isRunning) {
      sessionRef.current.clearRun()
    }
  }, [isRunning])

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
    }),
    [drainFollowUp, exitHistorySearch, exitPending, followUpQueue, handleInput, handleSubmit, historySearch, permissionMode, thinkingEnabled],
  )
}
