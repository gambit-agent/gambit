import { describe, expect, it } from "bun:test"

import { resolveDownArrowAction, resolveUpArrowAction } from "./composer-navigation"

describe("resolveUpArrowAction", () => {
  it("pops the newest queued follow-up when the composer is empty", () => {
    expect(
      resolveUpArrowAction({ composerValue: "", followUpQueueLength: 2, cursor: null }),
    ).toBe("pop-follow-up")
    expect(
      resolveUpArrowAction({ composerValue: "   ", followUpQueueLength: 1, cursor: null }),
    ).toBe("pop-follow-up")
  })

  it("falls through to history when the queue is empty", () => {
    expect(
      resolveUpArrowAction({ composerValue: "", followUpQueueLength: 0, cursor: null }),
    ).toBe("history-previous")
  })

  it("falls through to history when the composer has content (queue is not popped)", () => {
    expect(
      resolveUpArrowAction({
        composerValue: "draft",
        followUpQueueLength: 3,
        cursor: { row: 0, lineCount: 1 },
      }),
    ).toBe("history-previous")
  })

  it("navigates history only from the first line of a multi-line draft", () => {
    expect(
      resolveUpArrowAction({
        composerValue: "line one\nline two",
        followUpQueueLength: 0,
        cursor: { row: 0, lineCount: 2 },
      }),
    ).toBe("history-previous")
    expect(
      resolveUpArrowAction({
        composerValue: "line one\nline two",
        followUpQueueLength: 0,
        cursor: { row: 1, lineCount: 2 },
      }),
    ).toBe("none")
  })

  it("treats an unknown cursor as single-line (history allowed)", () => {
    expect(
      resolveUpArrowAction({ composerValue: "draft", followUpQueueLength: 0, cursor: null }),
    ).toBe("history-previous")
  })
})

describe("resolveDownArrowAction", () => {
  it("re-enqueues a popped follow-up instead of navigating history", () => {
    expect(
      resolveDownArrowAction({
        composerValue: "popped follow-up",
        poppedFollowUp: "popped follow-up",
        cursor: { row: 0, lineCount: 1 },
      }),
    ).toBe("re-enqueue-popped")
  })

  it("re-enqueues even when the user cleared the composer after the pop", () => {
    expect(
      resolveDownArrowAction({ composerValue: "", poppedFollowUp: "popped follow-up", cursor: null }),
    ).toBe("re-enqueue-popped")
  })

  it("navigates history when nothing was popped", () => {
    expect(
      resolveDownArrowAction({ composerValue: "", poppedFollowUp: null, cursor: null }),
    ).toBe("history-next")
    expect(
      resolveDownArrowAction({
        composerValue: "draft",
        poppedFollowUp: null,
        cursor: { row: 0, lineCount: 1 },
      }),
    ).toBe("history-next")
  })

  it("lets the cursor move within a multi-line draft", () => {
    expect(
      resolveDownArrowAction({
        composerValue: "line one\nline two",
        poppedFollowUp: "line one\nline two",
        cursor: { row: 0, lineCount: 2 },
      }),
    ).toBe("none")
    expect(
      resolveDownArrowAction({
        composerValue: "line one\nline two",
        poppedFollowUp: null,
        cursor: { row: 1, lineCount: 2 },
      }),
    ).toBe("history-next")
  })
})
