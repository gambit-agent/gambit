#!/usr/bin/env bun

// Must stay the first import: it selects React's production build before
// anything below loads React. See production-env.ts.
import './app/production-env'
import { runCli } from './app/cli-entry'

/**
 * Production CLI binary entry point.
 * This file is the target for `bun build --compile` and is executed when users
 * run the `gambit` command after installation.
 */

await runCli({ announceShutdown: true })
