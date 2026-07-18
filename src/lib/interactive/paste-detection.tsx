import type { PasteEvent } from '@opentui/core'
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import type { InteractiveHistory } from './history'

interface PasteKeyInput {
  on: (event: 'paste', handler: (event: PasteEvent) => void) => void
  off: (event: 'paste', handler: (event: PasteEvent) => void) => void
}

interface PasteRenderer {
  keyInput?: PasteKeyInput | null
}

const pasteDecoder = new TextDecoder()

function sanitizePastedText(raw: string): string {
  return raw.replace(/\u001b\[200~|\u001b\[201~/g, '').replace(/\r\n?/g, '\n')
}

export function usePasteDetection({
  renderer,
  inputPreview,
  setInputPreview,
  setInputValueWithRef,
  historyRef,
  suppressNextInputRef,
  enabled = true,
}: {
  renderer: PasteRenderer | null | undefined
  inputPreview: string | null
  setInputPreview: Dispatch<SetStateAction<string | null>>
  setInputValueWithRef: (next: SetStateAction<string>) => void
  historyRef: MutableRefObject<InteractiveHistory | null>
  suppressNextInputRef: MutableRefObject<boolean>
  enabled?: boolean
}) {
  const inputPreviewRef = useRef(inputPreview)
  const lastPasteLabelRef = useRef<string | null>(inputPreview)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    inputPreviewRef.current = inputPreview
    lastPasteLabelRef.current = inputPreview
  }, [inputPreview])

  const setPreviewLabel = useCallback(
    (label: string) => {
      setInputPreview(label)
      lastPasteLabelRef.current = label
    },
    [setInputPreview],
  )

  const clearPreviewLabel = useCallback(() => {
    setInputPreview(null)
    lastPasteLabelRef.current = null
  }, [setInputPreview])

  useEffect(() => {
    const keyInput = renderer?.keyInput
    if (!keyInput) {
      return
    }

    const handlePaste = (event: PasteEvent) => {
      // When an overlay input owns focus (e.g. the connect-provider modal),
      // leave the event untouched so opentui routes it to that input.
      if (!enabledRef.current) {
        return
      }

      const cleaned = sanitizePastedText(pasteDecoder.decode(event.bytes))
      if (!cleaned) {
        return
      }

      if (typeof event.preventDefault === 'function') {
        event.preventDefault()
      }

      historyRef.current?.clearCursor()
      suppressNextInputRef.current = true
      setInputValueWithRef((prev) => `${prev}${cleaned}`)
      const characterCount = Array.from(cleaned).length
      setPreviewLabel(`[Pasted Content ${characterCount} chars]`)
    }

    keyInput.on('paste', handlePaste)
    return () => {
      keyInput.off('paste', handlePaste)
    }
  }, [historyRef, renderer, setInputValueWithRef, setPreviewLabel, suppressNextInputRef])

  const detectInferredPaste = useCallback(
    (previousValue: string, value: string) => {
      if (previousValue === value) {
        return
      }

      const maxStart = Math.min(previousValue.length, value.length)
      let start = 0
      while (start < maxStart && previousValue[start] === value[start]) {
        start++
      }

      let prevEnd = previousValue.length
      let nextEnd = value.length
      while (prevEnd > start && nextEnd > start && previousValue[prevEnd - 1] === value[nextEnd - 1]) {
        prevEnd--
        nextEnd--
      }

      const inserted = value.slice(start, nextEnd)
      const removedLength = prevEnd - start
      const insertedLength = inserted.length
      const hasMultiCharInsert = insertedLength > 1
      const hasMultiLineInsert = inserted.includes('\n') && (insertedLength > 1 || removedLength > 0)

      if (!hasMultiCharInsert && !hasMultiLineInsert) {
        return
      }

      const characterCount = Array.from(inserted).length
      if (characterCount > 0) {
        setPreviewLabel(`[Pasted Content ${characterCount} chars]`)
      }
    },
    [setPreviewLabel],
  )

  return {
    inputPreviewRef,
    lastPasteLabelRef,
    setPreviewLabel,
    clearPreviewLabel,
    detectInferredPaste,
  }
}
