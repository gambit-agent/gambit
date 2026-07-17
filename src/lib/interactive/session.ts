import type { UIMessage } from "../../types/chat"

export type PermissionMode = "Normal" | "Plan" | "Auto-accept"

type Snapshot = {
  messages: UIMessage[]
}

const cloneMessages = (messages: UIMessage[]): UIMessage[] => {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(messages)
    }
  } catch (error) {
    // fall back to JSON clone below
  }
  return JSON.parse(JSON.stringify(messages)) as UIMessage[]
}

const MAX_SNAPSHOTS = 5
const MAX_SNAPSHOT_CHARS = 500_000

function compactSnapshotMessages(messages: UIMessage[]): UIMessage[] | null {
  const compacted = messages.map((message) => ({
    ...message,
    metadata: message.metadata
      ? {
          toolCallId: message.metadata.toolCallId,
          toolName: message.metadata.toolName,
        }
      : undefined,
  }))

  if (JSON.stringify(compacted).length > MAX_SNAPSHOT_CHARS) {
    return null
  }
  return compacted
}

export class InteractiveSession {
  private thinking = false
  private permissionMode: PermissionMode = "Normal"
  private abortController: AbortController | null = null
  private readonly snapshots: Snapshot[] = []
  private readonly maxSnapshots = MAX_SNAPSHOTS

  get isThinkingEnabled(): boolean {
    return this.thinking
  }

  toggleThinking(): boolean {
    this.thinking = !this.thinking
    return this.thinking
  }

  get currentPermissionMode(): PermissionMode {
    return this.permissionMode
  }

  cyclePermissionMode(): PermissionMode {
    const next: Record<PermissionMode, PermissionMode> = {
      Normal: "Plan",
      Plan: "Auto-accept",
      "Auto-accept": "Normal",
    }
    this.permissionMode = next[this.permissionMode]
    return this.permissionMode
  }

  startRun(): AbortSignal {
    this.abortController?.abort()
    this.abortController = new AbortController()
    return this.abortController.signal
  }

  abortRun(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  clearRun(): void {
    this.abortController = null
  }

  pushSnapshot(messages: UIMessage[]): void {
    try {
      const compacted = compactSnapshotMessages(messages)
      if (!compacted) {
        return
      }
      this.snapshots.push({ messages: cloneMessages(compacted) })
      while (this.snapshots.length > this.maxSnapshots) {
        this.snapshots.shift()
      }
    } catch {
      // best-effort snapshot; ignore failures
    }
  }

  popSnapshot(): UIMessage[] | null {
    if (!this.snapshots.length) {
      return null
    }
    const snapshot = this.snapshots.pop()
    if (!snapshot) {
      return null
    }
    try {
      return cloneMessages(snapshot.messages)
    } catch {
      return snapshot.messages.map((message) => ({ ...message }))
    }
  }
}
