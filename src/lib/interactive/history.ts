import { generateId } from "../id"

import {
  appendSessionEntry,
  getCurrentSession,
  loadUserHistoryEntries,
  type SessionHistoryEntry,
} from "./sessionHistory"

const MAX_HISTORY_ENTRIES = 1000

export interface HistoryMatch {
  value: string
  index: number
}

export class InteractiveHistory {
  private items: string[]
  private cursor: number | null
  private pendingEntries: SessionHistoryEntry[]

  constructor(entries: string[]) {
    this.items = [...entries]
    this.cursor = null
    this.pendingEntries = []
  }

  static async load(): Promise<InteractiveHistory> {
    try {
      await getCurrentSession()
      const entries = await loadUserHistoryEntries(MAX_HISTORY_ENTRIES)
      return new InteractiveHistory(entries)
    } catch {
      return new InteractiveHistory([])
    }
  }

  async persist(): Promise<void> {
    if (!this.pendingEntries.length) {
      return
    }

    const entriesToWrite = [...this.pendingEntries]
    this.pendingEntries = []

    try {
      for (const entry of entriesToWrite) {
        await appendSessionEntry(entry)
      }
    } catch (error) {
      this.pendingEntries = [...entriesToWrite, ...this.pendingEntries]
      throw error
    }
  }

  add(entry: string): void {
    const trimmed = entry.trim()
    if (!trimmed) {
      return
    }
    const last = this.items[this.items.length - 1]
    if (last === trimmed) {
      return
    }
    this.items.push(trimmed)
    this.pendingEntries.push({
      id: generateId(),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    })
    this.cursor = null
  }

  clearCursor(): void {
    this.cursor = null
  }

  /** True while arrow navigation is walking history entries. */
  get isNavigating(): boolean {
    return this.cursor !== null
  }

  // Slash commands are skipped during arrow navigation: recalling one opens the
  // slash-completion overlay, which captures up/down and strands the user
  // mid-history. They stay in `items` so ctrl+r search can still find them.
  private isNavigable(value: string | undefined): value is string {
    return value !== undefined && !value.startsWith("/")
  }

  previous(): string | null {
    const start = this.cursor === null ? this.items.length - 1 : this.cursor - 1
    for (let index = start; index >= 0; index -= 1) {
      if (this.isNavigable(this.items[index])) {
        this.cursor = index
        return this.items[index] ?? null
      }
    }
    if (this.cursor !== null && this.isNavigable(this.items[this.cursor])) {
      return this.items[this.cursor] ?? null
    }
    return null
  }

  next(): string | null {
    if (this.cursor === null) {
      return null
    }
    for (let index = this.cursor + 1; index < this.items.length; index += 1) {
      if (this.isNavigable(this.items[index])) {
        this.cursor = index
        return this.items[index] ?? null
      }
    }
    this.cursor = null
    return ""
  }

  findLatestMatch(query: string, fromIndex: number = this.items.length - 1): HistoryMatch | null {
    if (!query) {
      return null
    }
    const lower = query.toLowerCase()
    for (let index = Math.min(fromIndex, this.items.length - 1); index >= 0; index -= 1) {
      const value = this.items[index]
      if (value !== undefined && value.toLowerCase().includes(lower)) {
        return { value, index }
      }
    }
    return null
  }

  get size(): number {
    return this.items.length
  }

  get all(): string[] {
    return [...this.items]
  }
}
