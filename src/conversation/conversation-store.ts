import { generateId } from '../lib/id'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from '../config'
import { createObservableStore, type ObservableStore } from '../lib/observable-store'
import { appendJsonlEntries, appendJsonlEntry, readRawJsonlEntries, writeJsonlEntries } from '../session/jsonl'
import type { ConversationMessage } from './conversation-types'

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

/** Maximum size of a persisted tool result, so transcripts stay bounded. */
const MAX_PERSISTED_TOOL_RESULT_CHARS = 16_384
const TOOL_RESULT_TRUNCATION_SUFFIX = '\n[truncated for persistence]'

/**
 * Persist tool results (capped) so resumed sessions can replay real tool
 * output instead of the short human-readable summary. Values over the cap are
 * stored as truncated strings with an explicit marker.
 */
function capToolResultForPersistence(value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return value.length > MAX_PERSISTED_TOOL_RESULT_CHARS
      ? value.slice(0, MAX_PERSISTED_TOOL_RESULT_CHARS) + TOOL_RESULT_TRUNCATION_SUFFIX
      : value
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value) ?? ''
  } catch {
    serialized = String(value)
  }
  if (serialized.length > MAX_PERSISTED_TOOL_RESULT_CHARS) {
    return serialized.slice(0, MAX_PERSISTED_TOOL_RESULT_CHARS) + TOOL_RESULT_TRUNCATION_SUFFIX
  }
  return value
}

function serializeMessageForTranscript(message: ConversationMessage): ConversationMessage & { kind: 'message' } {
  const { metadata, ...rest } = message
  const persistedMetadata = metadata
    ? {
        toolCallId: metadata.toolCallId,
        toolName: metadata.toolName,
        toolArgs: metadata.toolArgs,
        toolResult: capToolResultForPersistence(metadata.toolResult),
        toolStatus: metadata.toolStatus,
        toolArtifactPath: metadata.toolArtifactPath,
        reasoningStartedAt: metadata.reasoningStartedAt,
        reasoningFinishedAt: metadata.reasoningFinishedAt,
        reasoningDurationMs: metadata.reasoningDurationMs,
        reasoningText: metadata.reasoningText,
        memoryContext: metadata.memoryContext,
        compactionSummary: metadata.compactionSummary,
      }
    : undefined

  return {
    kind: 'message',
    ...rest,
    ...(persistedMetadata && Object.values(persistedMetadata).some((value) => value !== undefined)
      ? { metadata: persistedMetadata }
      : {}),
  }
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
      await appendJsonlEntry(this.currentTranscriptPath, serializeMessageForTranscript(message))
    }
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    await this.pushMessage(message)
  }

  async appendMessages(messages: readonly ConversationMessage[]): Promise<void> {
    if (messages.length === 0) {
      return
    }

    this.initialized = true
    this.messages = [...this.messages, ...messages]
    this.refreshSnapshot()
    await this.persistMessages(messages)
  }

  async persistMessages(messages: readonly ConversationMessage[]): Promise<void> {
    if (messages.length === 0) {
      return
    }

    await this.ensureReady()
    await appendJsonlEntries(
      this.currentTranscriptPath,
      messages.map(serializeMessageForTranscript),
    )
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
    const entries = await readRawJsonlEntries<ConversationMessage & { kind?: string }>(this.currentTranscriptPath)
    // Older transcripts may contain 'turn' records from a removed API surface.
    return entries.filter((entry) => entry.kind !== 'turn') as ConversationMessage[]
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
      messages.map(serializeMessageForTranscript),
    )
  }
}

export function createConversationStore(options: ConversationStoreOptions = {}): ConversationStore {
  return new ConversationStore(options)
}
