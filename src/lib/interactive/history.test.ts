import { describe, expect, it } from "bun:test"

import { InteractiveHistory } from "./history"

describe("InteractiveHistory", () => {
  it("navigates backward and forward through history", () => {
    const history = new InteractiveHistory([])
    history.add("first command")
    history.add("second command")

    expect(history.previous()).toBe("second command")
    expect(history.previous()).toBe("first command")
    expect(history.previous()).toBe("first command")
    expect(history.next()).toBe("second command")
    expect(history.next()).toBe("")
  })

  it("skips slash commands during arrow navigation", () => {
    const history = new InteractiveHistory([
      "first command",
      "/model",
      "second command",
      "/theme dark",
    ])

    expect(history.previous()).toBe("second command")
    expect(history.previous()).toBe("first command")
    expect(history.previous()).toBe("first command")
    expect(history.next()).toBe("second command")
    expect(history.next()).toBe("")
  })

  it("returns null when history only contains slash commands", () => {
    const history = new InteractiveHistory(["/model", "/theme dark"])

    expect(history.previous()).toBeNull()
    expect(history.next()).toBeNull()
  })

  it("still finds slash commands via search", () => {
    const history = new InteractiveHistory(["/model", "first command"])

    expect(history.findLatestMatch("model")?.value).toBe("/model")
  })

  it("finds matches when searching backwards", () => {
    const history = new InteractiveHistory([
      "bun run build",
      "git status",
      "bun test",
      "git commit",
      "bun test --watch",
    ])

    const firstMatch = history.findLatestMatch("bun")
    expect(firstMatch?.value).toBe("bun test --watch")

    const earlierMatch = history.findLatestMatch("bun", (firstMatch?.index ?? 0) - 1)
    expect(earlierMatch?.value).toBe("bun test")
  })
})
