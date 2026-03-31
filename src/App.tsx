import { AppShell } from './app/AppShell'
import { bootstrapAppRuntime } from './app/bootstrap'

const runtime = await bootstrapAppRuntime()

export function App() {
  return <AppShell runtime={runtime} />
}
