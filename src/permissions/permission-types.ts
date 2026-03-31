export type PermissionDecision = 'allow' | 'deny' | 'ask'

export type PermissionRequestState = 'queued' | 'dequeued' | 'resolved'

export interface PermissionRequestRecord {
  id: string
  subject: string
  decision: PermissionDecision
  state: PermissionRequestState
  createdAt: string
  dequeuedAt?: string
  resolvedAt?: string
  metadata?: Record<string, unknown>
}

export interface EnqueuePermissionRequestInput {
  subject: string
  decision?: PermissionDecision
  metadata?: Record<string, unknown>
}

export interface ResolvePermissionRequestInput {
  decision: Exclude<PermissionDecision, 'ask'>
}
