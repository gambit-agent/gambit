import { useEffect, useRef } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import type { LaunchOptions } from '../../app/launch-options'

export function useReplSessionLaunch({
  launchOptions,
  runtime,
  refreshSessionPicker,
  setSessionInitializing,
}: {
  launchOptions: LaunchOptions
  runtime: AppRuntime
  refreshSessionPicker: (query?: string) => Promise<void>
  setSessionInitializing: (value: boolean) => void
}) {
  const launchHandledRef = useRef(false)

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
  }, [launchOptions, refreshSessionPicker, runtime, setSessionInitializing])
}
