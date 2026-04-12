import { randomUUID } from 'node:crypto'

import type {
  Question,
  QuestionAnswerBundle,
  QuestionRequestRecord,
} from './question-types'

export interface QuestionEngineSnapshot {
  activeRequest: QuestionRequestRecord | null
  queue: QuestionRequestRecord[]
}

type Listener = () => void

interface PendingResolver {
  resolve: (bundle: QuestionAnswerBundle) => void
  reject: (error: Error) => void
}

export interface AskOptions {
  source?: string
  signal?: AbortSignal
}

export class QuestionEngine {
  private activeRequest: QuestionRequestRecord | null = null
  private readonly queue: QuestionRequestRecord[] = []
  private readonly listeners = new Set<Listener>()
  private readonly resolvers = new Map<string, PendingResolver>()
  private snapshot: QuestionEngineSnapshot = { activeRequest: null, queue: [] }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): QuestionEngineSnapshot {
    return this.snapshot
  }

  async ask(questions: Question[], options: AskOptions = {}): Promise<QuestionAnswerBundle> {
    if (questions.length === 0) {
      throw new Error('ask() requires at least one question.')
    }

    const record: QuestionRequestRecord = {
      id: randomUUID(),
      questions,
      state: 'pending',
      createdAt: new Date().toISOString(),
      source: options.source,
    }

    return new Promise<QuestionAnswerBundle>((resolve, reject) => {
      this.resolvers.set(record.id, { resolve, reject })
      if (options.signal) {
        const onAbort = () => {
          this.reject(record.id, new Error('Question request aborted.'))
        }
        if (options.signal.aborted) {
          onAbort()
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      this.enqueue(record)
    })
  }

  resolve(id: string, bundle: QuestionAnswerBundle): void {
    const resolver = this.resolvers.get(id)
    if (!resolver) {
      return
    }
    this.resolvers.delete(id)
    this.markResolved(id, 'resolved')
    resolver.resolve(bundle)
    this.advance()
  }

  reject(id: string, error: Error): void {
    const resolver = this.resolvers.get(id)
    if (!resolver) {
      return
    }
    const wasActive = this.activeRequest?.id === id
    this.resolvers.delete(id)
    this.markResolved(id, 'rejected')
    resolver.reject(error)
    if (wasActive) {
      this.advance()
    } else {
      this.refresh()
    }
  }

  private enqueue(record: QuestionRequestRecord): void {
    if (this.activeRequest) {
      this.queue.push(record)
    } else {
      this.activeRequest = record
    }
    this.refresh()
  }

  private advance(): void {
    this.activeRequest = this.queue.shift() ?? null
    this.refresh()
  }

  private markResolved(id: string, state: 'resolved' | 'rejected'): void {
    if (this.activeRequest?.id === id) {
      this.activeRequest = { ...this.activeRequest, state }
      return
    }
    const index = this.queue.findIndex((record) => record.id === id)
    if (index >= 0) {
      this.queue.splice(index, 1)
    }
  }

  private refresh(): void {
    this.snapshot = {
      activeRequest: this.activeRequest,
      queue: [...this.queue],
    }
    for (const listener of this.listeners) {
      listener()
    }
  }
}
