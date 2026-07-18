import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

import { InteractiveSession } from './session'
import { DoublePressDetector } from './shortcuts'

interface RendererExitHost {
  destroy?: () => void
}

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

  const handleAbortRun = useCallback(() => {
    const press = ctrlCDetector.current.press()
    if (press === 'first') {
      sessionRef.current.abortRun()
      onAbort?.()
      showExitPending()
      return
    }
    exitSession()
  }, [exitSession, onAbort, sessionRef, showExitPending])

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
