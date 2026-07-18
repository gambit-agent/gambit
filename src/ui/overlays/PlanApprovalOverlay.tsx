import { TextAttributes } from '@opentui/core'

import type { PermissionRequestRecord } from '../../permissions/permission-types'
import { theme } from '../theme'

export interface PlanApprovalOverlayProps {
  request: PermissionRequestRecord
  planContent: string | null
}

export function PlanApprovalOverlay({ request, planContent }: PlanApprovalOverlayProps) {
  const displayPlan = planContent?.trim()
  const planLines = displayPlan ? displayPlan.split('\n') : []
  const maxPreviewLines = 30
  const truncated = planLines.length > maxPreviewLines
  const previewLines = truncated ? planLines.slice(0, maxPreviewLines) : planLines
  const previewText = previewLines.join('\n') + (truncated ? `\n\n... (${planLines.length - maxPreviewLines} more lines)` : '')

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
          borderColor: theme.infoFg,
          padding: 2,
          backgroundColor: theme.header,
          minWidth: 60,
          maxWidth: 100,
        }}
      >
        <text fg={theme.infoFg} attributes={TextAttributes.BOLD} content="Plan Review" />

        {displayPlan ? (
          <box flexDirection="column" gap={1}>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="─── Plan ───" />
            <text fg={theme.userFg} content={previewText} />
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="────────────" />
          </box>
        ) : (
          <text fg={theme.errorFg} content="No plan content found. The model should write the plan file first." />
        )}

        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content="Press Y to approve and start coding, N to reject and keep planning."
        />
      </box>
    </box>
  )
}
