import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useKeyboard, useAppContext } from "@opentui/react"
import type { ParsedKey, PasteEvent } from "@opentui/core"

import type { UIMessage } from "../../types/chat"
import { InteractiveHistory } from "./history"
import { InteractiveSession, type PermissionMode } from "./session"
import { DoublePressDetector, matchShortcut } from "./shortcuts"

type SubmitOptions = {
  signal: AbortSignal
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
}

interface HistorySearchState {
  active: boolean
  query: string
  match: string | null
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

const DOUBLE_ESC_INTERVAL_MS = 400
const pasteDecoder = new TextDecoder()

const isPrintableKey = (key: ParsedKey): boolean => {
  if (key.ctrl || key.meta) {
    return false
  }
  return key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32
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
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historySearch, setHistorySearch] = useState<HistorySearchState>({ active: false, query: "", match: null })
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [localPermissionMode, setLocalPermissionMode] = useState<PermissionMode>("Normal")
  const [exitPending, setExitPending] = useState(false)
  const followUpQueueRef = useRef<string[]>([])
  const [followUpQueue, setFollowUpQueue] = useState<string[]>([])
  const lastEscTimestamp = useRef<number | null>(null)
  const ctrlCDetector = useRef(new DoublePressDetector())
  const ctrlDDetector = useRef(new DoublePressDetector())
  const stashedPromptRef = useRef<string | null>(null)
  const lastSearchIndex = useRef<number | null>(null)
  const { renderer } = useAppContext()
  const inputValueRef = useRef(inputValue)
  const inputPreviewRef = useRef(inputPreview)
  const lastPasteLabelRef = useRef<string | null>(null)
  const suppressNextInputRef = useRef(false)
  const permissionMode = externalPermissionMode ?? localPermissionMode

  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  useEffect(() => {
    inputPreviewRef.current = inputPreview
    lastPasteLabelRef.current = inputPreview
  }, [inputPreview])

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

  const setPreviewLabel = useCallback(
    (label: string) => {
      setInputPreview(label)
      lastPasteLabelRef.current = label
    },
    [setInputPreview],
  )

  const clearPreviewLabel = useCallback(() => {
    setInputPreview(null)
    lastPasteLabelRef.current = null
  }, [setInputPreview])

