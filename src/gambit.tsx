#!/usr/bin/env bun

import { runCli } from './app/cli-entry'

/**
 * Production CLI binary entry point.
 * This file is the target for `bun build --compile` and is executed when users
 * run the `gambit` command after installation.
 */

await runCli({ announceShutdown: true })
