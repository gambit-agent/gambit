import { RGBA } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/react'
import type { ReactNode } from 'react'

import { theme } from '../theme'

export type PopupOverlaySize = 'medium' | 'large' | 'xlarge'

export interface PopupOverlayProps {
  children: ReactNode
  size?: PopupOverlaySize
  zIndex?: number
  onClose?: () => void
  framed?: boolean
  centered?: boolean
}

const popupWidths: Record<PopupOverlaySize, number> = {
  medium: 60,
  large: 88,
  xlarge: 116,
}

export function PopupOverlay({
  children,
  size = 'medium',
  zIndex = 100,
  onClose,
  framed = false,
  centered = false,
}: PopupOverlayProps) {
  const { width, height } = useTerminalDimensions()
  const maxWidth = Math.max(1, width - 2)
  const panelWidth = Math.min(popupWidths[size], maxWidth)

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      justifyContent={centered ? 'center' : undefined}
      paddingTop={centered ? 0 : Math.max(1, Math.floor(height / 4))}
      zIndex={zIndex}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      onMouseUp={onClose ? () => onClose() : undefined}
    >
      <box
        flexDirection="column"
        width={panelWidth}
        maxWidth={maxWidth}
        border={framed}
        borderStyle={framed ? 'rounded' : undefined}
        borderColor={framed ? theme.bodyBorder : undefined}
        paddingTop={framed ? 0 : 1}
        backgroundColor={theme.panel}
        onMouseUp={(event: { stopPropagation(): void }) => {
          event.stopPropagation()
        }}
      >
        {children}
      </box>
    </box>
  )
}
