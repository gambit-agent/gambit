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
  /** When set, the panel gets a rounded border with this title embedded in the top edge. */
  frameTitle?: string
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
  frameTitle,
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
      paddingTop={Math.max(1, Math.floor(height / 4))}
      zIndex={zIndex}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      onMouseUp={onClose ? () => onClose() : undefined}
    >
      <box
        flexDirection="column"
        width={panelWidth}
        maxWidth={maxWidth}
        paddingTop={frameTitle ? 0 : 1}
        backgroundColor={theme.panel}
        border={frameTitle ? true : undefined}
        borderStyle={frameTitle ? 'rounded' : undefined}
        borderColor={frameTitle ? theme.headerBorder : undefined}
        title={frameTitle}
        titleColor={theme.headerAccent}
        titleAlignment="left"
        onMouseUp={(event: { stopPropagation(): void }) => {
          event.stopPropagation()
        }}
      >
        {children}
      </box>
    </box>
  )
}
