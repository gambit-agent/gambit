import { createContext, useContext, useSyncExternalStore } from 'react'

import type { AppRuntime } from './bootstrap'

const AppRuntimeContext = createContext<AppRuntime | null>(null)

export interface AppRuntimeProviderProps {
  runtime: AppRuntime
  children: React.ReactNode
}

export function AppRuntimeProvider({ runtime, children }: AppRuntimeProviderProps) {
  return <AppRuntimeContext.Provider value={runtime}>{children}</AppRuntimeContext.Provider>
}

export function useAppRuntime(): AppRuntime {
  const runtime = useContext(AppRuntimeContext)
  if (!runtime) {
    throw new Error('App runtime is not available.')
  }
  return runtime
}

export function useConversationSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.conversationStore.subscribe.bind(runtime.conversationStore),
    runtime.conversationStore.getSnapshot.bind(runtime.conversationStore),
  )
}

export function useTaskSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.taskRuntime.subscribe.bind(runtime.taskRuntime),
    runtime.taskRuntime.getSnapshot.bind(runtime.taskRuntime),
  )
}

export function usePermissionSnapshot() {
  const runtime = useAppRuntime()
  return useSyncExternalStore(
    runtime.permissionEngine.subscribe.bind(runtime.permissionEngine),
    runtime.permissionEngine.getSnapshot.bind(runtime.permissionEngine),
  )
}
