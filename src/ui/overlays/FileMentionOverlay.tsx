import { TextAttributes } from '@opentui/core'
import { theme } from '../theme'
import { getCompletionWindow } from './completion-window'

/** Rows of results rendered at once; the list scrolls to keep the selection visible. */
const maxVisibleRows = 12

export interface FileMentionOverlayProps {
  isOpen: boolean
  query: string
  selectedIndex: number
  results: string[]
}

export function FileMentionOverlay({
  isOpen,
  query,
  selectedIndex,
  results,
}: FileMentionOverlayProps) {
  if (!isOpen || results.length === 0) return null

  const window = getCompletionWindow(results, selectedIndex, maxVisibleRows)
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
          <span fg={theme.headerAccent} attributes={TextAttributes.DIM}>{`@${query}`}</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` — ${results.length} files${positionLabel}`}</span>
          {window.hiddenAbove > 0 ? (
            <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{`  ↑ ${window.hiddenAbove} more`}</span>
          ) : null}
        </text>
      </box>
      {window.items.map((filePath, offset) => {
        const isSelected = window.start + offset === selectedIndex
        return (
          <box
            key={filePath}
            paddingX={1}
            backgroundColor={isSelected ? theme.headerAccent : theme.panel}
          >
            <text
              fg={isSelected ? '#000000' : theme.assistantFg}
              attributes={isSelected ? TextAttributes.BOLD : undefined}
              content={filePath}
            />
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
