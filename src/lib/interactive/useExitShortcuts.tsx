import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

import { InteractiveSession } from './session'
import { DoublePressDetector } from './shortcuts'

interface RendererExitHost {
  destroy?: () => void
}

export interface AbortContext {
  /** A model turn is in flight, so Ctrl+C interrupts it. */
  isRunning?: boolean
  /** The composer holds text or attachments that Ctrl+C should clear. */
  hasDraft?: boolean
}

/**
 * What Ctrl+C did. 'cleared' asks the caller to empty the composer; the
 * others are already handled here.
 */
export type AbortOutcome = 'aborted' | 'cleared' | 'exit-armed' | 'exiting'

export function useExitShortcuts({
  renderer,
  sessionRef,
  onAbort,
}: {
  renderer: RendererExitHost | null | undefined
  sessionRef: MutableRefObject<InteractiveSession>
  onAbort?: () => void
}) {
  const [exitPending, setExitPending] = useState(false)
  const ctrlCDetector = useRef(new DoublePressDetector())
  const ctrlDDetector = useRef(new DoublePressDetector())
  const exitPendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (exitPendingTimeoutRef.current !== null) {
        clearTimeout(exitPendingTimeoutRef.current)
        exitPendingTimeoutRef.current = null
      }
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current)
        exitTimeoutRef.current = null
      }
    }
  }, [])

  const showExitPending = useCallback(() => {
    setExitPending(true)
    if (exitPendingTimeoutRef.current !== null) {
      clearTimeout(exitPendingTimeoutRef.current)
    }
    exitPendingTimeoutRef.current = setTimeout(() => {
      exitPendingTimeoutRef.current = null
      setExitPending(false)
    }, 800)
  }, [])

  const exitSession = useCallback(() => {
    sessionRef.current.abortRun()
    if (exitTimeoutRef.current !== null) {
      clearTimeout(exitTimeoutRef.current)
    }
    exitTimeoutRef.current = setTimeout(() => {
      exitTimeoutRef.current = null
      try {
        renderer?.destroy?.()
      } catch {
      }
      process.exitCode = 0
    }, 10)
  }, [renderer, sessionRef])

  /**
   * Ctrl+C. Interrupts a run; with nothing running it clears the composer
   * first, and only arms the exit hint once there is nothing left to undo, so
   * an interrupt or a cleared draft never counts toward a double-press exit.
   */
  const handleAbortRun = useCallback(
    ({ isRunning, hasDraft }: AbortContext = {}): AbortOutcome => {
      if (isRunning) {
        ctrlCDetector.current.reset()
        sessionRef.current.abortRun()
        onAbort?.()
        return 'aborted'
      }

      if (hasDraft) {
        ctrlCDetector.current.reset()
        return 'cleared'
      }

      const press = ctrlCDetector.current.press()
      if (press === 'first') {
        showExitPending()
        return 'exit-armed'
      }
      exitSession()
      return 'exiting'
    },
    [exitSession, onAbort, sessionRef, showExitPending],
  )

  const handleExitSession = useCallback(() => {
    const press = ctrlDDetector.current.press()
    if (press === 'first') {
      showExitPending()
      return
    }
    exitSession()
  }, [exitSession, showExitPending])

  return {
    exitPending,
    handleAbortRun,
    handleExitSession,
  }
}
