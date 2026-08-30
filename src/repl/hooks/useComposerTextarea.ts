import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TextareaRenderable } from '@opentui/core'

import { theme } from '../../ui/theme'

/**
 * Where the cursor lands after `onInput` rewrote what the user typed — the
 * composer collapses a large paste into a short `[Pasted text …]` label, so
 * the caret has to shift back by however much the value shrank and stay
 * inside the new text.
 */
export function resolveRewrittenCursorOffset(
  cursorOffset: number,
  value: string,
  displayValue: string,
): number {
  const shift = value.length - displayValue.length
  return Math.min(displayValue.length, Math.max(0, cursorOffset - shift))
}

/**
 * Whether a render should push `inputValue` back into the textarea.
 *
 * `lastTextareaValue` is the value the textarea itself last produced. React
 * state lags a keystroke behind the widget, so a render that only echoes that
 * value must not write to the textarea — the user may have typed again in the
 * meantime and would lose those characters (and their cursor, which
 * `applyExternalValue` parks at the end). Any other value is an external edit
 * (a submit clearing the composer, history recall, a queued follow-up pulled
 * back for editing) and does need to be applied.
 */
export function shouldApplyExternalValue(
  inputValue: string,
  plainText: string,
  lastTextareaValue: string | null,
): boolean {
  if (inputValue === lastTextareaValue) {
    return false
  }
  return plainText !== inputValue
}

export function useComposerTextarea({
  inputValue,
  textareaRef,
  activeThemeId,
  enabled,
  onInput,
  onSubmit,
}: {
  inputValue: string
  textareaRef: RefObject<TextareaRenderable | null>
  activeThemeId: string
  enabled: boolean
  /** Returns the value actually stored, which may collapse what was typed. */
  onInput: (value: string) => string
  onSubmit: (value: string) => void
}) {
  const lastTextareaValueRef = useRef<string | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    if (!shouldApplyExternalValue(inputValue, textarea.plainText, lastTextareaValueRef.current)) {
      return
    }
    lastTextareaValueRef.current = inputValue
    textarea.setText(inputValue)
    textarea.cursorOffset = inputValue.length
  }, [inputValue, textareaRef])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.backgroundColor = theme.background
    textarea.focusedBackgroundColor = theme.background
    textarea.textColor = theme.userFg
    textarea.focusedTextColor = theme.userFg
  }, [activeThemeId, textareaRef])

  const handleTextareaContentChange = useCallback(() => {
    if (!enabled) {
      return
    }
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    const value = textarea.plainText
    const cursorOffset = textarea.cursorOffset
    const displayValue = onInput(value)
    lastTextareaValueRef.current = displayValue
    if (displayValue !== value) {
      textarea.setText(displayValue)
      textarea.cursorOffset = resolveRewrittenCursorOffset(cursorOffset, value, displayValue)
    }
  }, [enabled, onInput, textareaRef])

  const handleTextareaSubmit = useCallback(() => {
    if (!enabled) {
      return
    }
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    onSubmit(textarea.plainText)
  }, [enabled, onSubmit, textareaRef])

  return {
    handleTextareaContentChange,
    handleTextareaSubmit,
  }
}
