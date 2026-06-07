import { generateId } from "../id"
import { mkdir, readFile, readdir } from "node:fs/promises"
import path from "node:path"

import { workspaceRoot } from "../../config"
import { appendJsonlEntry } from "../jsonl"

const HISTORY_FILE_PREFIX = "history-"
const HISTORY_FILE_SUFFIX = ".jsonl"
const MAX_HISTORY_ENTRIES = 1000

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
    const files = await readdir(directory)
    const parsedFiles = await Promise.all(
      files
        .filter((filename) => filename.startsWith(HISTORY_FILE_PREFIX) && filename.endsWith(HISTORY_FILE_SUFFIX))
        .map((filename) => readUserEntriesFromFile(path.join(directory, filename))),
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
    content = await readFile(filePath, "utf8")
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
      const parsed = JSON.parse(trimmed) as Partial<SessionHistoryEntry>
      if (parsed.role !== "user" || typeof parsed.content !== "string") {
        continue
      }
      const timestampMs = parsed.timestamp ? Date.parse(parsed.timestamp) : Number.NaN
      entries.push({ content: parsed.content, timestamp: Number.isNaN(timestampMs) ? 0 : timestampMs })
    } catch {
      // ignore malformed lines
    }
  }

  return entries
}

async function loadLegacyHistoryEntries(): Promise<ParsedHistoryEntry[]> {
  const entries: ParsedHistoryEntry[] = []
  const legacyPath = getLegacyHistoryPath()

  let raw: string
  try {
    raw = await readFile(legacyPath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return entries
    }
    throw error
  }

  try {
    const parsed = JSON.parse(raw) as { entries?: unknown }
    if (!Array.isArray(parsed.entries)) {
      return entries
    }
    for (const entry of parsed.entries) {
      if (typeof entry !== "string") {
        continue
      }
      entries.push({ content: entry, timestamp: 0 })
    }
  } catch {
    // ignore malformed legacy file
  }

  return entries
}
