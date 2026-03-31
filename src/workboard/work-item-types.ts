export type WorkItemStatus = 'pending' | 'claimed' | 'completed' | 'blocked'

export interface WorkItemRecord {
  id: string
  title: string
  description: string
  status: WorkItemStatus
  createdAt: string
  ownerAgentId?: string
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

export interface CreateWorkItemInput {
  title: string
  description: string
  status?: WorkItemStatus
  ownerAgentId?: string
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

export interface UpdateWorkItemInput {
  title?: string
  description?: string
  status?: WorkItemStatus
  ownerAgentId?: string | null
  blockedBy?: string[] | null
  metadata?: Record<string, unknown> | null
}
