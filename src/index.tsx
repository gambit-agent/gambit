import pkg from '../package.json'
import { parseLaunchOptions } from './app/launch-options'
import { cleanupAllMCPClients } from './tools/mcp'

/**
 * Development entry point for the Gambit TUI.
 * This variant may enable hot-reload or dev-specific diagnostics. It is NOT
 * the compiled CLI target (see `src/gambit.tsx` for the production binary entry).
 */

const rawArgs = Bun.argv.slice(2)

if (rawArgs.includes('--version') || rawArgs.includes('-V')) {
  console.log(`gambit ${pkg.version}`)
  process.exit(0)
}

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  const { printHelp } = await import('./app/help')
  printHelp()
  process.exit(0)
}

const launchOptions = parseLaunchOptions(rawArgs)

if (launchOptions.headless) {
  const { runHeadless } = await import('./app/headless-runner')
  const exitCode = await runHeadless({
    headless: launchOptions.headless,
    sessionMode: launchOptions.mode,
    resumeConversationId: launchOptions.conversationId,
  })
  process.exit(exitCode)
}

const { createCliRenderer } = await import('@opentui/core')
const { createRoot } = await import('@opentui/react')
const { App } = await import('./App')

let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null
let shutdownRequested = false

const shutdown = async (signal: NodeJS.Signals) => {
  if (shutdownRequested) return
  shutdownRequested = true
  try {
    renderer?.destroy()
  } catch {
    // ignore renderer teardown errors
  }
  try {
    await Promise.race([
      cleanupAllMCPClients(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
  } catch (error) {
    console.error('Error during shutdown:', error)
  }
  process.exit(signal === 'SIGINT' ? 130 : 0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

try {
  renderer = await createCliRenderer()
  createRoot(renderer).render(<App />)
} catch (error) {
  console.error('Failed to start Gambit:', error)
  process.exitCode = 1
}
