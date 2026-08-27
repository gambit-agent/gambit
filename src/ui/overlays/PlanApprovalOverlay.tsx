import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/react'
import type { RefObject } from 'react'

import type { PermissionRequestRecord } from '../../permissions/permission-types'
import { Markdown } from '../Markdown'
import { theme } from '../theme'

export interface PlanApprovalOverlayProps {
  request: PermissionRequestRecord
  planContent: string | null
  /** Scrolled by the REPL keyboard handler while the plan overlay is up. */
  scrollboxRef?: RefObject<ScrollBoxRenderable | null>
}

/** Chrome around the plan body: border, padding, title, and the two hint rows. */
const OVERLAY_CHROME_HEIGHT = 12

export function PlanApprovalOverlay({ request, planContent, scrollboxRef }: PlanApprovalOverlayProps) {
  const { width, height } = useTerminalDimensions()
  const displayPlan = planContent?.trim()
  const panelWidth = Math.max(40, Math.min(100, width - 4))
  // The plan is usually longer than the pane, so take most of the terminal and
  // let the scrollbox own the overflow instead of truncating the text.
  const planHeight = Math.max(6, Math.min(height - OVERLAY_CHROME_HEIGHT, Math.floor(height * 0.7)))

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
          width: panelWidth,
        }}
      >
        <text fg={theme.infoFg} attributes={TextAttributes.BOLD} content="Plan Review" />

        {displayPlan ? (
          <box flexDirection="column">
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="─── Plan ───" />
            <scrollbox
              ref={scrollboxRef}
              height={planHeight}
              scrollY
              style={{
                rootOptions: { backgroundColor: theme.header },
                contentOptions: {
                  flexDirection: 'column',
                  paddingRight: 1,
                  backgroundColor: theme.header,
                },
              }}
            >
              <Markdown content={displayPlan} textColor={theme.userFg} />
            </scrollbox>
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content="↑/↓ or PgUp/PgDn to scroll · Home/End for top/bottom"
            />
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
