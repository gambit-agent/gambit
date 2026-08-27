import type { ImageAttachment } from '../lib/image-attachments'

/**
 * A pending composer entry that may be handed to an already-running turn
 * instead of waiting for it to finish. Structurally a subset of the REPL's
 * `QueuedPrompt`, so the follow-up queue can back the steering source without
 * a second queue to keep in sync.
 */
export interface SteerableEntry {
  value: string
  attachments?: readonly ImageAttachment[]
}

/**
 * Entries carrying image attachments are not steerable: injection appends
 * plain text to the running message array, so steering one would silently drop
 * its images. Those entries stay queued and start their own turn instead.
 */
export function isSteerable(entry: SteerableEntry): boolean {
  return entry.value.trim().length > 0 && !(entry.attachments && entry.attachments.length > 0)
}

/**
 * How many entries at the head of the queue can be steered. Counting stops at
 * the first entry that cannot be, because skipping over it to steer a later
 * one would deliver the user's messages out of order.
 */
export function countSteerableEntries(entries: readonly SteerableEntry[]): number {
  let count = 0
  for (const entry of entries) {
    if (!isSteerable(entry)) {
      break
    }
    count += 1
  }
  return count
}

/** Produces text typed since the last pull, oldest first. */
export type SteeringSource = () => string[]

/**
 * Connects the interactive composer (producer) to whatever turn is currently
 * running (consumer).
 *
 * The REPL registers a source backed by its follow-up queue; the model stream
 * runner pulls from it at every step boundary. Contexts with no interactive
 * composer — headless runs, ACP sessions, delegated sub-agents — simply never
 * register one, and `pull` returning empty disables steering with no branching
 * at the call sites.
 */
export class SteeringBridge {
  private source: SteeringSource | null = null

  setSource(source: SteeringSource | null): void {
    this.source = source
  }

  get isConnected(): boolean {
    return this.source !== null
  }

  pull(): string[] {
    if (!this.source) {
      return []
    }
    try {
      return this.source()
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    } catch {
      // A broken producer must never take down a running turn.
      return []
    }
  }
}
