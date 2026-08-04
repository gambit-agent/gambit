import type { ParsedKey, ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import { matchShortcut } from '../../lib/interactive/shortcuts'
import type { SessionPickerState } from './useSessionPicker'

function consumeKey(key: ParsedKey): void {
  const event = key as ParsedKey & {
    preventDefault?: () => void
    stopPropagation?: () => void
  }
  event.preventDefault?.()
  event.stopPropagation?.()
}

export interface TaskDrawerKeyboardController {
  isOpen: boolean
  focus: 'list' | 'detail'
  close: () => void
  moveSelection: (delta: number) => void
  selectFirst: () => void
  selectLast: () => void
  toggleFocus: () => void
  focusList: () => void
  focusDetail: () => void
  cycleFilter: () => void
  showLive: () => void
  showDetails: () => void
  cancelSelected: () => Promise<void>
}

export async function handleTaskDrawerKey(
  key: ParsedKey,
  drawer: TaskDrawerKeyboardController,
): Promise<boolean> {
  if (key.name === 'escape' || (key.name === 'b' && key.ctrl && !key.meta && !key.shift)) {
    consumeKey(key)
    drawer.close()
    return true
  }
  if (key.name === 'tab') {
    consumeKey(key)
    drawer.toggleFocus()
    return true
  }
  if (key.name === 'left' || key.name === 'h') {
    consumeKey(key)
    drawer.focusList()
    return true
  }
  if (key.name === 'right' || key.name === 'l') {
    consumeKey(key)
    drawer.focusDetail()
    return true
  }
  if (key.name === 'f') {
    consumeKey(key)
    drawer.cycleFilter()
    return true
  }
  if (key.name === 'o') {
    consumeKey(key)
    drawer.showLive()
    return true
  }
  if (key.name === 'd') {
    consumeKey(key)
    drawer.showDetails()
    return true
  }
  if (key.name === 'c') {
    consumeKey(key)
    await drawer.cancelSelected()
    return true
  }
  if (drawer.focus === 'list' && (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl))) {
    consumeKey(key)
    drawer.moveSelection(-1)
    return true
  }
  if (drawer.focus === 'list' && (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl))) {
    consumeKey(key)
    drawer.moveSelection(1)
    return true
  }
  if (drawer.focus === 'list' && key.name === 'home') {
    consumeKey(key)
    drawer.selectFirst()
    return true
  }
  if (drawer.focus === 'list' && key.name === 'end') {
    consumeKey(key)
    drawer.selectLast()
    return true
  }
  return false
}

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
  openModelPicker: () => void
  closeModelPicker: () => void
  moveModelSelection: (delta: number) => void
  moveModelReasoningEffort: (delta: number) => void
  moveModelProviderSelection: (delta: number) => void
  applyModelOptionsSelection: () => void
  sessionPickerState: SessionPickerState
  dismissSessionPicker: () => void
  startFreshConversation: () => Promise<void>
  moveSessionSelection: (delta: number) => void
  mcpOverlayOpen: boolean
  setMcpOverlayOpen: Dispatch<SetStateAction<boolean>>
  themePicker?: {
    isOpen: boolean
    moveSelection: (delta: number) => void
    confirm: () => void
    cancel: () => void
  }
  connectPicker?: {
    isOpen: boolean
    step: 'list' | 'input' | 'oauth' | 'disconnect-confirm'
    moveSelection: (delta: number) => void
    enterSelected: () => void
    confirmDisconnect: () => void
    back: () => void
    close: () => void
  }
  transcriptMode: boolean
  setTranscriptMode: Dispatch<SetStateAction<boolean>>
  toggleTheme: () => void
  setPermissionExplainOpen: Dispatch<SetStateAction<boolean>>
  taskDrawer?: TaskDrawerKeyboardController
  fileMentionCompletion?: {
    isOpen: boolean
    moveSelection: (delta: number) => void
    selectCurrent: () => void
    close: () => void
  }
  slashCompletion?: {
    isOpen: boolean
    moveSelection: (delta: number) => void
    selectCurrent: () => void
    close: () => void
  }
}

