import { TextAttributes } from '@opentui/core'

import { layout, theme } from '../../ui/theme'

export interface ReplNoticesProps {
  error: string | null
  historySearch: {
    active: boolean
    query: string
    match: string | null
  }
  exitPending: boolean
  transcriptMode: boolean
  sessionInitializing: boolean
}

export function ReplNotices({
  error,
  historySearch,
  exitPending,
  transcriptMode,
  sessionInitializing,
}: ReplNoticesProps) {
  return (
    <>
      {error ? (
        <box
          style={{
            border: ['left'],
            paddingTop: layout.panelPaddingY,
            paddingRight: layout.panelPaddingX,
            paddingBottom: layout.panelPaddingY,
            paddingLeft: layout.panelPaddingX,
            backgroundColor: theme.systemBg,
          }}
        >
          <text fg={theme.errorFg} content={`Error: ${error}`} />
          <box marginTop={1}>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Press Esc to dismiss" />
          </box>
        </box>
      ) : null}

      {historySearch.active ? (
        <box flexDirection="column" paddingY={1} paddingX={layout.panelPaddingX}>
          <text
            fg={theme.headerAccent}
            attributes={TextAttributes.BOLD}
            content={`reverse-search: ${historySearch.query || '...'}${historySearch.match ? ` -> ${historySearch.match}` : ''}`}
          />
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content="Esc to cancel, Ctrl+R to search older matches"
          />
        </box>
      ) : null}

      {exitPending ? (
        <box paddingY={0} paddingX={layout.panelPaddingX}>
          <text fg={theme.errorFg} attributes={TextAttributes.BOLD} content="Press again to exit." />
        </box>
      ) : null}

      {transcriptMode ? (
        <box paddingY={0} paddingX={layout.panelPaddingX}>
          <text fg={theme.headerAccent} attributes={TextAttributes.DIM} content="Transcript mode - press q, Esc, or Ctrl+C to exit" />
        </box>
      ) : null}

      {sessionInitializing ? (
        <box paddingY={1} paddingX={layout.panelPaddingX}>
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content="Preparing conversation session..."
          />
        </box>
      ) : null}
    </>
  )
}
