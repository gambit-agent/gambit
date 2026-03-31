import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

import { App } from './App';

try {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
} catch (error) {
  console.error('Failed to start Gambit:', error);
  process.exitCode = 1;
}
