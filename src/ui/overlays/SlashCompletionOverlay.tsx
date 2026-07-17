import { TextAttributes } from '@opentui/core'

import type { SlashCompletionMatch, SlashCompletionMode } from '../../repl/slash-completions'
import { theme } from '../theme'

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

  const visibleResults = results.slice(0, 20)
  const queryLabel = mode === 'skill' ? `/skill ${query}` : `/${query}`
  const countLabel = mode === 'skill' ? 'skills' : 'commands'

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
          <span fg={theme.headerAccent} attributes={TextAttributes.DIM}>{queryLabel}</span>
          <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` — ${results.length} ${countLabel}`}</span>
        </text>
      </box>
      {visibleResults.map((match, index) => {
        const isSelected = index === selectedIndex
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
    </box>
  )
}
