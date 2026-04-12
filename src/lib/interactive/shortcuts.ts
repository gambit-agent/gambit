import type { ParsedKey } from "@opentui/core"

export type ShortcutAction =
  | "abort-run"
  | "exit-session"
  | "clear-screen"
  | "history-search"
  | "history-previous"
  | "history-next"
  | "toggle-thinking"
  | "cycle-permission"
  | "newline"
  | "follow-up"
  | "background"
  | "toggle-transcript"
  | "scroll-page-up"
  | "scroll-page-down"
  | "scroll-top"
  | "scroll-bottom"
  | "permission-explain"
  | "stash-prompt"

export interface ShortcutMatch {
  action: ShortcutAction
  preventDefault?: boolean
}

export function matchShortcut(key: ParsedKey): ShortcutMatch | null {
  if (key.eventType === "release") {
    return null
  }

  switch (key.name) {
    case "c": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "abort-run", preventDefault: true }
      }
      break
    }
    case "d": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "exit-session", preventDefault: true }
      }
      break
    }
    case "l": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "clear-screen", preventDefault: true }
      }
      break
    }
    case "r": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "history-search", preventDefault: true }
      }
      break
    }
    case "up": {
      if (!key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "history-previous", preventDefault: true }
      }
      break
    }
    case "down": {
      if (!key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "history-next", preventDefault: true }
      }
      break
    }
    case "tab":
    case "backtab": {
      const isShiftTab =
        key.shift ||
        key.name === "backtab" ||
        /^\u001b\[[0-9;]*Z$/.test(key.sequence)

      if (isShiftTab && !key.ctrl && !key.meta && !key.option) {
        return { action: "cycle-permission", preventDefault: true }
      }
      if (!isShiftTab && !key.ctrl && !key.meta && !key.option) {
        return { action: "toggle-thinking", preventDefault: true }
      }
      break
    }
    case "b": {
      if (key.ctrl && !key.meta && !key.shift) {
        return { action: "background", preventDefault: true }
      }
      break
    }
    case "return":
    case "enter": {
      if (key.option && !key.ctrl && !key.meta && !key.shift) {
        return { action: "follow-up", preventDefault: true }
      }
      if (key.ctrl || key.meta || key.shift) {
        return { action: "newline", preventDefault: true }
      }
      break
    }
    case "j": {
      if (key.ctrl && !key.meta && !key.shift) {
        return { action: "newline", preventDefault: true }
      }
      break
    }
    case "o": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "toggle-transcript", preventDefault: true }
      }
      break
    }
    case "pageup": {
      if (!key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "scroll-page-up", preventDefault: true }
      }
      break
    }
    case "pagedown": {
      if (!key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "scroll-page-down", preventDefault: true }
      }
      break
    }
    case "home": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "scroll-top", preventDefault: true }
      }
      break
    }
    case "end": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "scroll-bottom", preventDefault: true }
      }
      break
    }
    case "e": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "permission-explain", preventDefault: true }
      }
      break
    }
    case "s": {
      if (key.ctrl && !key.meta && !key.shift && !key.option) {
        return { action: "stash-prompt", preventDefault: true }
      }
      break
    }
    default:
      break
  }

  return null
}

const DOUBLE_PRESS_TIMEOUT_MS = 800

export class DoublePressDetector {
  private lastTimestamp: number | null = null
  private readonly intervalMs: number

  constructor(intervalMs: number = DOUBLE_PRESS_TIMEOUT_MS) {
    this.intervalMs = intervalMs
  }

  press(): "first" | "second" {
    const now = Date.now()
    if (this.lastTimestamp && now - this.lastTimestamp <= this.intervalMs) {
      this.lastTimestamp = null
      return "second"
    }
    this.lastTimestamp = now
    return "first"
  }

  reset(): void {
    this.lastTimestamp = null
  }
}
