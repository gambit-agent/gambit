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
        border: ['top', 'bottom', 'left', 'right'],
        borderStyle: 'single',
        borderColor: theme.border,
        backgroundColor: theme.panel,
        maxHeight: 18,
      }}
    >
      <box paddingX={1} paddingY={0}>
        <text fg={theme.headerAccent} attributes={TextAttributes.DIM} content={`@${query}`} />
        <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={` — ${results.length} files`} />
      </box>
      {visibleResults.map((filePath, index) => {
        const isSelected = index === selectedIndex
        return (
          <box
            key={filePath}
            paddingX={1}
            backgroundColor={isSelected ? theme.selectedBg : undefined}
          >
            <text
              fg={isSelected ? theme.selectedFg : theme.statusFg}
              attributes={isSelected ? TextAttributes.BOLD : TextAttributes.DIM}
              content={filePath}
            />
          </box>
        )
      })}
    </box>
  )
}

