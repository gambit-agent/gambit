import { generateId } from '../lib/id'
import { ConversationStore } from './conversation-store'

const STREAM_FLUSH_INTERVAL_MS = 100
const STREAM_FLUSH_CHAR_DELTA = 512

export class AssistantMessageBuilder {
  private streamedText = ''
  private reasoning = ''
  private reasoningStartedAt: Date | null = null
  private reasoningFinishedAt: Date | null = null
  private currentAssistantId: string | null = null
  private currentText = ''
  private currentReasoning = ''
  private segmentAdded = false
  private lastFlushedContent = ''
  private lastFlushAt = 0
  private readonly turnAssistantIds = new Set<string>()

  constructor(
    private readonly store: ConversationStore,
    private readonly showReasoning: boolean,
  ) {}

  get streamedTextLength(): number {
    return this.streamedText.length
  }

  async appendReasoning(text: string): Promise<void> {
    this.markReasoningStarted()
    this.reasoning += text
    this.currentReasoning += text
    if (this.showReasoning && this.currentReasoning.trim()) {
      await this.flushCurrentAssistantMessage()
    }
  }

  async appendText(text: string): Promise<void> {
    this.markReasoningFinished()
    this.streamedText += text
    this.currentText += text
    await this.flushCurrentAssistantMessage()
  }

  async startNextSegment(): Promise<void> {
    await this.flushCurrentAssistantMessage({ force: true })
    this.currentAssistantId = null
    this.currentText = ''
    this.currentReasoning = ''
    this.segmentAdded = false
    this.lastFlushedContent = ''
    this.lastFlushAt = 0
  }

  async finish(finalText: string): Promise<string> {
    this.markReasoningFinished()
    const finalContent = this.composeContent(this.reasoning, finalText)

    if (!this.streamedText.trim() && finalText) {
      this.currentText = finalText
      await this.flushCurrentAssistantMessage({ force: true })
    } else {
      await this.flushCurrentAssistantMessage({ force: true })
    }

    if (this.turnAssistantIds.size === 0 && finalContent) {
      const assistantId = generateId()
      this.turnAssistantIds.add(assistantId)
      await this.store.pushMessage(
        {
          id: assistantId,
          role: 'assistant',
          content: finalContent,
          timestamp: new Date().toISOString(),
          metadata: this.buildReasoningMetadata(),
        },
        { persist: false },
      )
    }

    return finalContent
  }

  removeTurnMessages(): void {
    for (const assistantId of this.turnAssistantIds) {
      this.store.removeMessage(assistantId)
    }
  }

  private composeContent(reasoning: string, text: string): string {
    if (!this.showReasoning || !reasoning.trim()) {
      return text
    }
    return `Reasoning:\n${reasoning.trim()}\n\n${text}`
  }

  private markReasoningStarted(): void {
    if (!this.reasoningStartedAt) {
      this.reasoningStartedAt = new Date()
    }
  }

  private markReasoningFinished(): void {
    if (this.reasoningStartedAt && !this.reasoningFinishedAt) {
      this.reasoningFinishedAt = new Date()
    }
  }

  private buildReasoningMetadata(): {
    reasoningStartedAt?: string
    reasoningFinishedAt?: string
    reasoningDurationMs?: number
  } | undefined {
    if (!this.showReasoning || !this.reasoningStartedAt) {
      return undefined
    }

    const finishedAt = this.reasoningFinishedAt ?? new Date()
    return {
      reasoningStartedAt: this.reasoningStartedAt.toISOString(),
      reasoningFinishedAt: this.reasoningFinishedAt?.toISOString(),
      reasoningDurationMs: Math.max(0, finishedAt.getTime() - this.reasoningStartedAt.getTime()),
    }
  }

  private composeCurrentContent(): string {
    return this.composeContent(this.currentReasoning, this.currentText)
  }

  private async flushCurrentAssistantMessage(options: { force?: boolean } = {}): Promise<void> {
    const content = this.composeCurrentContent()
    if (!content.trim()) {
      return
    }
    if (!options.force && !this.shouldFlush(content)) {
      return
    }

    if (!this.currentAssistantId) {
      this.currentAssistantId = generateId()
    }

    if (!this.segmentAdded) {
      this.segmentAdded = true
      this.turnAssistantIds.add(this.currentAssistantId)
      await this.store.pushMessage(
        {
          id: this.currentAssistantId,
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
          metadata: this.buildReasoningMetadata(),
        },
        { persist: false },
      )
      this.lastFlushedContent = content
      this.lastFlushAt = Date.now()
      return
    }

    this.store.updateMessage(this.currentAssistantId, {
      content,
      metadata: this.buildReasoningMetadata(),
    })
    this.lastFlushedContent = content
    this.lastFlushAt = Date.now()
  }

  private shouldFlush(content: string): boolean {
    if (!this.segmentAdded) {
      return true
    }
    if (content.length - this.lastFlushedContent.length >= STREAM_FLUSH_CHAR_DELTA) {
      return true
    }
    return Date.now() - this.lastFlushAt >= STREAM_FLUSH_INTERVAL_MS
  }
}
