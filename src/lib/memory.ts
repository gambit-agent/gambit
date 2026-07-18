import { generateId } from "./id"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import { workspaceRoot } from "../config"
import { appendJsonlEntry } from "./jsonl"

const MEMORIES_FILE_NAME = "memories.jsonl"

export interface MemoryEntry {
  id: string
  content: string
  timestamp: string
}

export async function appendMemoryEntry(content: string): Promise<MemoryEntry | null> {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  const memoriesDirectory = path.join(workspaceRoot, ".gambit", "memories")
  await mkdir(memoriesDirectory, { recursive: true })
  const entry: MemoryEntry = {
    id: generateId(),
    content: trimmed,
    timestamp: new Date().toISOString(),
  }

  const filePath = path.join(memoriesDirectory, MEMORIES_FILE_NAME)
  await appendJsonlEntry(filePath, entry)
  return entry
}
