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
import { readClipboardImage, readClipboardText } from "../clipboard-image"
import type { ImageAttachment } from "../image-attachments"
import type { UIMessage } from "../../types/chat"
import {
  resolveDownArrowAction,
  resolveUpArrowAction,
  type ComposerCursor,
} from "./composer-navigation"
import { useFollowUpQueue } from "./follow-up-queue"
import { isSteerable } from "../../conversation/steering"
import type { InteractiveHistory } from "./history"
import { usePasteDetection } from "./paste-detection"
import { InteractiveSession, type PermissionMode } from "./session"
import { matchShortcut } from "./shortcuts"
import { useExitShortcuts } from "./useExitShortcuts"
import { useInteractiveHistorySearch, type HistorySearchState } from "./useInteractiveHistorySearch"
import { useInteractiveKeyboard } from "./useInteractiveKeyboard"

type SubmitOptions = { signal: AbortSignal; attachments: ImageAttachment[] }

export interface QueuedPrompt {
  value: string
  attachments: ImageAttachment[]
}

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
  attachments?: ImageAttachment[]
  /**
   * Set when the value comes from the follow-up queue rather than the
   * composer. Queued values are already materialized (collapsed pasted text
   * was expanded before queueing), so they must not be expanded again, and
   * the composer — which now holds an unrelated draft — is left untouched.
   */
  materialized?: boolean
}

export interface UseInteractiveControllerOptions {
  inputValue: string
  setInputValue: Dispatch<SetStateAction<string>>
  attachments?: ImageAttachment[]
  setAttachments?: Dispatch<SetStateAction<ImageAttachment[]>>
  onImagePaste?: (image: { bytes?: Uint8Array; mediaType?: string; path?: string }) => void
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
  followUpQueue: QueuedPrompt[]
  handleSubmit: (value: string, options?: HandleSubmitOptions) => Promise<SubmitOutcome>
  handleInput: (value: string) => string
  exitHistorySearch: () => void
  drainFollowUp: () => QueuedPrompt | undefined
  submitFollowUp: (prompt: QueuedPrompt, options?: HandleSubmitOptions) => Promise<SubmitOutcome>
  /**
   * Hands the queued prompts that can be steered to a turn that is already
   * running. Registered as the runtime steering source, and called from the
   * model loop at each step boundary — never during render.
   */
  drainSteerable: () => string[]
  /** Synchronous run indicator (flips in `startRun`, before store snapshots update). */
  isRunActive: () => boolean
}

