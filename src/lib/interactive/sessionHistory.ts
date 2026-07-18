import { generateId } from "../id"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { Glob, JSONL } from "bun"

import { workspaceRoot } from "../../config"
import { appendJsonlEntry } from "../jsonl"

const HISTORY_FILE_PREFIX = "history-"
const HISTORY_FILE_SUFFIX = ".jsonl"
const MAX_HISTORY_ENTRIES = 1000
/** Only the newest N session files are read at startup to bound load cost. */
const MAX_HISTORY_FILES = 20

type SessionHistoryRole = "user" | "assistant"

interface SessionInfo {
  id: string
  filePath: string
}

interface ParsedHistoryEntry {
  content: string
  timestamp: number
}

export interface SessionHistoryEntry {
  id: string
  role: SessionHistoryRole
  content: string
  timestamp: string
}

let sessionPromise: Promise<SessionInfo> | null = null

function getSessionsDirectory(): string {
  return path.join(workspaceRoot, ".gambit", "sessions")
}

function getLegacyHistoryPath(): string {
  return path.join(workspaceRoot, ".gambit", "history.json")
}

async function ensureSessionsDirectory(): Promise<string> {
  const directory = getSessionsDirectory()
  await mkdir(directory, { recursive: true })
  return directory
}

async function createSession(): Promise<SessionInfo> {
  const directory = await ensureSessionsDirectory()
  const id = generateId()
  const filePath = path.join(directory, `${HISTORY_FILE_PREFIX}${id}${HISTORY_FILE_SUFFIX}`)
  return { id, filePath }
}

export function getCurrentSession(): Promise<SessionInfo> {
  if (!sessionPromise) {
    sessionPromise = createSession()
  }
  return sessionPromise
}

export function resetSessionHistoryForTesting(): void {
  sessionPromise = null
}

export async function appendSessionEntry(entry: SessionHistoryEntry): Promise<void> {
  if (!entry.content.trim()) {
    return
  }
  const session = await getCurrentSession()
  const payload = {
    sessionId: session.id,
    ...entry,
  }
  await appendJsonlEntry(session.filePath, payload)
}

export async function loadUserHistoryEntries(limit: number = MAX_HISTORY_ENTRIES): Promise<string[]> {
  const entries: ParsedHistoryEntry[] = []

  try {
    const directory = await ensureSessionsDirectory()
    const historyFiles: string[] = []
    const historyGlob = new Glob(`${HISTORY_FILE_PREFIX}*${HISTORY_FILE_SUFFIX}`)
    for await (const filePath of historyGlob.scan({
      cwd: directory,
      dot: true,
      absolute: true,
      onlyFiles: false,
      followSymlinks: false,
    })) {
      historyFiles.push(filePath)
    }
    const fileInfos = await Promise.all(
      historyFiles.map(async (filePath) => {
        try {
          const stats = await stat(filePath)
          if (!stats.isFile()) {
            return null
          }
          return { filePath, mtimeMs: stats.mtimeMs }
        } catch {
          return null
        }
      }),
    )
    const newestFiles = fileInfos
      .filter((info): info is { filePath: string; mtimeMs: number } => info !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_HISTORY_FILES)
      .map((info) => info.filePath)
    const parsedFiles = await Promise.all(
      newestFiles.map((filePath) => readUserEntriesFromFile(filePath)),
    )
    entries.push(...parsedFiles.flat())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  const legacy = await loadLegacyHistoryEntries()
  entries.push(...legacy)

  entries.sort((a, b) => a.timestamp - b.timestamp)

  return entries.slice(-limit).map((entry) => entry.content)
}

async function readUserEntriesFromFile(filePath: string): Promise<ParsedHistoryEntry[]> {
  const entries: ParsedHistoryEntry[] = []
  let content: string

  try {
    content = await Bun.file(filePath).text()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return entries
    }
    throw error
  }

  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsedValues = JSONL.parse(`${trimmed}\n`) as unknown[]
      for (const parsed of parsedValues) {
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          continue
        }
        const record = parsed as Partial<SessionHistoryEntry>
        if (record.role !== "user" || typeof record.content !== "string") {
          continue
        }
        const timestampMs = record.timestamp ? Date.parse(record.timestamp) : Number.NaN
        entries.push({ content: record.content, timestamp: Number.isNaN(timestampMs) ? 0 : timestampMs })
      }
    } catch {
      // ignore malformed lines
    }
  }

  return entries
}

async function loadLegacyHistoryEntries(): Promise<ParsedHistoryEntry[]> {
  const entries: ParsedHistoryEntry[] = []
  const legacyPath = getLegacyHistoryPath()

  try {
    const parsed = await Bun.file(legacyPath, { type: "application/json" }).json() as { entries?: unknown }
    if (!Array.isArray(parsed.entries)) {
      return entries
    }
    for (const entry of parsed.entries) {
      if (typeof entry !== "string") {
        continue
      }
      entries.push({ content: entry, timestamp: 0 })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return entries
    }
    if (error instanceof SyntaxError) {
      return entries
    }
    throw error
  }

  return entries
}
