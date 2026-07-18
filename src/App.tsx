import { AppShell } from './app/AppShell'
import { bootstrapAppRuntime } from './app/bootstrap'
import { parseLaunchOptions } from './app/launch-options'

const launchOptions = parseLaunchOptions(Bun.argv.slice(2))
const runtime = await bootstrapAppRuntime({
  deferConversationInitialization: launchOptions.mode !== 'new',
})

export function App() {
  return <AppShell runtime={runtime} launchOptions={launchOptions} />
}
