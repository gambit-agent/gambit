import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setUserGambitDirectoryForTesting } from '../session/user-data-paths'
import {
  installRuntimeWarningGuard,
  resetRuntimeWarningsForTesting,
  subscribeRuntimeWarnings,
  type RuntimeWarning,
} from './runtime-warnings'

describe('runtime-warnings', () => {
  let tempRoot: string
  let originalEmitWarning: typeof process.emitWarning

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'gambit-warnings-'))
    setUserGambitDirectoryForTesting(tempRoot)
    originalEmitWarning = process.emitWarning
    resetRuntimeWarningsForTesting()
  })

  afterEach(() => {
    resetRuntimeWarningsForTesting()
    process.emitWarning = originalEmitWarning
    setUserGambitDirectoryForTesting(null)
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test('captures warnings instead of calling the original emitter', () => {
    let forwarded = 0
    process.emitWarning = (() => {
      forwarded += 1
    }) as typeof process.emitWarning

    const received: RuntimeWarning[] = []
    const dispose = installRuntimeWarningGuard()
    const unsubscribe = subscribeRuntimeWarnings((warning) => received.push(warning))

    process.emitWarning('something happened', { type: 'MaxListenersExceededWarning' })

    expect(forwarded).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0]!.name).toBe('MaxListenersExceededWarning')
    expect(received[0]!.message).toBe('something happened')

    unsubscribe()
    dispose()
  })

  test('replays buffered warnings to subscribers that attach later', () => {
    const dispose = installRuntimeWarningGuard()
    process.emitWarning('early warning', { type: 'DeprecationWarning' })

    const received: RuntimeWarning[] = []
    const unsubscribe = subscribeRuntimeWarnings((warning) => received.push(warning))

    expect(received.map((warning) => warning.message)).toEqual(['early warning'])

    unsubscribe()
    dispose()
  })

  test('derives the warning name from an Error name when no type is given', () => {
    const dispose = installRuntimeWarningGuard()
    const received: RuntimeWarning[] = []
    const unsubscribe = subscribeRuntimeWarnings((warning) => received.push(warning))

    const error = new Error('boom')
    error.name = 'CustomWarning'
    process.emitWarning(error)

    expect(received[0]!.name).toBe('CustomWarning')
    expect(received[0]!.message).toBe('boom')

    unsubscribe()
    dispose()
  })

  test('is ref-counted; the original is restored only after the last disposer', () => {
    let forwarded = 0
    const stub = (() => {
      forwarded += 1
    }) as typeof process.emitWarning
    process.emitWarning = stub

    const disposeFirst = installRuntimeWarningGuard()
    const disposeSecond = installRuntimeWarningGuard()

    disposeFirst()
    // Still guarded after one of two installs is disposed.
    process.emitWarning('while guarded', { type: 'Warning' })
    expect(forwarded).toBe(0)
    expect(process.emitWarning).not.toBe(stub)

    disposeSecond()
    // Disposing twice is a no-op and must not double-restore.
    disposeFirst()

    expect(process.emitWarning).toBe(stub)
    process.emitWarning('after restore', { type: 'Warning' })
    expect(forwarded).toBe(1)
  })

  test('appends captured warnings to the runtime warnings log', () => {
    const dispose = installRuntimeWarningGuard()
    process.emitWarning('leak detected', { type: 'MaxListenersExceededWarning' })

    const logPath = path.join(tempRoot, 'logs', 'runtime-warnings.log')
    const contents = readFileSync(logPath, 'utf8')

    expect(contents).toContain('MaxListenersExceededWarning: leak detected')
    dispose()
  })

  test('captures an emit-site stack for the log', () => {
    const dispose = installRuntimeWarningGuard()
    const received: RuntimeWarning[] = []
    const unsubscribe = subscribeRuntimeWarnings((warning) => received.push(warning))

    process.emitWarning('with stack', { type: 'Warning' })

    expect(received[0]!.stack).toContain('runtime-warnings.test')

    unsubscribe()
    dispose()
  })
})
