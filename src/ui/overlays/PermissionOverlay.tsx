import { TextAttributes } from '@opentui/core'

import type { PermissionRequestRecord } from '../../permissions/permission-types'
import { theme } from '../theme'

export interface PermissionOverlayProps {
  request: PermissionRequestRecord
}

export function PermissionOverlay({ request }: PermissionOverlayProps) {
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
          padding: 2,
          backgroundColor: theme.header,
          minWidth: 60,
          maxWidth: 90,
        }}
      >
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Permission Required" />
        <text fg={theme.userFg} content={request.subject} />
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content="Press Y to allow, N to deny, or Shift+Tab to change permission mode."
        />
      </box>
    </box>
  )
}
