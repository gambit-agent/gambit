import { useCallback, useRef, useState, type MutableRefObject } from 'react'

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

  const showExitPending = useCallback(() => {
    setExitPending(true)
    setTimeout(() => setExitPending(false), 800)
  }, [])

  const exitSession = useCallback(() => {
    sessionRef.current.abortRun()
    setTimeout(() => {
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
