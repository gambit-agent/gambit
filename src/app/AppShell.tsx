import type { AppRuntime } from './bootstrap'
import type { LaunchOptions } from './launch-options'
import { AppRuntimeProvider } from './providers'
import { ReplScreen } from '../repl/ReplScreen'

export interface AppShellProps {
  runtime: AppRuntime
  launchOptions: LaunchOptions
}

export function AppShell({ runtime, launchOptions }: AppShellProps) {
  return (
    <AppRuntimeProvider runtime={runtime}>
      <ReplScreen launchOptions={launchOptions} />
    </AppRuntimeProvider>
  )
}
