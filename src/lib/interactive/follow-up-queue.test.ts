import { describe, expect, it } from "bun:test"

import { FollowUpQueue } from "./follow-up-queue"

describe("FollowUpQueue", () => {
  it("drains in FIFO order", () => {
    const queue = new FollowUpQueue()
    queue.enqueue("first")
    queue.enqueue("second")
    queue.enqueue("third")

    expect(queue.drain()).toBe("first")
    expect(queue.drain()).toBe("second")
    expect(queue.drain()).toBe("third")
    expect(queue.drain()).toBeUndefined()
  })

  it("pops in LIFO order", () => {
    const queue = new FollowUpQueue()
    queue.enqueue("first")
    queue.enqueue("second")
    queue.enqueue("third")

    expect(queue.pop()).toBe("third")
    expect(queue.pop()).toBe("second")
    expect(queue.pop()).toBe("first")
    expect(queue.pop()).toBeUndefined()
  })

  it("returns undefined when popping or draining an empty queue", () => {
    const queue = new FollowUpQueue()

    expect(queue.pop()).toBeUndefined()
    expect(queue.drain()).toBeUndefined()
    expect(queue.size).toBe(0)
    expect(queue.snapshot).toEqual([])
  })

  it("supports interleaved pop (newest) and drain (oldest)", () => {
    const queue = new FollowUpQueue()
    queue.enqueue("a")
    queue.enqueue("b")
    queue.enqueue("c")

    // Up-arrow pulls the newest entry back for editing...
    expect(queue.pop()).toBe("c")
    // ...while the run-finished drain still takes the oldest.
    expect(queue.drain()).toBe("a")
    expect(queue.snapshot).toEqual(["b"])

    // Re-enqueueing a popped entry appends it after the remaining items.
    queue.enqueue("c (edited)")
    expect(queue.drain()).toBe("b")
    expect(queue.drain()).toBe("c (edited)")
    expect(queue.drain()).toBeUndefined()
  })

  it("requeues at the head so a drained-but-unrunnable item keeps FIFO order", () => {
    const queue = new FollowUpQueue()
    queue.enqueue("first")
    queue.enqueue("second")
    queue.enqueue("third")

    // The drain pops 'first', but a run turned out to be active; putting it
    // back at the head preserves the original order instead of rotating it.
    const drained = queue.drain()
    expect(drained).toBe("first")
    queue.requeueFront(drained!)

    expect(queue.snapshot).toEqual(["first", "second", "third"])
    expect(queue.drain()).toBe("first")
    expect(queue.drain()).toBe("second")
    expect(queue.drain()).toBe("third")
  })

  it("requeueFront works on an empty queue", () => {
    const queue = new FollowUpQueue()
    queue.requeueFront("only")

    expect(queue.size).toBe(1)
    expect(queue.drain()).toBe("only")
  })

  it("keeps snapshot immutable from the outside", () => {
    const queue = new FollowUpQueue()
    queue.enqueue("only")

    const snapshot = queue.snapshot
    snapshot.push("mutated")

    expect(queue.snapshot).toEqual(["only"])
  })
})