export function useReplKeyboard(options: ReplKeyboardOptions): void {
  useKeyboard(
    useCallback(
      async (key: ParsedKey) => {
        if (key.name === 'm' && key.ctrl && !key.meta && !key.shift && !key.option) {
          consumeKey(key)
          options.taskDrawer?.close()
          options.openModelPicker()
          return
        }

        if (options.taskDrawer?.isOpen) {
          await handleTaskDrawerKey(key, options.taskDrawer)
          return
        }

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

        if (options.themePicker?.isOpen) {
          if (key.name === 'escape') {
            options.themePicker.cancel()
            return
          }
          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            options.themePicker.moveSelection(-1)
            return
          }
          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            options.themePicker.moveSelection(1)
            return
          }
          if (key.name === 'return' || key.name === 'enter') {
            options.themePicker.confirm()
          }
          return
        }

        if (options.connectPicker?.isOpen) {
          if (options.connectPicker.step === 'list') {
            if (key.name === 'escape') {
              options.connectPicker.close()
              return
            }
            if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
              options.connectPicker.moveSelection(-1)
              return
            }
            if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
              options.connectPicker.moveSelection(1)
              return
            }
            if (key.name === 'return' || key.name === 'enter') {
              options.connectPicker.enterSelected()
              return
            }
            return
          }

          if (options.connectPicker.step === 'disconnect-confirm') {
            if (key.name === 'escape') {
              options.connectPicker.back()
              return
            }
            if (key.name === 'return' || key.name === 'enter') {
              options.connectPicker.confirmDisconnect()
              return
            }
            return
          }

          if (options.connectPicker.step === 'oauth') {
            if (key.name === 'escape') {
              options.connectPicker.back()
              return
            }
            if (key.name === 'return' || key.name === 'enter') {
              options.connectPicker.enterSelected()
              return
            }
            return
          }

          // step === 'input': the focused <input> handles typing and Enter via
          // onSubmit; only Esc needs global handling to step back to the list.
          if (key.name === 'escape') {
            options.connectPicker.back()
            return
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

        if (options.modelPickerState.isOpen) {
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
              return
            }
            return
          }

          if (options.modelPickerState.mode === 'options') {
            if (key.name === 'left' || key.name === 'h') {
              options.moveModelReasoningEffort(-1)
              return
            }
            if (key.name === 'right' || key.name === 'l') {
              options.moveModelReasoningEffort(1)
              return
            }
            if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
              options.moveModelProviderSelection(-1)
              return
            }
            if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
              options.moveModelProviderSelection(1)
              return
            }
            if (key.name === 'return' || key.name === 'enter') {
              options.applyModelOptionsSelection()
            }
            return
          }

          return
        }

        if (options.conversation.error && key.name === 'escape') {
          options.runtime.conversationStore.setError(null)
          return
        }

        if (options.slashCompletion?.isOpen) {
          if (key.name === 'escape') {
            options.slashCompletion.close()
            return
          }
          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            options.slashCompletion.moveSelection(-1)
            return
          }
          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            options.slashCompletion.moveSelection(1)
            return
          }
          if (key.name === 'tab') {
            options.slashCompletion.selectCurrent()
            return
          }
        }

        if (options.fileMentionCompletion?.isOpen) {
          if (key.name === 'escape') {
            options.fileMentionCompletion.close()
            return
          }
          if (key.name === 'up' || key.name === 'k' || (key.name === 'p' && key.ctrl)) {
            options.fileMentionCompletion.moveSelection(-1)
            return
          }
          if (key.name === 'down' || key.name === 'j' || (key.name === 'n' && key.ctrl)) {
            options.fileMentionCompletion.moveSelection(1)
            return
          }
          if (key.name === 'tab') {
            options.fileMentionCompletion.selectCurrent()
            return
          }
        }

        return
      },
      [options],
    ),
  )
}
