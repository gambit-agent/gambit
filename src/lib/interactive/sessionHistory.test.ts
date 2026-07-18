import { beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { setWorkspaceRootForTesting } from "../../config"
import {
  appendSessionEntry,
  getCurrentSession,
  loadUserHistoryEntries,
  resetSessionHistoryForTesting,
} from "./sessionHistory"

describe("sessionHistory", () => {
  let workspaceDir: string

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), "gambit-session-history-"))
    setWorkspaceRootForTesting(workspaceDir)
    resetSessionHistoryForTesting()
  })

  it("appends user entries to the current session file", async () => {
    const timestamp = new Date().toISOString()
    await appendSessionEntry({ id: "user-1", role: "user", content: "hello world", timestamp })
    const session = await getCurrentSession()
    const fileContents = await readFile(session.filePath, "utf8")
    expect(fileContents.trim().length).toBeGreaterThan(0)
    expect(fileContents).toContain("hello world")
  })

  it("returns user entries when loading history", async () => {
    const now = Date.now()
    await appendSessionEntry({
      id: "user-1",
      role: "user",
      content: "first",
      timestamp: new Date(now).toISOString(),
    })
    await appendSessionEntry({
      id: "assistant-1",
      role: "assistant",
      content: "ignored",
      timestamp: new Date(now + 500).toISOString(),
    })
    await appendSessionEntry({
      id: "user-2",
      role: "user",
      content: "second",
      timestamp: new Date(now + 1000).toISOString(),
    })

    const entries = await loadUserHistoryEntries()
    expect(entries).toEqual(["first", "second"])
  })

  it("includes legacy history entries when present", async () => {
    const legacyDir = path.join(workspaceDir, ".gambit")
    await mkdir(legacyDir, { recursive: true })
    await writeFile(
      path.join(legacyDir, "history.json"),
      JSON.stringify({ entries: ["legacy entry"] }),
      "utf8",
    )

    const entries = await loadUserHistoryEntries()
    expect(entries).toContain("legacy entry")
  })
})
