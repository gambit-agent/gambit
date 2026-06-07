import type { ParsedKey } from '@opentui/core'
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
  return key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32
}

export function useInteractiveKeyboard({
  historySearch,
  handleEscape,
  handleShortcut,
  updateHistorySearch,
  exitHistorySearch,
}: {
  historySearch: HistorySearchState
  handleEscape: () => void
  handleShortcut: (key: ParsedKey) => boolean
  updateHistorySearch: (query: string, advanced?: boolean) => void
  exitHistorySearch: () => void
}) {
  useKeyboard(
    useCallback(
      (key: ParsedKey) => {
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

        handleShortcut(key)
      },
      [exitHistorySearch, handleEscape, handleShortcut, historySearch, updateHistorySearch],
    ),
  )
}
