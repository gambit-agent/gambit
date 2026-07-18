import { MouseButton, type AlignString, type MouseEvent } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { useCallback } from 'react'
import type { ReactNode } from 'react'

import { copyTextWithRendererClipboard } from '../../lib/clipboard'

interface HoverClipboardBoxProps {
  children: ReactNode
  content: string
  onCopyError?: (error: Error) => void
  flexDirection?: 'row' | 'column'
  gap?: number
  alignItems?: AlignString
  paddingX?: number
  paddingY?: number
  backgroundColor?: string
  border?: Array<'top' | 'bottom' | 'left' | 'right'>
  borderStyle?: 'single' | 'double' | 'rounded' | 'bold'
  borderColor?: string
}

export function isRightClickCopyEvent(event: Pick<MouseEvent, 'button'>): boolean {
  return event.button === MouseButton.RIGHT
}

export function HoverClipboardBox({
  children,
  content,
  onCopyError,
  flexDirection,
  gap,
  alignItems,
  paddingX,
  paddingY,
  backgroundColor,
  border,
  borderStyle,
  borderColor,
}: HoverClipboardBoxProps) {
  const renderer = useRenderer()

  const handleMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!isRightClickCopyEvent(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const trimmed = content.trim()
      if (!trimmed) {
        return
      }

      void copyTextWithRendererClipboard(renderer, trimmed)
        .catch((error) => {
          onCopyError?.(error instanceof Error ? error : new Error(String(error)))
        })
    },
    [content, onCopyError, renderer],
  )

  const style: Record<string, unknown> = {}
  if (border) style.border = border
  if (borderStyle) style.borderStyle = borderStyle
  if (borderColor) style.borderColor = borderColor

  return (
    <box
      onMouseUp={handleMouseUp}
      flexDirection={flexDirection}
      gap={gap}
      alignItems={alignItems}
      paddingX={paddingX}
      paddingY={paddingY}
      backgroundColor={backgroundColor}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={Object.keys(style).length > 0 ? (style as any) : undefined}
    >
      {children}
    </box>
  )
}
