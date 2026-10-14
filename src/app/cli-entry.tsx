import { parseLaunchOptions } from './launch-options'
import { installRuntimeWarningGuard } from './runtime-warnings'
import { appVersion } from './version'
import { cleanupAllMCPClients } from '../tools/mcp'

export interface RunCliOptions {
  destroyRendererOnShutdown?: boolean
  announceShutdown?: boolean
  getSignalExitCode?: (signal: NodeJS.Signals) => number
}

export async function runCli(options: RunCliOptions = {}): Promise<void> {
  const rawArgs = Bun.argv.slice(2)

  if (rawArgs[0] === 'install') {
    const { runInstall } = await import('./install')
    const exitCode = await runInstall(rawArgs.slice(1))
    process.exit(exitCode)
  }

  if (rawArgs[0] === 'update') {
    const { runUpdate } = await import('./update')
    const exitCode = await runUpdate(rawArgs.slice(1))
    process.exit(exitCode)
  }

  if (rawArgs[0] === 'acp') {
    if (rawArgs.slice(1).some((arg) => arg === '--help' || arg === '-h')) {
      const { printAcpHelp } = await import('./help')
      printAcpHelp()
      return
    }
    if (rawArgs.length > 1) {
      console.error(`Unknown ACP option: ${rawArgs[1]}`)
      process.exitCode = 1
      return
    }
    const { runAcpAgent } = await import('../acp/agent-server')
    await runAcpAgent()
    return
  }

  if (rawArgs.includes('--version') || rawArgs.includes('-V')) {
    console.log(`gambit ${appVersion}`)
    process.exit(0)
  }

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    const { printHelp } = await import('./help')
    printHelp()
    process.exit(0)
  }

  const launchOptions = parseLaunchOptions(rawArgs)

  if (launchOptions.headless) {
    const { runHeadless } = await import('./headless-runner')
    const exitCode = await runHeadless({
      headless: launchOptions.headless,
      sessionMode: launchOptions.mode,
      resumeConversationId: launchOptions.conversationId,
    })
    process.exit(exitCode)
  }

  // Installed before the dynamic imports below so warnings emitted while
  // bootstrapping the app (and any that fire before the renderer exists) are
  // captured instead of printed over the TUI. See runtime-warnings.ts.
  const disposeRuntimeWarnings = installRuntimeWarningGuard()
  process.once('exit', disposeRuntimeWarnings)

  const { createCliRenderer } = await import('@opentui/core')
  const { createRoot } = await import('@opentui/react')
  const { App } = await import('../App')

  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null
  let shutdownRequested = false

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownRequested) return
    shutdownRequested = true

    if (options.announceShutdown) {
      console.log(`\nShutting down gracefully (${signal})...`)
    }

    if (options.destroyRendererOnShutdown) {
      try {
        renderer?.destroy()
      } catch {
        // ignore renderer teardown errors
      }
    }

    try {
      await Promise.race([
        cleanupAllMCPClients(),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
    } catch (error) {
      console.error('Error during shutdown:', error)
    }

    disposeRuntimeWarnings()
    process.exit(options.getSignalExitCode?.(signal) ?? 0)
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
    disposeRuntimeWarnings()
    process.exitCode = 1
  }
}
