import { existsSync } from 'node:fs'
import path from 'node:path'
import type { PasteEvent } from '@opentui/core'
import { useCallback, useEffect, useRef, type MutableRefObject, type SetStateAction } from 'react'

import { detectImageMediaType, normalizePastedImagePath } from '../image-attachments'
import type { InteractiveHistory } from './history'
import { PastedTextDraft } from './pasted-text'

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
  setInputValueWithRef,
  historyRef,
  suppressNextInputRef,
  onImagePaste,
  enabled = true,
}: {
  renderer: PasteRenderer | null | undefined
  setInputValueWithRef: (next: SetStateAction<string>) => void
  historyRef: MutableRefObject<InteractiveHistory | null>
  suppressNextInputRef: MutableRefObject<boolean>
  onImagePaste?: (image: { bytes?: Uint8Array; mediaType?: string; path?: string }) => void
  enabled?: boolean
}) {
  const pastedTextDraftRef = useRef<PastedTextDraft | null>(null)
  const enabledRef = useRef(enabled)
  if (pastedTextDraftRef.current === null) {
    pastedTextDraftRef.current = new PastedTextDraft()
  }

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

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

      const detectedImageType = detectImageMediaType(event.bytes)
      const metadataImageType = event.metadata?.mimeType?.startsWith('image/')
        ? event.metadata.mimeType
        : undefined
      if (onImagePaste && (event.metadata?.kind === 'binary' || metadataImageType || detectedImageType)) {
        event.preventDefault()
        onImagePaste({
          bytes: event.bytes,
          mediaType: metadataImageType ?? detectedImageType ?? undefined,
        })
        return
      }

      const cleaned = sanitizePastedText(pasteDecoder.decode(event.bytes))
      if (!cleaned) {
        return
      }

      const pastedImagePath = normalizePastedImagePath(cleaned)
      if (onImagePaste && pastedImagePath && existsSync(path.resolve(pastedImagePath))) {
        event.preventDefault()
        onImagePaste({ path: pastedImagePath })
        return
      }

      event.preventDefault()
      historyRef.current?.clearCursor()
      suppressNextInputRef.current = true
      const displayText = pastedTextDraftRef.current!.collapse(cleaned)
      setInputValueWithRef((previous) => `${previous}${displayText}`)
    }

    keyInput.on('paste', handlePaste)
    return () => {
      keyInput.off('paste', handlePaste)
    }
  }, [historyRef, onImagePaste, renderer, setInputValueWithRef, suppressNextInputRef])

  /**
   * Collapses a paste that arrived as a plain content change rather than a
   * bracketed paste event (terminals that do not support it, and the
   * multi-character bursts some do). Diffs the composer's previous and next
   * value down to the inserted run and, when it is large enough, swaps it for
   * a `[Pasted text …]` label. Returns the value to display.
   */
  const compactInferredPaste = useCallback((previousValue: string, value: string): string => {
    if (previousValue === value) {
      return value
    }

    const maxStart = Math.min(previousValue.length, value.length)
    let start = 0
    while (start < maxStart && previousValue[start] === value[start]) {
      start += 1
    }

    let previousEnd = previousValue.length
    let nextEnd = value.length
    while (
      previousEnd > start
      && nextEnd > start
      && previousValue[previousEnd - 1] === value[nextEnd - 1]
    ) {
      previousEnd -= 1
      nextEnd -= 1
    }

    // A single keystroke can never reach the collapse threshold, so skip the
    // draft entirely for ordinary typing.
    const inserted = value.slice(start, nextEnd)
    if (inserted.length <= 1) {
      return value
    }

    const displayText = pastedTextDraftRef.current!.collapse(inserted)
    if (displayText === inserted) {
      return value
    }

    return `${value.slice(0, start)}${displayText}${value.slice(nextEnd)}`
  }, [])

  const materializePastedText = useCallback(
    (displayValue: string) => pastedTextDraftRef.current!.materialize(displayValue),
    [],
  )
  const collapsePastedText = useCallback(
    (value: string) => pastedTextDraftRef.current!.collapse(value),
    [],
  )
  const syncPastedText = useCallback((displayValue: string) => {
    pastedTextDraftRef.current!.sync(displayValue)
  }, [])
  const resetPastedText = useCallback(() => {
    pastedTextDraftRef.current!.reset()
  }, [])

  return {
    compactInferredPaste,
    materializePastedText,
    collapsePastedText,
    syncPastedText,
    resetPastedText,
  }
}
