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
    const task = await removeTask(id)
    await this.refresh()
    return task
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    return getTask(id)
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