export function useInteractiveController({
  inputValue,
  setInputValue,
  attachments = [],
  setAttachments,
  onImagePaste,
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
    drainFollowUpsWhile,
    popFollowUp,
    requeueFrontFollowUp,
    getFollowUpQueueSize,
  } = useFollowUpQueue<QueuedPrompt>()
  const lastEscTimestamp = useRef<number | null>(null)
  const stashedPromptRef = useRef<QueuedPrompt | null>(null)
  // Provenance of composer content that was popped off the follow-up queue,
  // so down-arrow can re-enqueue it instead of navigating history.
  const poppedFollowUpRef = useRef<QueuedPrompt | null>(null)
  const { renderer } = useAppContext()
  const inputValueRef = useRef(inputValue)
  const attachmentsRef = useRef(attachments)
  const suppressNextInputRef = useRef(false)
  const permissionMode = externalPermissionMode ?? localPermissionMode
  const { exitPending, handleAbortRun, handleExitSession } = useExitShortcuts({ renderer, sessionRef, onAbort })

  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  const setAttachmentsWithRef = useCallback((next: ImageAttachment[]) => {
    attachmentsRef.current = next
    setAttachments?.(next)
  }, [setAttachments])

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
    compactInferredPaste,
    materializePastedText,
    collapsePastedText,
    syncPastedText,
    resetPastedText,
  } = usePasteDetection({
    renderer,
    setInputValueWithRef,
    historyRef,
    suppressNextInputRef,
    onImagePaste,
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
    transformRecalledValue: useCallback((value: string) => {
      resetPastedText()
      return collapsePastedText(value)
    }, [collapsePastedText, resetPastedText]),
    getCurrentInputValue: useCallback(
      () => materializePastedText(inputValueRef.current),
      [materializePastedText],
    ),
  })

  const handleSubmit = useCallback(
    async (displayValue: string, options?: HandleSubmitOptions): Promise<SubmitOutcome> => {
      const session = sessionRef.current
      const actualValue = options?.materialized ? displayValue : materializePastedText(displayValue)
      const submittedAttachments = options?.attachments ?? attachmentsRef.current
      // A queued follow-up is submitted from the queue, not the composer, so
      // the draft the user has since typed there must survive the submission.
      const clearComposerDraft = ({ attachments = true } = {}) => {
        if (options?.materialized) {
          return
        }
        setInputValueWithRef("")
        resetPastedText()
        if (attachments) {
          setAttachmentsWithRef([])
        }
      }

      // Tested against the display value: only a trailing '\' the user can
      // actually see opens a continuation, never one buried in a collapsed paste.
      if (displayValue.endsWith("\\")) {
        suppressNextInputRef.current = true
        if (options?.materialized) {
          // A drained follow-up goes back into the composer for the user to
          // finish, so its expanded text has to be re-collapsed from scratch.
          resetPastedText()
          setInputValueWithRef(collapsePastedText(`${actualValue.slice(0, -1)}\n`))
        } else {
          setInputValueWithRef(`${displayValue.slice(0, -1)}\n`)
        }
        return "continuation"
      }

      const trimmed = actualValue.trim()
      if (!trimmed && submittedAttachments.length === 0) {
        clearComposerDraft({ attachments: false })
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
          requeueFrontFollowUp({ value: trimmed, attachments: submittedAttachments })
        } else {
          enqueueFollowUp({ value: trimmed, attachments: submittedAttachments })
        }
        clearComposerDraft()
        onSubmitted?.()
        return "queued"
      }

      session.pushSnapshot(messages)
      const signal = session.startRun()

      clearComposerDraft()
      onSubmitted?.()

      void (async () => {
        try {
          const history = await ensureHistoryLoaded()
          history.clearCursor()
          if (trimmed) {
            history.add(trimmed)
          }
          await persistHistory()
        } catch (error) {
          console.warn("Failed to record submitted prompt history", error)
        }
      })()

      try {
        await performSubmit(actualValue, { signal, attachments: submittedAttachments })
      } finally {
        session.clearRun()
      }
      return "submitted"
    },
    [
      collapsePastedText,
      ensureHistoryLoaded,
      enqueueFollowUp,
      isRunning,
      materializePastedText,
      messages,
      onSubmitted,
      performSubmit,
      persistHistory,
      requeueFrontFollowUp,
      resetPastedText,
      setAttachmentsWithRef,
      setInputValueWithRef,
    ],
  )

  const handleInput = useCallback(
    (value: string): string => {
      if (historySearch.active) {
        return inputValueRef.current
      }

      const previousValue = inputValueRef.current
      historyRef.current?.clearCursor()

      if (suppressNextInputRef.current) {
        suppressNextInputRef.current = false
        setInputValueWithRef(value)
        syncPastedText(value)
        return value
      }

      const displayValue = compactInferredPaste(previousValue, value)
      setInputValueWithRef(displayValue)
      syncPastedText(displayValue)
      return displayValue
    },
    [compactInferredPaste, historySearch.active, setInputValueWithRef, syncPastedText],
  )

  const handleEscape = useCallback(() => {
    if (historySearch.active) {
      exitHistorySearch()
      return
    }

    const now = Date.now()
    if (lastEscTimestamp.current && now - lastEscTimestamp.current <= DOUBLE_ESC_INTERVAL_MS) {
      lastEscTimestamp.current = null
      // With a draft in the composer, double-Esc clears it — recorded in
      // history first so up-arrow brings it straight back.
      const draft = materializePastedText(inputValueRef.current).trim()
      if (draft || attachmentsRef.current.length > 0) {
        poppedFollowUpRef.current = null
        if (draft) {
          void (async () => {
            try {
              // Go through ensureHistoryLoaded: on an early double-Esc the
              // history file may still be loading, and a bare ref write would
              // drop the draft the user was promised they could recall.
              const history = await ensureHistoryLoaded()
              history.clearCursor()
              history.add(draft)
              await persistHistory()
            } catch (error) {
              console.warn("Failed to record cleared draft in history", error)
            }
          })()
        }
        suppressNextInputRef.current = true
        setInputValueWithRef("")
        resetPastedText()
        setAttachmentsWithRef([])
        return
      }
      const snapshot = sessionRef.current.popSnapshot()
      if (snapshot) {
        sessionRef.current.abortRun()
        setMessages(snapshot)
        onRewind?.()
      }
      return
    }

    lastEscTimestamp.current = now
    // A single Esc interrupts the turn in flight. Anything already queued is
    // sent next by the follow-up drain, which re-arms when the run ends.
    if (sessionRef.current.isRunActive) {
      sessionRef.current.abortRun()
      onAbort?.()
    }
  }, [
    ensureHistoryLoaded,
    exitHistorySearch,
    historySearch.active,
    materializePastedText,
    onAbort,
    onRewind,
    persistHistory,
    resetPastedText,
    setAttachmentsWithRef,
    setInputValueWithRef,
    setMessages,
  ])

  const handleShortcut = useCallback(
    (key: ParsedKey) => {
      const match = matchShortcut(key)
      if (!match) {
        return false
      }

      switch (match.action) {
        case "abort-run": {
          const outcome = handleAbortRun({
            isRunning: isRunning || sessionRef.current.isRunActive,
            hasDraft: inputValueRef.current.length > 0 || attachmentsRef.current.length > 0,
          })
          if (outcome === "cleared") {
            poppedFollowUpRef.current = null
            suppressNextInputRef.current = true
            setInputValueWithRef("")
            resetPastedText()
            setAttachmentsWithRef([])
          }
          return match.preventDefault ?? false
        }
        case "exit-session": {
          // With a draft in the composer, Ctrl+D is readline's delete-forward;
          // let the textarea handle it rather than arming the exit hint.
          if (inputValueRef.current.length > 0) {
            return false
          }
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
              resetPastedText()
              const displayValue = collapsePastedText(queued.value)
              if (displayValue !== inputValueRef.current) {
                suppressNextInputRef.current = true
                setInputValueWithRef(displayValue)
              }
              setAttachmentsWithRef(queued.attachments)
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
              enqueueFollowUp({
                value: materializePastedText(inputValueRef.current).trim() || popped.value,
                attachments: attachmentsRef.current,
              })
              if (inputValueRef.current !== "") {
                suppressNextInputRef.current = true
                setInputValueWithRef("")
              }
              resetPastedText()
              setAttachmentsWithRef([])
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
            poppedFollowUp: poppedFollowUpRef.current?.value ?? null,
            cursor: getComposerCursor?.() ?? null,
          })
          if (action === "re-enqueue-popped") {
            // Symmetric to the up-arrow pop: down-arrow restores the popped
            // follow-up (or its edited form) to the queue.
            const popped = poppedFollowUpRef.current
            poppedFollowUpRef.current = null
            const restored = materializePastedText(inputValueRef.current).trim() || (popped?.value ?? "")
            if (restored || attachmentsRef.current.length > 0) {
              enqueueFollowUp({ value: restored, attachments: attachmentsRef.current })
            }
            if (inputValueRef.current !== "") {
              suppressNextInputRef.current = true
              setInputValueWithRef("")
            }
            resetPastedText()
            setAttachmentsWithRef([])
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
        case "paste-image": {
          void (async () => {
            const image = await readClipboardImage()
            if (image && onImagePaste) {
              onImagePaste({ bytes: image.bytes, mediaType: image.mediaType })
              return
            }
            // Most terminals turn Ctrl+V into a bracketed paste of their own
            // and this never fires. Where it does reach us, a text clipboard
            // still has to paste rather than do nothing.
            const text = await readClipboardText()
            if (text) {
              historyRef.current?.clearCursor()
              suppressNextInputRef.current = true
              const displayText = collapsePastedText(text)
              setInputValueWithRef((previous) => `${previous}${displayText}`)
            }
          })()
          return match.preventDefault ?? false
        }
        case "newline": {
          return false
        }
        case "background": {
          const currentValue = materializePastedText(inputValueRef.current)
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
            resetPastedText()
          }
          return match.preventDefault ?? false
        }
        case "follow-up": {
          const currentValue = materializePastedText(inputValueRef.current).trim()
          if (currentValue || attachmentsRef.current.length > 0) {
            poppedFollowUpRef.current = null
            enqueueFollowUp({ value: currentValue, attachments: attachmentsRef.current })
            historyRef.current?.clearCursor()
            if (currentValue) {
              historyRef.current?.add(currentValue)
            }
            void persistHistory()
            suppressNextInputRef.current = true
            setInputValueWithRef("")
            resetPastedText()
            setAttachmentsWithRef([])
          }
          return match.preventDefault ?? false
        }
        case "stash-prompt": {
          const currentValue = materializePastedText(inputValueRef.current).trim()
          if (currentValue || attachmentsRef.current.length > 0) {
            poppedFollowUpRef.current = null
            stashedPromptRef.current = { value: currentValue, attachments: attachmentsRef.current }
            suppressNextInputRef.current = true
            setInputValueWithRef("")
            resetPastedText()
            setAttachmentsWithRef([])
          } else if (stashedPromptRef.current) {
            resetPastedText()
            suppressNextInputRef.current = true
            setInputValueWithRef(collapsePastedText(stashedPromptRef.current.value))
            setAttachmentsWithRef(stashedPromptRef.current.attachments)
            stashedPromptRef.current = null
          }
          return match.preventDefault ?? false
        }
        default:
          return false
      }
    },
    [
      collapsePastedText,
      enqueueFollowUp,
      getComposerCursor,
      getFollowUpQueueSize,
      handleHistoryNavigation,
      historySearch,
      handleAbortRun,
      handleExitSession,
      historyNavigationEnabled,
      isRunning,
      materializePastedText,
      onBackgroundRequest,
      onImagePaste,
      onToggleBackgroundTasks,
      onCyclePermissionMode,
      persistHistory,
      popFollowUp,
      resetPastedText,
      setInputValueWithRef,
      setAttachmentsWithRef,
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
  const submitFollowUp = useCallback(
    (prompt: QueuedPrompt, options?: HandleSubmitOptions) => handleSubmit(prompt.value, {
      ...options,
      attachments: prompt.attachments,
      materialized: true,
    }),
    [handleSubmit],
  )
  const drainSteerable = useCallback(
    () => drainFollowUpsWhile(isSteerable).map((prompt) => prompt.value),
    [drainFollowUpsWhile],
  )

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
      submitFollowUp,
      drainSteerable,
      isRunActive,
    }),
    [drainFollowUp, drainSteerable, exitHistorySearch, exitPending, followUpQueue, handleInput, handleSubmit, historySearch, isRunActive, permissionMode, submitFollowUp, thinkingEnabled],
  )
}
