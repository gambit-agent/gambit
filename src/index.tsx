import { parseLaunchOptions } from './app/launch-options';

const launchOptions = parseLaunchOptions(Bun.argv.slice(2));

if (launchOptions.headless) {
  const { runHeadless } = await import('./app/headless-runner');
  const exitCode = await runHeadless({
    headless: launchOptions.headless,
    sessionMode: launchOptions.mode,
    resumeConversationId: launchOptions.conversationId,
  });
  process.exit(exitCode);
}

const { createCliRenderer } = await import('@opentui/core');
const { createRoot } = await import('@opentui/react');
const { App } = await import('./App');

try {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
} catch (error) {
  console.error('Failed to start Gambit:', error);
  process.exitCode = 1;
}
