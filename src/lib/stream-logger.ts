import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { getStreamLogPath } from '../session/session-paths'

const IDLE_WARN_INTERVAL_MS = 30_000
const LOG_FLUSH_INTERVAL_MS = 50
const MAX_BUFFERED_LOG_LINES = 100

type Fields = Record<string, unknown>

function serializeEntry(turnId: string, event: string, fields: Fields): string {
  return `${JSON.stringify({
    ts: new Date().toISOString(),
    turnId,
    event,
    ...fields,
  })}\n`
}

export interface StreamLogger {
  event(type: string, fields?: Fields): void
  finish(fields?: Fields): void
  error(err: unknown, fields?: Fields): void
  aborted(fields?: Fields): void
}

export function createStreamLogger(turnId: string, context: Fields = {}): StreamLogger {
  const startedAt = Date.now()
  const filePath = getStreamLogPath()
  let directoryReady: Promise<void> | null = null
  let writeChain = Promise.resolve()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let bufferedLines: string[] = []
  let lastEventAt = startedAt
  let partCount = 0
  let warningCount = 0

  const ensureDirectory = (): Promise<void> => {
    directoryReady ??= mkdir(path.dirname(filePath), { recursive: true }).then(
      () => undefined,
      () => undefined,
    )
    return directoryReady
  }

  const flush = (): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (bufferedLines.length === 0) {
      return writeChain
    }

    const content = bufferedLines.join('')
    bufferedLines = []
    writeChain = writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await ensureDirectory()
          await appendFile(filePath, content, 'utf8')
        } catch {
          // best-effort — never throw from the logger
        }
      })
    return writeChain
  }

  const scheduleFlush = (): void => {
    if (flushTimer) {
      return
    }
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, LOG_FLUSH_INTERVAL_MS)
    if (typeof flushTimer.unref === 'function') {
      flushTimer.unref()
    }
  }

  const writeEntry = (event: string, fields: Fields, options: { flush?: boolean } = {}): void => {
    bufferedLines.push(serializeEntry(turnId, event, fields))
    if (options.flush || bufferedLines.length >= MAX_BUFFERED_LOG_LINES) {
      void flush()
      return
    }
    scheduleFlush()
  }

  writeEntry('start', context)

  const idleInterval = setInterval(() => {
    const idleMs = Date.now() - lastEventAt
    if (idleMs >= IDLE_WARN_INTERVAL_MS) {
      warningCount += 1
      writeEntry('idle', {
        idleMs,
        lastEventAt: new Date(lastEventAt).toISOString(),
        partCount,
        warningCount,
      })
      console.warn(
        `[gambit] stream idle ${Math.round(idleMs / 1000)}s (turn ${turnId.slice(0, 8)}, ${partCount} parts)`,
      )
    }
  }, IDLE_WARN_INTERVAL_MS)
  if (typeof idleInterval.unref === 'function') {
    idleInterval.unref()
  }

  const stop = () => {
    clearInterval(idleInterval)
  }

  return {
    event(type: string, fields: Fields = {}): void {
      const now = Date.now()
      partCount += 1
      writeEntry('part', {
        type,
        partIndex: partCount,
        deltaMs: now - lastEventAt,
        elapsedMs: now - startedAt,
        ...fields,
      })
      lastEventAt = now
    },
    finish(fields: Fields = {}): void {
      stop()
      writeEntry('finish', {
        elapsedMs: Date.now() - startedAt,
        partCount,
        ...fields,
      }, { flush: true })
    },
    error(err: unknown, fields: Fields = {}): void {
      stop()
      writeEntry('error', {
        elapsedMs: Date.now() - startedAt,
        partCount,
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        ...fields,
      }, { flush: true })
    },
    aborted(fields: Fields = {}): void {
      stop()
      writeEntry('aborted', {
        elapsedMs: Date.now() - startedAt,
        partCount,
        ...fields,
      }, { flush: true })
    },
  }
}
