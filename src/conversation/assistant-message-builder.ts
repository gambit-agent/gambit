import { generateId } from '../lib/id'
import { ConversationStore } from './conversation-store'

export class AssistantMessageBuilder {
  private streamedText = ''
  private reasoning = ''
  private currentAssistantId: string | null = null
  private currentText = ''
  private currentReasoning = ''
  private segmentAdded = false
  private readonly turnAssistantIds = new Set<string>()

  constructor(
    private readonly store: ConversationStore,
    private readonly showReasoning: boolean,
  ) {}

  get streamedTextLength(): number {
    return this.streamedText.length
  }

  async appendReasoning(text: string): Promise<void> {
    this.reasoning += text
    this.currentReasoning += text
    if (this.showReasoning && this.currentReasoning.trim()) {
      await this.updateCurrentAssistantMessage()
    }
  }

  async appendText(text: string): Promise<void> {
    this.streamedText += text
    this.currentText += text
    await this.updateCurrentAssistantMessage()
  }

  startNextSegment(): void {
    this.currentAssistantId = null
    this.currentText = ''
    this.currentReasoning = ''
    this.segmentAdded = false
  }

  async finish(finalText: string): Promise<string> {
    const finalContent = this.composeContent(this.reasoning, finalText)

    if (!this.streamedText.trim() && finalText) {
      this.currentText = finalText
      await this.updateCurrentAssistantMessage()
    }

    if (this.turnAssistantIds.size === 0 && finalContent) {
      const assistantId = generateId()
      this.turnAssistantIds.add(assistantId)
      await this.store.pushMessage({
        id: assistantId,
        role: 'assistant',
        content: finalContent,
        timestamp: new Date().toISOString(),
      })
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

  private composeCurrentContent(): string {
    return this.composeContent(this.currentReasoning, this.currentText)
  }

  private async updateCurrentAssistantMessage(): Promise<void> {
    const content = this.composeCurrentContent()
    if (!content.trim()) {
      return
    }

    if (!this.currentAssistantId) {
      this.currentAssistantId = generateId()
    }

    if (!this.segmentAdded) {
      this.segmentAdded = true
      this.turnAssistantIds.add(this.currentAssistantId)
      await this.store.pushMessage(
        { id: this.currentAssistantId, role: 'assistant', content, timestamp: new Date().toISOString() },
        { persist: false },
      )
      return
    }

    this.store.updateMessage(this.currentAssistantId, { content })
  }
}