  useEffect(() => {
    const keyInput = renderer?.keyInput
    if (!keyInput) {
      return
    }

    const sanitizePastedText = (raw: string) =>
      raw.replace(/\u001b\[200~|\u001b\[201~/g, "").replace(/\r\n?/g, "\n")

    const handlePaste = (event: PasteEvent) => {
      const cleaned = sanitizePastedText(pasteDecoder.decode(event.bytes))
      if (!cleaned) {
        return
      }

      if (typeof event.preventDefault === "function") {
        event.preventDefault()
      }

      historyRef.current?.clearCursor()
      suppressNextInputRef.current = true
      setInputValueWithRef((prev) => `${prev}${cleaned}`)
      const characterCount = Array.from(cleaned).length
      const lineCount = cleaned.split("\n").length
      setPreviewLabel(`[Pasted Content ${characterCount} chars]`)
      console.info(`[paste] captured bracketed paste (${characterCount} chars, ${lineCount} lines)`)
    }

    keyInput.on("paste", handlePaste)
    return () => {
      keyInput.off("paste", handlePaste)
    }
  }, [renderer, setInputValueWithRef, setPreviewLabel])

  useEffect(() => {
    let cancelled = false
    InteractiveHistory.load().then((history) => {
      if (!cancelled) {
        historyRef.current = history
        setHistoryLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const persistHistory = useCallback(async () => {
    try {
      await historyRef.current?.persist()
    } catch (error) {
      console.warn("Failed to persist history", error)
    }
  }, [])

  const exitHistorySearch = useCallback(() => {
    setHistorySearch({ active: false, query: "", match: null })
    lastSearchIndex.current = null
  }, [])

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
        followUpQueueRef.current = [...followUpQueueRef.current, trimmed]
        setFollowUpQueue([...followUpQueueRef.current])
        clearPreviewLabel()
        setInputValueWithRef("")
        return
      }

      if (!historyLoaded || !historyRef.current) {
        const history = await InteractiveHistory.load()
        historyRef.current = history
        setHistoryLoaded(true)
      }

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
      historyLoaded,
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

      const maxStart = Math.min(previousValue.length, value.length)
      let start = 0
      while (start < maxStart && previousValue[start] === value[start]) {
        start++
      }

      let prevEnd = previousValue.length
      let nextEnd = value.length
      while (prevEnd > start && nextEnd > start && previousValue[prevEnd - 1] === value[nextEnd - 1]) {
        prevEnd--
        nextEnd--
      }

      const inserted = value.slice(start, nextEnd)
      const removedLength = prevEnd - start
      const insertedLength = inserted.length
      const hasMultiCharInsert = insertedLength > 1
      const hasMultiLineInsert = inserted.includes("\n") && (insertedLength > 1 || removedLength > 0)

      if (!hasMultiCharInsert && !hasMultiLineInsert) {
        return
      }

      const characterCount = Array.from(inserted).length
      if (characterCount === 0) {
        return
      }

      setPreviewLabel(`[Pasted Content ${characterCount} chars]`)
      const lineCount = inserted.split("\n").length
      console.info(`[paste] detected inferred paste (${characterCount} chars, ${lineCount} lines)`)
    },
    [clearPreviewLabel, historySearch.active, setInputValueWithRef, setPreviewLabel],
  )

  const handleHistoryNavigation = useCallback(
    (direction: "previous" | "next") => {
      const history = historyRef.current
      if (!history) {
        return
      }

      if (direction === "previous") {
        const nextValue = history.previous(inputValueRef.current)
        if (nextValue !== null) {
          clearPreviewLabel()
          suppressNextInputRef.current = true
          setInputValueWithRef(nextValue)
        }
        return
      }

      const nextValue = history.next()
      if (nextValue !== null) {
        clearPreviewLabel()
        suppressNextInputRef.current = true
        setInputValueWithRef(nextValue)
      }
    },
    [clearPreviewLabel, setInputValueWithRef],
  )

  const updateHistorySearch = useCallback(
    (query: string, advanced: boolean = false) => {
      const history = historyRef.current
      if (!history) {
        setHistorySearch({ active: true, query, match: null })
        return
      }

      const startIndex = advanced
        ? Math.max((lastSearchIndex.current ?? history.size) - 1, 0)
        : history.size - 1

      const match = history.findLatestMatch(query, startIndex)
      lastSearchIndex.current = match ? match.index : null
      setHistorySearch({ active: true, query, match: match?.value ?? null })

      if (match?.value) {
        clearPreviewLabel()
        suppressNextInputRef.current = true
        setInputValueWithRef(match.value)
      }
    },
    [clearPreviewLabel, setInputValueWithRef],
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

      const doExit = () => {
        sessionRef.current.abortRun()
        setTimeout(() => {
          try {
            renderer?.destroy()
          } catch {
            // ignore renderer teardown errors
          }
          process.exit(0)
        }, 10)
      }

      switch (match.action) {
        case "abort-run": {
          const press = ctrlCDetector.current.press()
          if (press === "first") {
            sessionRef.current.abortRun()
            onAbort?.()
            setExitPending(true)
            setTimeout(() => setExitPending(false), 800)
          } else {
            doExit()
          }
          return match.preventDefault ?? false
        }
        case "exit-session": {
          const press = ctrlDDetector.current.press()
          if (press === "first") {
            setExitPending(true)
            setTimeout(() => setExitPending(false), 800)
          } else {
            doExit()
          }
          return match.preventDefault ?? false
        }
        case "clear-screen": {
          console.clear()
          try {
            renderer?.console?.clear()
          } catch (error) {
            // ignore renderer errors
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
          // Let the textarea handle newline insertion natively
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
            followUpQueueRef.current = [...followUpQueueRef.current, currentValue]
            setFollowUpQueue([...followUpQueueRef.current])
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
      handleHistoryNavigation,
      historySearch,
      onAbort,
      onBackgroundRequest,
      onToggleBackgroundTasks,
      onCyclePermissionMode,
      persistHistory,
      renderer,
      setInputValueWithRef,
      updateHistorySearch,
    ],
  )

  useKeyboard(
    useCallback(
      (key: ParsedKey) => {
        if (key.name === "escape") {
          handleEscape()
          return
        }

        if (historySearch.active) {
          if (key.name === "backspace") {
            const nextQuery = historySearch.query.slice(0, -1)
            updateHistorySearch(nextQuery)
            return
          }

          if (key.name === "r" && key.ctrl) {
            updateHistorySearch(historySearch.query, true)
            return
          }

          if (key.name === "return" || key.name === "enter") {
            exitHistorySearch()
            return
          }

          if (key.name === "c" && key.ctrl) {
            exitHistorySearch()
            return
          }

          if (isPrintableKey(key)) {
            const nextQuery = historySearch.query + key.sequence
            updateHistorySearch(nextQuery)
            return
          }
        }

        if (handleShortcut(key)) {
          return
        }
      },
      [exitHistorySearch, handleEscape, handleShortcut, historySearch, updateHistorySearch],
    ),
  )

  const drainFollowUp = useCallback(() => {
    if (followUpQueueRef.current.length === 0) return undefined
    const next = followUpQueueRef.current[0]
    followUpQueueRef.current = followUpQueueRef.current.slice(1)
    setFollowUpQueue([...followUpQueueRef.current])
    return next
  }, [])

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
