import { useCallback, useRef, useState } from 'react'

/**
 * Plain queue backing `useFollowUpQueue`. Follow-ups are drained FIFO when a
 * run finishes, while `pop` removes the most recently queued entry (LIFO) so
 * up-arrow can pull the newest follow-up back into the composer for editing.
 */
export class FollowUpQueue {
  private items: string[] = []

  get size(): number {
    return this.items.length
  }

  get snapshot(): string[] {
    return [...this.items]
  }

  enqueue(value: string): void {
    this.items = [...this.items, value]
  }

  /**
   * Inserts an entry at the head of the queue. Used when a drained follow-up
   * could not run (a run was already active) and must be put back without
   * rotating the FIFO order.
   */
  requeueFront(value: string): void {
    this.items = [value, ...this.items]
  }

  /** Removes and returns the oldest entry (FIFO). */
  drain(): string | undefined {
    if (this.items.length === 0) return undefined
    const next = this.items[0]
    this.items = this.items.slice(1)
    return next
  }

  /** Removes and returns the newest entry (LIFO). */
  pop(): string | undefined {
    if (this.items.length === 0) return undefined
    const last = this.items[this.items.length - 1]
    this.items = this.items.slice(0, -1)
    return last
  }
}

export function useFollowUpQueue() {
  const queueRef = useRef<FollowUpQueue | null>(null)
  if (queueRef.current === null) {
    queueRef.current = new FollowUpQueue()
  }
  const [followUpQueue, setFollowUpQueue] = useState<string[]>([])

  const enqueueFollowUp = useCallback((value: string) => {
    queueRef.current!.enqueue(value)
    setFollowUpQueue(queueRef.current!.snapshot)
  }, [])

  const drainFollowUp = useCallback(() => {
    const next = queueRef.current!.drain()
    if (next !== undefined) {
      setFollowUpQueue(queueRef.current!.snapshot)
    }
    return next
  }, [])

  const popFollowUp = useCallback(() => {
    const last = queueRef.current!.pop()
    if (last !== undefined) {
      setFollowUpQueue(queueRef.current!.snapshot)
    }
    return last
  }, [])

  const requeueFrontFollowUp = useCallback((value: string) => {
    queueRef.current!.requeueFront(value)
    setFollowUpQueue(queueRef.current!.snapshot)
  }, [])

  // Synchronous size read from the ref. The `followUpQueue` React snapshot
  // lags mutations within a frame, which misroutes rapid key events (e.g.
  // two up-arrows in one frame); navigation decisions must use this instead.
  const getFollowUpQueueSize = useCallback(() => queueRef.current!.size, [])

  return {
    followUpQueue,
    enqueueFollowUp,
    drainFollowUp,
    popFollowUp,
    requeueFrontFollowUp,
    getFollowUpQueueSize,
  }
}
