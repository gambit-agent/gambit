import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { getUserGambitDirectory } from '../session/user-data-paths'

export interface RuntimeWarning {
  /** Warning type, e.g. `MaxListenersExceededWarning` or `DeprecationWarning`. */
  name: string
  message: string
  /** Stack captured at the emit site; points at the offending `.on()` for leaks. */
  stack?: string
}

type WarningInput = string | Error
type WarningOptions = string | { type?: string; code?: string }

type EmitWarning = (warning: WarningInput, options?: WarningOptions) => void

const MAX_BUFFERED_WARNINGS = 50
const LOG_DIR_NAME = 'logs'
const LOG_FILE_NAME = 'runtime-warnings.log'

interface GuardState {
  original: EmitWarning | null
  installCount: number
  buffer: RuntimeWarning[]
  subscribers: Set<(warning: RuntimeWarning) => void>
}

const state: GuardState = {
  original: null,
  installCount: 0,
  buffer: [],
  subscribers: new Set(),
}

function normalizeName(input: WarningInput, options?: WarningOptions): string {
  const type = typeof options === 'string' ? undefined : options?.type
  if (type) {
    return type
  }
  if (input instanceof Error && input.name) {
    return input.name
  }
  return 'Warning'
}

function normalizeMessage(input: WarningInput): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof Error) {
    return input.message
  }
  // Bun tolerates non-string, non-Error warning values.
  return String(input)
}

function captureStack(input: WarningInput): string | undefined {
  if (input instanceof Error && typeof input.stack === 'string') {
    return input.stack
  }
  const stack = new Error().stack
  if (!stack) {
    return undefined
  }
  // Drop the `Error` header and this module's own frames so the top entry
  // points at the code that emitted the warning. Matching on the exact module
  // suffix keeps a caller named `runtime-warnings.test.ts` in the trace.
  const lines = stack.split('\n')
  const trimmed = lines.filter((line, index) => {
    if (index === 0) {
      return false
    }
    return !line.includes('runtime-warnings.ts')
  })
  return trimmed.join('\n')
}

function writeLogFile(warning: RuntimeWarning): void {
  try {
    const directory = path.join(getUserGambitDirectory(), LOG_DIR_NAME)
    mkdirSync(directory, { recursive: true })
    const entry = `${new Date().toISOString()} ${warning.name}: ${warning.message}${warning.stack ? `\n${warning.stack}` : ''}\n`
    appendFileSync(path.join(directory, LOG_FILE_NAME), entry, 'utf8')
  } catch {
    // Logging is best-effort; never let it break the app.
  }
}

function record(warning: RuntimeWarning): void {
  state.buffer.push(warning)
  if (state.buffer.length > MAX_BUFFERED_WARNINGS) {
    state.buffer.splice(0, state.buffer.length - MAX_BUFFERED_WARNINGS)
  }
  writeLogFile(warning)
  for (const subscriber of state.subscribers) {
    try {
      subscriber(warning)
    } catch {
      // A misbehaving subscriber must not break warning handling.
    }
  }
}

/**
 * Replaces `process.emitWarning` so runtime warnings stop being written to the
 * live terminal. Under Bun, `process.on('warning')` listeners are ignored and
 * warnings are printed straight to stderr, which corrupts the TUI's
 * alternate-screen frame. Redirecting `emitWarning` is the only mechanism that
 * works identically for the dev entries and the compiled binary.
 *
 * Ref-counted: repeated installs (e.g. dev hot-reload) share a single override
 * and only the final disposer restores the original.
 */
export function installRuntimeWarningGuard(): () => void {
  if (state.installCount === 0) {
    const original = process.emitWarning as EmitWarning
    state.original = original
    const guarded: EmitWarning = (warning, options) => {
      const runtimeWarning: RuntimeWarning = {
        name: normalizeName(warning, options),
        message: normalizeMessage(warning),
        stack: captureStack(warning),
      }
      record(runtimeWarning)
    }
    process.emitWarning = guarded as typeof process.emitWarning
  }

  state.installCount += 1
  let disposed = false
  return () => {
    if (disposed) {
      return
    }
    disposed = true
    state.installCount = Math.max(0, state.installCount - 1)
    if (state.installCount === 0 && state.original) {
      process.emitWarning = state.original as typeof process.emitWarning
      state.original = null
    }
  }
}

/**
 * Subscribe to runtime warnings produced while the guard is installed. Any
 * warnings already buffered are replayed immediately so a notice mounted after
 * startup still sees them.
 */
export function subscribeRuntimeWarnings(subscriber: (warning: RuntimeWarning) => void): () => void {
  state.subscribers.add(subscriber)
  for (const warning of [...state.buffer]) {
    subscriber(warning)
  }
  return () => {
    state.subscribers.delete(subscriber)
  }
}

/** Restore the original `process.emitWarning` and clear buffered state (tests). */
export function resetRuntimeWarningsForTesting(): void {
  if (state.original) {
    process.emitWarning = state.original as typeof process.emitWarning
  }
  state.original = null
  state.installCount = 0
  state.buffer = []
  state.subscribers.clear()
}
