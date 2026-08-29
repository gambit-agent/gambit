export const LARGE_PASTE_MIN_LINES = 10
export const LARGE_PASTE_MIN_CHARACTERS = 1_000

export interface PastedTextStats {
  characterCount: number
  lineCount: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function getPastedTextStats(value: string): PastedTextStats {
  return {
    characterCount: Array.from(value).length,
    lineCount: value.length === 0 ? 0 : value.split('\n').length,
  }
}

export function shouldCollapsePastedText(value: string): boolean {
  const { characterCount, lineCount } = getPastedTextStats(value)
  return lineCount >= LARGE_PASTE_MIN_LINES || characterCount >= LARGE_PASTE_MIN_CHARACTERS
}

/**
 * The pasted blobs backing one composer draft.
 *
 * A large paste is shown as a short `[Pasted text #N +…]` label so it does not
 * bury the prompt; the draft keeps the source text so submission, history and
 * the follow-up queue all see what was actually pasted. A label is only ever
 * expanded while it survives verbatim in the composer — editing or deleting it
 * drops the entry, so the label the user is left looking at is the prompt.
 */
export class PastedTextDraft {
  /** Display label -> the source text it stands in for. */
  private entries = new Map<string, string>()
  private nextId = 1

  /** Returns the label to display, or the value unchanged when it is small. */
  collapse(value: string): string {
    if (!shouldCollapsePastedText(value)) {
      return value
    }

    const id = this.nextId
    this.nextId += 1
    const stats = getPastedTextStats(value)
    const amount = stats.lineCount > 1
      ? `${stats.lineCount} lines`
      : `${stats.characterCount} chars`
    const label = `[Pasted text #${id} +${amount}]`
    this.entries.set(label, value)
    return label
  }

  /** Expands every surviving label in the composer back to its source text. */
  materialize(displayValue: string): string {
    this.sync(displayValue)
    if (this.entries.size === 0) {
      return displayValue
    }

    // One pass over all labels at once: expanded text that happens to contain
    // another label must be left alone rather than expanded again.
    const labels = [...this.entries.keys()].map(escapeRegExp).join('|')
    return displayValue.replace(new RegExp(labels, 'g'), (label) => this.entries.get(label) ?? label)
  }

  /** Drops entries whose label no longer appears verbatim in the composer. */
  sync(displayValue: string): void {
    for (const label of this.entries.keys()) {
      if (!displayValue.includes(label)) {
        this.entries.delete(label)
      }
    }
    if (displayValue.length === 0) {
      // The composer is empty, so the next draft starts numbering at #1.
      this.nextId = 1
    }
  }

  /** Discards the draft; used when the composer is replaced wholesale. */
  reset(): void {
    this.entries.clear()
    this.nextId = 1
  }
}
