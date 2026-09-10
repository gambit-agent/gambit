import { TextAttributes } from '@opentui/core'

import type { SlashCompletionMatch, SlashCompletionMode } from '../../repl/slash-completions'
import { theme } from '../theme'
import { getCompletionWindow } from './completion-window'

/** Rows of results rendered at once; the list scrolls to keep the selection visible. */
const maxVisibleRows = 12

export interface SlashCompletionOverlayProps {
  isOpen: boolean
  query: string
  mode: SlashCompletionMode
  selectedIndex: number
  results: SlashCompletionMatch[]
}

export function SlashCompletionOverlay({
  isOpen,
  query,
  mode,
  selectedIndex,
  results,
}: SlashCompletionOverlayProps) {
  if (!isOpen || results.length === 0) return null

  const window = getCompletionWindow(results, selectedIndex, maxVisibleRows)
  const queryLabel = mode === 'skill' ? `/skill ${query}` : `/${query}`
  const countLabel = mode === 'skill' ? 'skills' : 'commands'
  const positionLabel = results.length > maxVisibleRows
    ? ` · ${Math.min(selectedIndex, results.length - 1) + 1}/${results.length}`
    : ''

  return (
    <box
      flexDirection="column"
      style={{
        backgroundColor: theme.panel,
      }}
    >
      <box paddingX={1} paddingY={0} backgroundColor={theme.panel}>
        <text>
          <span fg={theme.headerAccent} attributes={TextAttributes.DIM}>{queryLabel}</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` — ${results.length} ${countLabel}${positionLabel}`}</span>
          {window.hiddenAbove > 0 ? (
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{`  ↑ ${window.hiddenAbove} more`}</span>
          ) : null}
        </text>
      </box>
      {window.items.map((match, offset) => {
        const isSelected = window.start + offset === selectedIndex
        return (
          <box
            key={match.key}
            paddingX={1}
            backgroundColor={isSelected ? theme.headerAccent : theme.panel}
          >
            <text>
              <span
                fg={isSelected ? '#000000' : theme.assistantFg}
                attributes={isSelected ? TextAttributes.BOLD : undefined}
              >
                {match.label}
              </span>
              {isSelected ? (
                <span fg="#000000">
                  {`  ${match.kind} · ${match.description}`}
                </span>
              ) : null}
            </text>
          </box>
        )
      })}
      {window.hiddenBelow > 0 ? (
        <box paddingX={1} backgroundColor={theme.panel}>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`↓ ${window.hiddenBelow} more`} />
        </box>
      ) : null}
    </box>
  )
}
