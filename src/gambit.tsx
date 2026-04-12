#!/usr/bin/env bun

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { cleanupAllMCPClients } from './tools/mcp';

import { App } from './App';

let shutdownRequested = false;

const shutdown = async (signal: NodeJS.Signals) => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`\nShutting down gracefully (${signal})...`);
  try {
    await Promise.race([
      cleanupAllMCPClients(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
} catch (error) {
  console.error('Failed to start Gambit:', error);
  process.exitCode = 1;
}
