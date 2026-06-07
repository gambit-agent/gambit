import { generateId } from '../lib/id'
import { createObservableStore } from '../lib/observable-store'

import { createTask, getTask, listTasks, reconcileInterruptedTasks, removeTask, updateTask } from './task-store'
import type { CreateTaskInput, TaskRecord, TaskStatus, UpdateTaskInput } from './task-types'

export interface TaskRuntimeSnapshot {
  tasks: TaskRecord[]
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export class TaskRuntime {
  private readonly store = createObservableStore<TaskRuntimeSnapshot>({ tasks: [] })
  private readonly controllers = new Map<string, AbortController>()

  async initialize(): Promise<void> {
    await reconcileInterruptedTasks()
    await this.refresh()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  getSnapshot(): TaskRuntimeSnapshot {
    return this.store.getSnapshot()
  }

  async refresh(): Promise<void> {
    const tasks = await listTasks()
    tasks.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    this.store.setState({ tasks })
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const task = await createTask(input)
    await this.refresh()
    return task
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<TaskRecord | null> {
    const task = await updateTask(id, patch)
    await this.refresh()
    return task
  }

  async removeTask(id: string): Promise<TaskRecord | null> {
    await this.cancelTask(id)
    const task = await removeTask(id)
    await this.refresh()
    return task
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    return getTask(id)
  }

  async *watchTasks(
    ids: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): AsyncGenerator<TaskRecord[]> {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) {
      return
    }

    let timeout: ReturnType<typeof setTimeout> | null = null
    let pendingResolve: (() => void) | null = null
    let lastSignature = ''
    let pendingError: Error | null = null
    const queue: TaskRecord[][] = []

    const wake = () => {
      pendingResolve?.()
      pendingResolve = null
    }

    const enqueueIfChanged = (): void => {
      const found = uniqueIds
        .map((id) => this.getSnapshot().tasks.find((task) => task.id === id))
        .filter((task): task is TaskRecord => Boolean(task))
      const foundIds = new Set(found.map((task) => task.id))
      const missing = uniqueIds.filter((id) => !foundIds.has(id))
      if (missing.length > 0) {
        pendingError = new Error(`Task not found: ${missing.join(', ')}`)
        wake()
        return
      }
      const signature = found
        .map((task) =>
          [
            task.id,
            task.status,
            task.progressSummary ?? '',
            task.finishedAt ?? '',
            task.error ?? '',
          ].join('\u0000'),
        )
        .join('\u0001')

      if (signature !== lastSignature) {
        lastSignature = signature
        queue.push(found)
        wake()
      }
    }

    const unsubscribe = this.subscribe(enqueueIfChanged)

    const abort = () => {
      wake()
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(wake, options.timeoutMs)
    }

    const startedAt = Date.now()

    try {
      enqueueIfChanged()
      while (true) {
        if (options.signal?.aborted) {
          throw new Error('Task wait was cancelled.')
        }
        if (pendingError) {
          throw pendingError
        }
        if (options.timeoutMs !== undefined && Date.now() - startedAt >= options.timeoutMs) {
          throw new Error(`Timed out waiting for tasks: ${uniqueIds.join(', ')}`)
        }

        const next = queue.shift()
        if (!next) {
          await new Promise<void>((resolve) => {
            pendingResolve = resolve
          })
          continue
        }

        yield next

        const foundIds = new Set(next.map((task) => task.id))
        const allFound = uniqueIds.every((id) => foundIds.has(id))
        if (allFound && next.every((task) => isTerminalTaskStatus(task.status))) {
          return
        }
      }
    } finally {
      unsubscribe()
      options.signal?.removeEventListener('abort', abort)
      if (timeout) {
        clearTimeout(timeout)
      }
      pendingResolve = null
    }
  }

  async waitForTasks(
    ids: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<TaskRecord[]> {
    let latest: TaskRecord[] = []
    for await (const tasks of this.watchTasks(ids, options)) {
      latest = tasks
    }
    return latest
  }

  registerController(id: string, controller: AbortController): () => void {
    this.controllers.set(id, controller)
    return () => {
      if (this.controllers.get(id) === controller) {
        this.controllers.delete(id)
      }
    }
  }

  async cancelTask(id: string): Promise<TaskRecord | null> {
    const current = await getTask(id)
    if (!current) {
      return null
    }

    const controller = this.controllers.get(id)
    if (controller && !controller.signal.aborted) {
      controller.abort()
    }
    this.controllers.delete(id)

    if (current.status !== 'pending' && current.status !== 'running') {
      await this.refresh()
      return current
    }

    const task = await updateTask(id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      progressSummary: 'Task was cancelled.',
    })
    await this.refresh()
    return task
  }

  createEventId(): string {
    return generateId()
  }

}
