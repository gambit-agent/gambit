#!/usr/bin/env node
// Node-compatible launcher for Gambit.
//
// Gambit is a Bun application (TSX entry point, Bun APIs), so this shim
// re-executes the real entry point with Bun when it is available and prints
// installation guidance otherwise. Note: the package root declares
// `"type": "module"`, so this file must be ESM under Node.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'gambit.tsx')

const result = spawnSync('bun', ['run', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
})

if (result.error && result.error.code === 'ENOENT') {
  console.error('gambit requires the Bun runtime, but `bun` was not found on your PATH.')
  console.error('')
  console.error('Install a prebuilt gambit binary (no Bun needed):')
  console.error('  curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash')
  console.error('')
  console.error('Or install Bun and re-run this command: https://bun.sh')
  process.exit(1)
}

if (result.error) {
  console.error(`gambit: failed to launch bun: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status === null ? 1 : result.status)
