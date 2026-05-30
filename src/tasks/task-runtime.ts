import { randomUUID } from 'node:crypto'

import { createTask, getTask, listTasks, reconcileInterruptedTasks, removeTask, updateTask } from './task-store'
import type { CreateTaskInput, TaskRecord, UpdateTaskInput } from './task-types'

export interface TaskRuntimeSnapshot {
  tasks: TaskRecord[]
}

type Listener = () => void

export class TaskRuntime {
  private snapshot: TaskRuntimeSnapshot = { tasks: [] }
  private readonly listeners = new Set<Listener>()
  private readonly controllers = new Map<string, AbortController>()

  async initialize(): Promise<void> {
    await reconcileInterruptedTasks()
    await this.refresh()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): TaskRuntimeSnapshot {
    return this.snapshot
  }

  async refresh(): Promise<void> {
    const tasks = await listTasks()
    tasks.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    this.snapshot = { tasks }
    this.emit()
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
    return randomUUID()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
