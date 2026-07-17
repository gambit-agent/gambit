import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TextareaRenderable } from '@opentui/core'

import { theme } from '../../ui/theme'

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
  onInput: (value: string) => void
  onSubmit: (value: string) => void
}) {
  const inputFromTextareaRef = useRef(false)

  useEffect(() => {
    if (inputFromTextareaRef.current) {
      inputFromTextareaRef.current = false
      return
    }
    const textarea = textareaRef.current
    if (textarea && textarea.plainText !== inputValue) {
      textarea.setText(inputValue)
    }
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
    inputFromTextareaRef.current = true
    onInput(textarea.plainText)
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
