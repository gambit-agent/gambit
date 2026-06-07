import { generateId } from '../lib/id'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { createObservableStore, type ObservableStore } from '../lib/observable-store'
import { appendJsonlEntry, readJsonlEntries } from './transcript'
import { writeJsonlEntries } from '../session/jsonl'
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
  initialized: boolean
}

export class ConversationStore {
  readonly rootPath: string
  private currentConversationId: string
  private currentDirectory: string
  private currentTranscriptPath: string
  private messages: ConversationMessage[] = []
  private status: 'idle' | 'running' = 'idle'
  private error: string | null = null
  private initialized = false
  private readonly store: ObservableStore<ConversationStoreSnapshot>

  constructor(options: ConversationStoreOptions = {}) {
    this.rootPath = options.rootPath ?? workspaceRoot
    this.currentConversationId = options.conversationId ?? generateId()
    this.currentDirectory = path.join(this.rootPath, '.gambit', 'conversations', this.currentConversationId)
    this.currentTranscriptPath = path.join(this.currentDirectory, 'transcript.jsonl')
    this.store = createObservableStore(this.createSnapshot())
  }

  get conversationId(): string {
    return this.currentConversationId
  }

  get directory(): string {
    return this.currentDirectory
  }

  get transcriptPath(): string {
    return this.currentTranscriptPath
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.currentDirectory, { recursive: true })
  }

  async initialize(initialMessages: ConversationMessage[] = []): Promise<void> {
    await this.openConversation(this.currentConversationId, initialMessages)
  }

  async openConversation(conversationId: string, initialMessages: ConversationMessage[] = []): Promise<void> {
    this.assignConversationPaths(conversationId)
    this.messages = []
    this.status = 'idle'
    this.error = null
    await this.ensureReady()

    const persistedMessages = await this.loadMessages()
    if (persistedMessages.length > 0) {
      this.messages = persistedMessages
    } else if (initialMessages.length > 0) {
      this.messages = [...initialMessages]
      await this.persistMessageSnapshot(initialMessages)
    }

    this.initialized = true
    this.refreshSnapshot()
  }

  async startNewConversation(initialMessages: ConversationMessage[] = []): Promise<string> {
    const conversationId = generateId()
    await this.openConversation(conversationId, initialMessages)
    return conversationId
  }

  getSnapshot(): ConversationStoreSnapshot {
    return this.store.getSnapshot()
  }

  setStatus(status: 'idle' | 'running'): void {
    this.status = status
    this.refreshSnapshot()
  }

  setError(error: string | null): void {
    this.error = error
    this.refreshSnapshot()
  }

  async pushMessage(message: ConversationMessage, options: { persist?: boolean } = {}): Promise<void> {
    this.initialized = true
    this.messages = [...this.messages, message]
    this.refreshSnapshot()

    if (options.persist !== false) {
      await this.ensureReady()
      await appendJsonlEntry(this.currentTranscriptPath, {
        kind: 'message',
        ...message,
      })
    }
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    await this.pushMessage(message)
  }

  async appendTurn(record: ConversationTurnRecord): Promise<void> {
    this.initialized = true
    await this.ensureReady()
    await appendJsonlEntry(this.currentTranscriptPath, {
      kind: 'turn',
      ...record,
    })
  }

  updateMessage(id: string, patch: Partial<ConversationMessage>): void {
    this.messages = this.messages.map((message) => (message.id === id ? { ...message, ...patch } : message))
    this.refreshSnapshot()
  }

  removeMessage(id: string): void {
    this.messages = this.messages.filter((message) => message.id !== id)
    this.refreshSnapshot()
  }

  reset(messages: ConversationMessage[]): void {
    this.initialized = true
    this.messages = [...messages]
    this.error = null
    this.status = 'idle'
    this.refreshSnapshot()
  }

  async replaceMessages(messages: ConversationMessage[]): Promise<void> {
    this.initialized = true
    this.messages = [...messages]
    this.error = null
    this.status = 'idle'
    this.refreshSnapshot()
    await this.persistMessageSnapshot(messages)
  }

  async loadMessages(): Promise<ConversationMessage[]> {
    const entries = await readJsonlEntries<ConversationMessage & { kind?: string }>(this.currentTranscriptPath)
    return entries.filter((entry) => entry.kind !== 'turn') as ConversationMessage[]
  }

  async loadTurnRecords(): Promise<ConversationTurnRecord[]> {
    const entries = await readJsonlEntries<ConversationTurnRecord & { kind?: string }>(this.currentTranscriptPath)
    return entries.filter((entry) => entry.kind === 'turn') as ConversationTurnRecord[]
  }

  private refreshSnapshot(): void {
    this.store.setState(this.createSnapshot())
  }

  private createSnapshot(): ConversationStoreSnapshot {
    return {
      conversationId: this.currentConversationId,
      directory: this.currentDirectory,
      transcriptPath: this.currentTranscriptPath,
      messages: this.messages,
      status: this.status,
      error: this.error,
      initialized: this.initialized,
    }
  }

  private assignConversationPaths(conversationId: string): void {
    this.currentConversationId = conversationId
    this.currentDirectory = path.join(this.rootPath, '.gambit', 'conversations', conversationId)
    this.currentTranscriptPath = path.join(this.currentDirectory, 'transcript.jsonl')
  }

  private async persistMessageSnapshot(messages: ConversationMessage[]): Promise<void> {
    await this.ensureReady()
    await writeJsonlEntries(
      this.currentTranscriptPath,
      messages.map((message) => ({
        kind: 'message',
        ...message,
      })),
    )
  }
}

export function createConversationStore(options: ConversationStoreOptions = {}): ConversationStore {
  return new ConversationStore(options)
}
