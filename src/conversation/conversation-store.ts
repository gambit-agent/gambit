import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { appendJsonlEntry, readJsonlEntries } from './transcript'
import type { ConversationMessage, ConversationTurnRecord } from './conversation-types'

export interface ConversationStoreOptions {
  rootPath?: string
  conversationId?: string
}

export interface ConversationStoreSnapshot {
  conversationId: string
  directory: string
  transcriptPath: string
  messages: ConversationMessage[]
  status: 'idle' | 'running'
  error: string | null
}

type Listener = () => void

export class ConversationStore {
  readonly conversationId: string
  readonly directory: string
  readonly transcriptPath: string
  private messages: ConversationMessage[] = []
  private status: 'idle' | 'running' = 'idle'
  private error: string | null = null
  private snapshotState: ConversationStoreSnapshot
  private readonly listeners = new Set<Listener>()

  constructor(options: ConversationStoreOptions = {}) {
    this.conversationId = options.conversationId ?? randomUUID()
    const rootPath = options.rootPath ?? workspaceRoot
    this.directory = path.join(rootPath, '.gambit', 'conversations', this.conversationId)
    this.transcriptPath = path.join(this.directory, 'transcript.jsonl')
    this.snapshotState = {
      conversationId: this.conversationId,
      directory: this.directory,
      transcriptPath: this.transcriptPath,
      messages: this.messages,
      status: this.status,
      error: this.error,
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
  }

  async initialize(initialMessages: ConversationMessage[] = []): Promise<void> {
    await this.ensureReady()
    const persistedMessages = await this.loadMessages()
    if (persistedMessages.length > 0) {
      this.messages = persistedMessages
    } else if (initialMessages.length > 0) {
      this.messages = [...initialMessages]
      for (const message of initialMessages) {
        await appendJsonlEntry(this.transcriptPath, {
          kind: 'message',
          ...message,
        })
      }
    }
    this.refreshSnapshot()
    this.emit()
  }

  getSnapshot(): ConversationStoreSnapshot {
    return this.snapshotState
  }

  setStatus(status: 'idle' | 'running'): void {
    this.status = status
    this.refreshSnapshot()
    this.emit()
  }

  setError(error: string | null): void {
    this.error = error
    this.refreshSnapshot()
    this.emit()
  }

  async pushMessage(message: ConversationMessage, options: { persist?: boolean } = {}): Promise<void> {
    this.messages = [...this.messages, message]
    this.refreshSnapshot()
    this.emit()

    if (options.persist !== false) {
      await this.ensureReady()
      await appendJsonlEntry(this.transcriptPath, {
        kind: 'message',
        ...message,
      })
    }
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    await this.pushMessage(message)
  }

  async appendTurn(record: ConversationTurnRecord): Promise<void> {
    await this.ensureReady()
    await appendJsonlEntry(this.transcriptPath, {
      kind: 'turn',
      ...record,
    })
  }

  updateMessage(id: string, patch: Partial<ConversationMessage>): void {
    this.messages = this.messages.map((message) => (message.id === id ? { ...message, ...patch } : message))
    this.refreshSnapshot()
    this.emit()
  }

  removeMessage(id: string): void {
    this.messages = this.messages.filter((message) => message.id !== id)
    this.refreshSnapshot()
    this.emit()
  }

  reset(messages: ConversationMessage[]): void {
    this.messages = [...messages]
    this.error = null
    this.status = 'idle'
    this.refreshSnapshot()
    this.emit()
  }

  async loadMessages(): Promise<ConversationMessage[]> {
    const entries = await readJsonlEntries<ConversationMessage & { kind?: string }>(this.transcriptPath)
    return entries.filter((entry) => entry.kind !== 'turn') as ConversationMessage[]
  }

  async loadTurnRecords(): Promise<ConversationTurnRecord[]> {
    const entries = await readJsonlEntries<ConversationTurnRecord & { kind?: string }>(this.transcriptPath)
    return entries.filter((entry) => entry.kind === 'turn') as ConversationTurnRecord[]
  }

  private refreshSnapshot(): void {
    this.snapshotState = {
      conversationId: this.conversationId,
      directory: this.directory,
      transcriptPath: this.transcriptPath,
      messages: this.messages,
      status: this.status,
      error: this.error,
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export function createConversationStore(options: ConversationStoreOptions = {}): ConversationStore {
  return new ConversationStore(options)
}
