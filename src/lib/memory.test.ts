import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { workspaceRoot, setWorkspaceRootForTesting } from "../config"
import { appendMemoryEntry } from "./memory"

describe("appendMemoryEntry", () => {
  let originalWorkspaceRoot: string
  let tempWorkspace: string

  beforeEach(async () => {
    originalWorkspaceRoot = workspaceRoot
    tempWorkspace = await mkdtemp(path.join(tmpdir(), "gambit-memory-"))
    setWorkspaceRootForTesting(tempWorkspace)
  })

  afterEach(async () => {
    setWorkspaceRootForTesting(originalWorkspaceRoot)
    await rm(tempWorkspace, { recursive: true, force: true })
  })

  it("writes a trimmed JSONL entry to the memories file", async () => {
    const result = await appendMemoryEntry("  remember to add tests  ")
    expect(result).not.toBeNull()

    const entry = result!
    expect(entry.content).toBe("remember to add tests")

    const memoryFilePath = path.join(tempWorkspace, ".gambit", "memories", "memories.jsonl")
    const fileContents = await readFile(memoryFilePath, "utf8")
    const lines = fileContents.trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)

    const firstLine = lines[0]
    if (firstLine === undefined) {
      throw new Error("Expected a JSONL memory entry.")
    }

    const parsed = JSON.parse(firstLine) as Record<string, unknown>
    expect(parsed.id).toBe(entry.id)
    expect(parsed.content).toBe(entry.content)
    expect(parsed.timestamp).toBe(entry.timestamp)
  })

  it("ignores empty entries", async () => {
    const result = await appendMemoryEntry("   ")
    expect(result).toBeNull()

    const memoryFilePath = path.join(tempWorkspace, ".gambit", "memories", "memories.jsonl")
    await expect(readFile(memoryFilePath, "utf8")).rejects.toHaveProperty("code", "ENOENT")
  })
})
