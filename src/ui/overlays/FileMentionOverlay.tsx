import { TextAttributes } from '@opentui/core'
import { theme } from '../theme'

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

  const visibleResults = results.slice(0, 20)

  return (
    <box
      flexDirection="column"
      style={{
        backgroundColor: theme.panel,
        maxHeight: 18,
      }}
    >
      <box paddingX={1} paddingY={0} backgroundColor={theme.panel}>
        <text>
          <span fg={theme.headerAccent} attributes={TextAttributes.DIM}>{`@${query}`}</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` — ${results.length} files`}</span>
        </text>
      </box>
      {visibleResults.map((filePath, index) => {
        const isSelected = index === selectedIndex
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
    </box>
  )
}
