import { TextAttributes } from '@opentui/core'

import type { PermissionRequestRecord } from '../../permissions/permission-types'
import { theme } from '../theme'

export interface PermissionOverlayProps {
  request: PermissionRequestRecord
  showExplanation?: boolean
}

export function PermissionOverlay({ request, showExplanation = false }: PermissionOverlayProps) {
  const explanationParts: string[] = []
  if (showExplanation && request.metadata) {
    for (const [key, value] of Object.entries(request.metadata)) {
      if (key === 'isPlanApproval') continue
      if (value !== undefined && value !== null) {
        const display = typeof value === 'string' ? value : JSON.stringify(value)
        explanationParts.push(`${key}: ${display}`)
      }
    }
  }

  return (
    <box
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 90,
      }}
    >
      <box
        flexDirection="column"
        gap={1}
        style={{
          border: ['left'],
          borderStyle: 'heavy',
          borderColor: theme.inputBorder,
          paddingLeft: 2,
          paddingRight: 2,
          backgroundColor: theme.header,
          minWidth: 60,
          maxWidth: 90,
        }}
      >
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Permission Required" />
        <text fg={theme.userFg} content={request.subject} />
        {showExplanation && explanationParts.length > 0 ? (
          <box flexDirection="column" gap={0}>
            {explanationParts.map((part, i) => (
              <text key={i} fg={theme.statusFg} content={part} />
            ))}
          </box>
        ) : null}
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content="Y/Enter to allow · N/Esc to deny · Shift+Tab to change mode · Ctrl+E for details"
        />
      </box>
    </box>
  )
}
