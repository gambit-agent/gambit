import type { ParsedKey, ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import { matchShortcut } from '../../lib/interactive/shortcuts'
import type { SessionPickerState } from './useSessionPicker'

interface ReplKeyboardOptions {
  runtime: AppRuntime
  scrollboxRef: RefObject<ScrollBoxRenderable | null>
  conversation: {
    error: string | null
    initialized: boolean
  }
  permissionSnapshot: {
    activeRequest: { id: string } | null
  }
  questionSnapshot: {
    activeRequest: unknown | null
  }
  questionController: {
    handleKey: (key: ParsedKey) => boolean
  }
  modelPickerState: {
    isOpen: boolean
    mode: string
  }
  closeModelPicker: () => void
  moveModelSelection: (delta: number) => void
  sessionPickerState: SessionPickerState
  dismissSessionPicker: () => void
  startFreshConversation: () => Promise<void>
  moveSessionSelection: (delta: number) => void
  mcpOverlayOpen: boolean
  setMcpOverlayOpen: Dispatch<SetStateAction<boolean>>
  transcriptMode: boolean
  setTranscriptMode: Dispatch<SetStateAction<boolean>>
  toggleTheme: () => void
  setPermissionExplainOpen: Dispatch<SetStateAction<boolean>>
}

export function useReplKeyboard(options: ReplKeyboardOptions): void {
  useKeyboard(
    useCallback(
      async (key: ParsedKey) => {
        const scrollShortcut = matchShortcut(key)
        if (scrollShortcut) {
          const sb = options.scrollboxRef.current
          if (sb) {
            const pageHeight = sb.viewport.height ?? 20
            switch (scrollShortcut.action) {
              case 'scroll-page-up':
                sb.scrollTo(Math.max(0, sb.scrollTop - pageHeight))
                return
              case 'scroll-page-down': {
                const maxScroll = Math.max(0, sb.scrollHeight - pageHeight)
                sb.scrollTo(Math.min(maxScroll, sb.scrollTop + pageHeight))
                return
              }
              case 'scroll-top':
                sb.scrollTo(0)
                return
              case 'scroll-bottom': {
                const maxScroll = Math.max(0, sb.scrollHeight - (sb.viewport.height ?? 0))
                sb.scrollTo(maxScroll)
                return
              }
            }
          }
        }

        if (key.name === 't' && key.ctrl) {
          options.toggleTheme()
          return
        }

        if (scrollShortcut?.action === 'toggle-transcript') {
          options.setTranscriptMode((prev) => !prev)
          return
        }

        if (options.transcriptMode) {
          if (key.name === 'q' || key.name === 'escape' || (key.name === 'c' && key.ctrl)) {
            options.setTranscriptMode(false)
            return
          }
        }

        if (options.permissionSnapshot.activeRequest) {
          if (key.name === 'y' || key.name === 'return' || key.name === 'enter') {
            await options.runtime.permissionEngine.resolve(options.permissionSnapshot.activeRequest.id, 'allow')
            return
          }
          if (key.name === 'n' || key.name === 'escape') {
            await options.runtime.permissionEngine.resolve(options.permissionSnapshot.activeRequest.id, 'deny')
            return
          }
          const permShortcut = matchShortcut(key)
          if (permShortcut?.action === 'cycle-permission') {
            const newMode = options.runtime.permissionEngine.cycleMode()
            if (newMode === 'Auto-accept' && options.permissionSnapshot.activeRequest) {
              await options.runtime.permissionEngine.resolve(options.permissionSnapshot.activeRequest.id, 'allow')
            }
            return
          }
          if (permShortcut?.action === 'permission-explain') {
            options.setPermissionExplainOpen((prev) => !prev)
            return
          }
          return
        }

        if (options.questionSnapshot.activeRequest) {
          options.questionController.handleKey(key)
          return
        }

        if (options.mcpOverlayOpen) {
          if (key.name === 'escape') {
            options.setMcpOverlayOpen(false)
          }
          return
        }

        if (options.sessionPickerState.isOpen) {
          if (key.name === 'escape') {
            if (options.conversation.initialized) {
              options.dismissSessionPicker()
            } else {
              await options.startFreshConversation()
            }
            return
          }

          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            options.moveSessionSelection(-1)
            return
          }

          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            options.moveSessionSelection(1)
            return
          }
        }

        if (options.conversation.error && key.name === 'escape') {
          options.runtime.conversationStore.setError(null)
          return
        }

        if (!options.modelPickerState.isOpen) {
          return
        }

        if (key.name === 'escape') {
          options.closeModelPicker()
          return
        }

        if (options.modelPickerState.mode === 'list') {
          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            options.moveModelSelection(-1)
            return
          }
          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            options.moveModelSelection(1)
          }
        }
      },
      [options],
    ),
  )
}
