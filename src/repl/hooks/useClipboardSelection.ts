import { MouseButton, type MouseEvent, type Selection } from '@opentui/core'
import { useCallback, useEffect } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import { copyTextWithRendererClipboard, type ClipboardRenderer } from '../../lib/clipboard'

interface RendererSelectionHost extends ClipboardRenderer {
  on(event: 'selection', handler: (selection: Selection) => void): void
  off(event: 'selection', handler: (selection: Selection) => void): void
  getSelection(): Selection | null
}

export function useClipboardSelection(
  renderer: RendererSelectionHost,
  runtime: AppRuntime,
): (event: MouseEvent) => void {
  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      const text = selection.getSelectedText()
      if (text?.trim()) {
        void copyTextWithRendererClipboard(renderer, text).catch((error) => {
          runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
        })
      }
    }
    renderer.on('selection', handleSelection)
    return () => {
      renderer.off('selection', handleSelection)
    }
  }, [renderer, runtime.conversationStore])

  return useCallback(
    (event: MouseEvent) => {
      if (event.button !== MouseButton.RIGHT) {
        return
      }

      const selection = renderer.getSelection()
      const selectedText = selection?.getSelectedText() ?? ''
      if (!selectedText.trim()) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      void copyTextWithRendererClipboard(renderer, selectedText).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })
    },
    [renderer, runtime.conversationStore],
  )
}
