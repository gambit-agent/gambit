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
import { createObservableStore } from '../lib/observable-store'

export interface PermissionEngineSnapshot {
  mode: PermissionMode
  prePlanMode: PermissionMode | null
  requests: PermissionRequestRecord[]
  activeRequest: PermissionRequestRecord | null
}

export class PermissionEngine {
  private mode: PermissionMode = 'Normal'
  private prePlanMode: PermissionMode | null = null
  private requests: PermissionRequestRecord[] = []
  private activeRequest: PermissionRequestRecord | null = null
  private readonly store = createObservableStore<PermissionEngineSnapshot>({
    mode: this.mode,
    prePlanMode: this.prePlanMode,
    requests: this.requests,
    activeRequest: this.activeRequest,
  })
  private readonly pendingResolvers = new Map<string, (decision: Exclude<PermissionDecision, 'ask'>) => void>()

  async initialize(): Promise<void> {
    await this.refresh()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  getSnapshot(): PermissionEngineSnapshot {
    return this.store.getSnapshot()
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
    this.refreshSnapshot()
  }

  cycleMode(): PermissionMode {
    this.mode = cyclePermissionMode(this.mode)
    this.refreshSnapshot()
    return this.mode
  }

  setPrePlanMode(mode: PermissionMode | null): void {
    this.prePlanMode = mode
    this.refreshSnapshot()
  }

  getPrePlanMode(): PermissionMode {
    return this.prePlanMode ?? 'Normal'
  }

  async refresh(): Promise<void> {
    const requests = await listPermissionRequests()
    requests.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    this.requests = requests
    this.activeRequest = requests.find((request) => request.state === 'dequeued') ?? null
    this.refreshSnapshot()
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
    this.store.setState({
      mode: this.mode,
      prePlanMode: this.prePlanMode,
      requests: this.requests,
      activeRequest: this.activeRequest,
    })
  }
}
