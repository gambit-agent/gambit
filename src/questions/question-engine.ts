import { generateId } from '../lib/id'
import { createObservableStore } from '../lib/observable-store'

import type {
  Question,
  QuestionAnswerBundle,
  QuestionRequestRecord,
} from './question-types'

export interface QuestionEngineSnapshot {
  activeRequest: QuestionRequestRecord | null
  queue: QuestionRequestRecord[]
}

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
  private readonly resolvers = new Map<string, PendingResolver>()
  private readonly store = createObservableStore<QuestionEngineSnapshot>({ activeRequest: null, queue: [] })

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  getSnapshot(): QuestionEngineSnapshot {
    return this.store.getSnapshot()
  }

  async ask(questions: Question[], options: AskOptions = {}): Promise<QuestionAnswerBundle> {
    if (questions.length === 0) {
      throw new Error('ask() requires at least one question.')
    }

    const record: QuestionRequestRecord = {
      id: generateId(),
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
    this.store.setState({
      activeRequest: this.activeRequest,
      queue: [...this.queue],
    })
  }
}
