import {
  dequeuePermissionRequest,
  enqueuePermissionRequest,
  listPermissionRequests,
  listQueuedPermissionRequests,
  resolvePermissionRequest,
} from './permission-store'
import type { PermissionDecision, PermissionRequestRecord } from './permission-types'
import {
  cyclePermissionMode,
  evaluatePermissionMode,
  type PermissionEvaluationInput,
  type PermissionMode,
} from './permission-rules'

export interface PermissionEngineSnapshot {
  mode: PermissionMode
  requests: PermissionRequestRecord[]
  activeRequest: PermissionRequestRecord | null
}

type Listener = () => void

export class PermissionEngine {
  private mode: PermissionMode = 'normal'
  private requests: PermissionRequestRecord[] = []
  private activeRequest: PermissionRequestRecord | null = null
  private snapshot: PermissionEngineSnapshot = {
    mode: this.mode,
    requests: this.requests,
    activeRequest: this.activeRequest,
  }
  private readonly listeners = new Set<Listener>()
  private readonly pendingResolvers = new Map<string, (decision: Exclude<PermissionDecision, 'ask'>) => void>()

  async initialize(): Promise<void> {
    await this.refresh()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): PermissionEngineSnapshot {
    return this.snapshot
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
    this.refreshSnapshot()
    this.emit()
  }

  cycleMode(): PermissionMode {
    this.mode = cyclePermissionMode(this.mode)
    this.refreshSnapshot()
    this.emit()
    return this.mode
  }

  async refresh(): Promise<void> {
    const requests = await listPermissionRequests()
    requests.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    this.requests = requests
    this.activeRequest = requests.find((request) => request.state === 'dequeued') ?? null
    this.refreshSnapshot()
    this.emit()
  }

  async request(input: PermissionEvaluationInput): Promise<PermissionDecision> {
    const evaluated = evaluatePermissionMode(this.mode, input)
    if (evaluated !== 'ask') {
      return evaluated
    }

    const record = await enqueuePermissionRequest({
      subject: input.subject,
      decision: 'ask',
      metadata: {
        toolId: input.toolId,
        ...input.metadata,
      },
    })

    const dequeued = await dequeuePermissionRequest()
    await this.refresh()

    const active = dequeued ?? record
    return new Promise<Exclude<PermissionDecision, 'ask'>>((resolve) => {
      this.pendingResolvers.set(active.id, resolve)
    })
  }

  async resolve(
    id: string,
    decision: Exclude<PermissionDecision, 'ask'>,
  ): Promise<PermissionRequestRecord | null> {
    const resolved = await resolvePermissionRequest(id, { decision })
    const resolver = this.pendingResolvers.get(id)
    if (resolver) {
      this.pendingResolvers.delete(id)
      resolver(decision)
    }

    const queuedRequests = await listQueuedPermissionRequests()
    if (queuedRequests.length > 0) {
      await dequeuePermissionRequest()
    }

    await this.refresh()
    return resolved
  }

  private refreshSnapshot(): void {
    this.snapshot = {
      mode: this.mode,
      requests: this.requests,
      activeRequest: this.activeRequest,
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
