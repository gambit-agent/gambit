import type { AppRuntime } from './bootstrap'
import { AppRuntimeProvider } from './providers'
import { ReplScreen } from '../repl/ReplScreen'

export interface AppShellProps {
  runtime: AppRuntime
}

export function AppShell({ runtime }: AppShellProps) {
  return (
    <AppRuntimeProvider runtime={runtime}>
      <ReplScreen />
    </AppRuntimeProvider>
  )
}
