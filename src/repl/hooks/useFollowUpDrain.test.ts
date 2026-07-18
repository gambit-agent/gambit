import { describe, expect, it } from "bun:test"

import type { SubmitOutcome } from "../../lib/interactive/controller"
import { FollowUpDrainGate, drainFollowUps } from "./useFollowUpDrain"

describe("FollowUpDrainGate", () => {
  it("allows a single drain per idle period", () => {
    const gate = new FollowUpDrainGate()

    gate.observeStatus("idle")
    expect(gate.tryBeginDrain("idle")).toBe(true)

    // The drain effect re-runs while the status is still 'idle' (the queue
    // state update changes the controller identity). The second drain must
    // not begin, otherwise it would abort the first run.
    gate.observeStatus("idle")
    expect(gate.tryBeginDrain("idle")).toBe(false)
  })

  it("re-arms once the status leaves idle and drains again on the next idle", () => {
    const gate = new FollowUpDrainGate()

    expect(gate.tryBeginDrain("idle")).toBe(true)
    expect(gate.tryBeginDrain("idle")).toBe(false)

    gate.observeStatus("running")
    expect(gate.isDraining).toBe(false)
    // Still not idle: no drain while running.
    expect(gate.tryBeginDrain("running")).toBe(false)

    gate.observeStatus("idle")
    expect(gate.tryBeginDrain("idle")).toBe(true)
  })

  it("never begins a drain while not idle", () => {
    const gate = new FollowUpDrainGate()
    expect(gate.tryBeginDrain("running")).toBe(false)
    expect(gate.tryBeginDrain("error")).toBe(false)
  })

  it("never begins a drain while a run is synchronously active, even if the store status lags at idle", () => {
    const gate = new FollowUpDrainGate()

    expect(gate.tryBeginDrain("idle", true)).toBe(false)
    expect(gate.isDraining).toBe(false)

    // Once the run clears, the drain proceeds normally.
    expect(gate.tryBeginDrain("idle", false)).toBe(true)
  })

  it("re-arms via cancel when the queue turned out to be empty", () => {
    const gate = new FollowUpDrainGate()

    expect(gate.tryBeginDrain("idle")).toBe(true)
    gate.cancelDrain()
    expect(gate.tryBeginDrain("idle")).toBe(true)
  })

  it("re-arms on settle only if the run never left idle", () => {
    const gate = new FollowUpDrainGate()

    // Failed submit: status never left idle, so settle re-arms the gate.
    expect(gate.tryBeginDrain("idle")).toBe(true)
    gate.settleDrain("idle")
    expect(gate.tryBeginDrain("idle")).toBe(true)

    // Normal flow: the run started; settle while running keeps future idle
    // transitions in charge of re-arming (observeStatus already cleared it).
    gate.observeStatus("running")
    gate.settleDrain("running")
    expect(gate.tryBeginDrain("running")).toBe(false)
    gate.observeStatus("idle")
    expect(gate.tryBeginDrain("idle")).toBe(true)
  })
})

describe("drainFollowUps", () => {
  function createDeps({
    queue,
    submit,
    status = () => "idle",
    runActive = () => false,
  }: {
    queue: string[]
    submit: (value: string) => Promise<SubmitOutcome | void>
    status?: () => string
    runActive?: () => boolean
  }) {
    const gate = new FollowUpDrainGate()
    const submitted: string[] = []
    return {
      gate,
      submitted,
      deps: {
        gate,
        getStatus: status,
        isRunActive: runActive,
        drainFollowUp: () => queue.shift(),
        submit: async (value: string) => {
          submitted.push(value)
          return submit(value)
        },
      },
    }
  }

  it("recovers from a local-command drain that never leaves idle and keeps draining the remaining items", async () => {
    // '/model' is a local UI slash command: the submit settles while the
    // status is still 'idle'. The second entry starts a real run.
    const queue = ["/model", "do the real work"]
    let status = "idle"
    const { deps, submitted } = createDeps({
      queue,
      status: () => status,
      submit: async (value) => {
        if (value === "do the real work") {
          status = "running"
        }
        return "submitted"
      },
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual(["/model", "do the real work"])
    expect(queue).toEqual([])
  })

  it("drains a whole queue of local-only commands in FIFO order", async () => {
    const queue = ["/model", "/themes", "/mcp"]
    const { deps, submitted, gate } = createDeps({
      queue,
      submit: async () => "submitted",
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual(["/model", "/themes", "/mcp"])
    expect(queue).toEqual([])
    // Gate re-armed: nothing is stuck for the next enqueue.
    expect(gate.isDraining).toBe(false)
  })

  it("does not drain while a run is synchronously active", async () => {
    const queue = ["queued while running"]
    const { deps, submitted } = createDeps({
      queue,
      runActive: () => true,
      submit: async () => "submitted",
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual([])
    expect(queue).toEqual(["queued while running"])
  })

  it("pauses after a continuation entry so the user sees the stuffed composer, then resumes after the next run", async () => {
    // Behavior decision: a drained entry ending in '\' is an unfinished
    // draft. It goes back into the composer and the drain holds instead of
    // submitting the rest of the queue past it.
    const queue = ["unfinished draft \\", "second item"]
    const { deps, submitted, gate } = createDeps({
      queue,
      submit: async (value) => (value.endsWith("\\") ? "continuation" : "submitted"),
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual(["unfinished draft \\"])
    expect(queue).toEqual(["second item"])
    // Held: no further drain begins in this idle period.
    expect(gate.isDraining).toBe(true)

    // The user submits the composer content; the run starting re-arms the
    // gate, and the next idle period drains the remaining item.
    gate.observeStatus("running")
    gate.observeStatus("idle")
    await drainFollowUps(deps)

    expect(submitted).toEqual(["unfinished draft \\", "second item"])
    expect(queue).toEqual([])
  })

  it("re-arms and continues when a submit rejects without starting a run", async () => {
    const queue = ["will fail", "will succeed"]
    const { deps, submitted } = createDeps({
      queue,
      submit: async (value) => {
        if (value === "will fail") {
          throw new Error("submit failed")
        }
        return "submitted"
      },
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual(["will fail", "will succeed"])
    expect(queue).toEqual([])
  })

  it("cancels cleanly when the queue is empty", async () => {
    const { deps, submitted, gate } = createDeps({
      queue: [],
      submit: async () => "submitted",
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual([])
    expect(gate.isDraining).toBe(false)
  })

  it("stops after a 'queued' outcome (run became active mid-drain)", async () => {
    // handleSubmit noticed a run was active and requeued the value at the
    // head; the drain must not spin on it.
    const queue = ["first"]
    let runActive = false
    const { deps, submitted } = createDeps({
      queue,
      runActive: () => runActive,
      submit: async (value) => {
        runActive = true
        queue.unshift(value)
        return "queued"
      },
    })

    await drainFollowUps(deps)

    expect(submitted).toEqual(["first"])
    expect(queue).toEqual(["first"])
  })
})
