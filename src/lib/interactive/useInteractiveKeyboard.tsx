import type { KeyEvent, ParsedKey } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useCallback } from 'react'

interface HistorySearchState {
  active: boolean
  query: string
  match: string | null
}

const isPrintableKey = (key: ParsedKey): boolean => {
  if (key.ctrl || key.meta) {
    return false
  }
  if (key.sequence.length === 0) {
    return false
  }
  // Accept multi-character sequences (IME composition, multi-byte input) as
  // long as they contain no control characters.
  for (const character of key.sequence) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 32 || codePoint === 127) {
      return false
    }
  }
  return true
}

export function useInteractiveKeyboard({
  historySearch,
  handleEscape,
  handleShortcut,
  updateHistorySearch,
  exitHistorySearch,
  enabled = true,
  completionNavigationActive = false,
}: {
  historySearch: HistorySearchState
  handleEscape: () => void
  handleShortcut: (key: ParsedKey) => boolean
  updateHistorySearch: (query: string, advanced?: boolean) => void
  exitHistorySearch: () => void
  enabled?: boolean
  completionNavigationActive?: boolean
}) {
  useKeyboard(
    useCallback(
      (key: KeyEvent) => {
        if (!enabled) {
          return
        }

        if (completionNavigationActive && isCompletionNavigationKey(key)) {
          return
        }

        if (key.name === 'escape') {
          handleEscape()
          return
        }

        if (historySearch.active) {
          if (key.name === 'backspace') {
            updateHistorySearch(historySearch.query.slice(0, -1))
            return
          }

          if (key.name === 'r' && key.ctrl) {
            updateHistorySearch(historySearch.query, true)
            return
          }

          if (key.name === 'return' || key.name === 'enter') {
            exitHistorySearch()
            return
          }

          if (key.name === 'c' && key.ctrl) {
            exitHistorySearch()
            return
          }

          if (isPrintableKey(key)) {
            updateHistorySearch(historySearch.query + key.sequence)
            return
          }
        }

        // Honor the shortcut contract: when a shortcut handled the key,
        // prevent the focused renderable (the composer textarea) from also
        // processing it.
        if (handleShortcut(key)) {
          key.preventDefault()
        }
      },
      [
        completionNavigationActive,
        enabled,
        exitHistorySearch,
        handleEscape,
        handleShortcut,
        historySearch,
        updateHistorySearch,
      ],
    ),
  )
}

function isCompletionNavigationKey(key: ParsedKey): boolean {
  return key.name === 'escape' ||
    key.name === 'up' ||
    key.name === 'down' ||
    key.name === 'tab' ||
    key.name === 'backtab'
}
