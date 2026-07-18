/**
 * In-process promise-chain mutex. Tasks run strictly one at a time in enqueue
 * order; each task starts only after the previous one settled (success or
 * failure). Used to serialize lockless read-modify-rewrite cycles on shared
 * files, where interleaved writers would silently drop each other's changes
 * (lost updates).
 */
export interface SerialQueue {
  /**
   * Enqueue a task. Returns the task's own result promise; a rejection
   * propagates to this caller but never blocks later tasks.
   */
  run<T>(task: () => Promise<T> | T): Promise<T>
  /** Resolves once every task enqueued so far has settled. Never rejects. */
  flush(): Promise<void>
}

export function createSerialQueue(): SerialQueue {
  let chain: Promise<unknown> = Promise.resolve()

  return {
    run<T>(task: () => Promise<T> | T): Promise<T> {
      const start = () => task()
      const result = chain.then(start, start)
      // Keep the chain rejection-free so one failed task neither blocks nor
      // fails subsequent tasks; callers still observe their own rejection.
      chain = result.catch(() => undefined)
      return result
    },
    flush(): Promise<void> {
      return chain.then(
        () => undefined,
        () => undefined,
      )
    },
  }
}
