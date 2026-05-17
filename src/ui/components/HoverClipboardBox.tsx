import type { AlignString, MouseEvent } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const HOVER_DEBOUNCE_MS = 300

interface HoverClipboardBoxProps {
  children: ReactNode
  content: string
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

export function HoverClipboardBox({
  children,
  content,
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleMouseMove = useCallback(
    (_event: MouseEvent) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        const trimmed = content.trim()
        if (trimmed && renderer.isOsc52Supported()) {
          renderer.copyToClipboardOSC52(trimmed)
        }
      }, HOVER_DEBOUNCE_MS)
    },
    [content, renderer],
  )

  const style: Record<string, unknown> = {}
  if (border) style.border = border
  if (borderStyle) style.borderStyle = borderStyle
  if (borderColor) style.borderColor = borderColor

  return (
    <box
      onMouseMove={handleMouseMove}
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
