import { createContext, useContext, useSyncExternalStore } from 'react'

import type { AppRuntime } from './bootstrap'

const AppRuntimeContext = createContext<AppRuntime | null>(null)

export interface AppRuntimeProviderProps {
  runtime: AppRuntime
  children: React.ReactNode
}

/** Provides the bootstrapped AppRuntime to the React tree via context. */
export function AppRuntimeProvider({ runtime, children }: AppRuntimeProviderProps) {
  return <AppRuntimeContext.Provider value={runtime}>{children}</AppRuntimeContext.Provider>
}

/** Hook that throws if called outside of an `AppRuntimeProvider`. */
export function useAppRuntime(): AppRuntime {
  const runtime = useContext(AppRuntimeContext)
  if (!runtime) {
    throw new Error('App runtime is not available.')
  }
  return runtime
}

/** Subscribe to the mutable conversation store via `useSyncExternalStore`. */
export function useConversationSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.conversationStore.subscribe.bind(runtime.conversationStore),
    runtime.conversationStore.getSnapshot.bind(runtime.conversationStore),
  )
}

/** Subscribe to the task runtime for background task updates. */
export function useTaskSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.taskRuntime.subscribe.bind(runtime.taskRuntime),
    runtime.taskRuntime.getSnapshot.bind(runtime.taskRuntime),
  )
}

/** Subscribe to the permission engine for dialog state. */
export function usePermissionSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.permissionEngine.subscribe.bind(runtime.permissionEngine),
    runtime.permissionEngine.getSnapshot.bind(runtime.permissionEngine),
  )
}

/** Subscribe to the question engine for active user questions. */
export function useQuestionSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.questionEngine.subscribe.bind(runtime.questionEngine),
    runtime.questionEngine.getSnapshot.bind(runtime.questionEngine),
  )
}
