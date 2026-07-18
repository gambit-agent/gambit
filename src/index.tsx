import { runCli } from './app/cli-entry'

/**
 * Development entry point for the Gambit TUI.
 * This variant may enable hot-reload or dev-specific diagnostics. It is NOT
 * the compiled CLI target (see `src/gambit.tsx` for the production binary entry).
 */

await runCli({
  destroyRendererOnShutdown: true,
  getSignalExitCode: (signal) => (signal === 'SIGINT' ? 130 : 0),
})
