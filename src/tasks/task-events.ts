export type TaskEventType =
  | 'task-created'
  | 'task-updated'
  | 'task-removed'
  | 'task-output-appended'
  | 'task-output-replaced'

export interface TaskEvent {
  id: string
  taskId: string
  type: TaskEventType
  timestamp: string
  summary: string
  metadata?: Record<string, unknown>
}
