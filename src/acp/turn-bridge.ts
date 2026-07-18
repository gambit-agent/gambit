import type { SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk'

import type { ConversationStore } from '../conversation/conversation-store'
import type { ConversationMessage } from '../conversation/conversation-types'
import {
  capSerializedValue,
  getToolContent,
  getToolKind,
  getToolLocations,
  getToolStatus,
} from './protocol-mapper'

export type AcpSessionNotifier = (notification: SessionNotification) => Promise<void>

/** Bridges Gambit's observable transcript to ordered ACP session updates. */
export class AcpTurnBridge {
  private readonly initialMessageIds: Set<string>
  private readonly assistantLengths = new Map<string, number>()
  private readonly toolSignatures = new Map<string, string>()
  private notificationQueue: Promise<void> = Promise.resolve()
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly store: ConversationStore,
    private readonly sessionId: string,
    private readonly cwd: string,
    private readonly notify: AcpSessionNotifier,
  ) {
    this.initialMessageIds = new Set(store.getSnapshot().messages.map((message) => message.id))
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.store.subscribe(() => this.capture())
  }

  async flush(): Promise<void> {
    this.capture()
    await this.notificationQueue
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private capture(): void {
    for (const message of this.store.getSnapshot().messages) {
      if (this.initialMessageIds.has(message.id) || message.hidden) continue
      if (message.role === 'assistant') {
        this.captureAssistant(message)
      } else if (message.role === 'tool') {
        this.captureTool(message)
      }
    }
  }

  private captureAssistant(message: ConversationMessage): void {
    const priorLength = this.assistantLengths.get(message.id) ?? 0
    if (message.content.length <= priorLength) return

    const text = message.content.slice(priorLength)
    this.assistantLengths.set(message.id, message.content.length)
    this.enqueue({
      sessionUpdate: 'agent_message_chunk',
      messageId: message.id,
      content: { type: 'text', text },
    })
  }

  private captureTool(message: ConversationMessage): void {
    const toolCallId = message.metadata?.toolCallId ?? message.id
    const toolName = message.metadata?.toolName ?? 'tool'
    const signature = JSON.stringify([
      message.metadata?.toolStatus,
      message.content,
      message.metadata?.toolResult,
    ])
    const previousSignature = this.toolSignatures.get(toolCallId)
    if (signature === previousSignature) return
    this.toolSignatures.set(toolCallId, signature)

    if (previousSignature === undefined) {
      this.enqueue({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: toolName,
        kind: getToolKind(toolName),
        status: getToolStatus(message.metadata?.toolStatus),
        rawInput: message.metadata?.toolArgs,
        locations: getToolLocations(message.metadata?.toolArgs, this.cwd),
      })
      if (message.metadata?.toolStatus === 'started') return
    }

    this.enqueue({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: getToolStatus(message.metadata?.toolStatus),
      content: getToolContent(message),
      rawOutput: message.metadata?.toolResult === undefined
        ? undefined
        : capSerializedValue(message.metadata.toolResult),
    })
  }

  private enqueue(update: SessionUpdate): void {
    this.notificationQueue = this.notificationQueue.then(() => this.notify({
      sessionId: this.sessionId,
      update,
    }))
  }
}
