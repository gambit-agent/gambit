import type { TextareaRenderable } from '@opentui/core'
import { TextAttributes } from '@opentui/core'
import type { RefObject } from 'react'

import { theme } from '../../ui/theme'
import { FileMentionOverlay } from '../../ui/overlays/FileMentionOverlay'
import { SlashCompletionOverlay } from '../../ui/overlays/SlashCompletionOverlay'
import type { SlashCompletionMatch, SlashCompletionMode } from '../slash-completions'
import type { ImageAttachment } from '../../lib/image-attachments'

export interface TextareaKeyBinding {
  name: string
  action: 'submit' | 'newline'
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
}

export function ReplComposer({
  inputValue,
  inputPreview,
  attachments,
  onRemoveAttachment,
  textareaRef,
  focused,
  keyBindings,
  onContentChange,
  onSubmit,
  fileMention,
  slashCompletion,
}: {
  inputValue: string
  inputPreview: string | null
  attachments: ImageAttachment[]
  onRemoveAttachment: (id: string) => void
  textareaRef: RefObject<TextareaRenderable | null>
  focused: boolean
  keyBindings: TextareaKeyBinding[]
  onContentChange: () => void
  onSubmit: () => void
  fileMention?: {
    isOpen: boolean
    query: string
    selectedIndex: number
    results: string[]
  }
  slashCompletion?: {
    isOpen: boolean
    query: string
    mode: SlashCompletionMode
    selectedIndex: number
    results: SlashCompletionMatch[]
  }
}) {
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      border={['top', 'bottom', 'left', 'right']}
      borderStyle="rounded"
      justifyContent="flex-start"
      style={{
        borderColor: theme.bodyBorder,
        backgroundColor: theme.background,
      }}
    >
      <box flexDirection="column" gap={inputPreview ? 1 : 0}>
        {attachments.length > 0 ? (
          <box flexDirection="row" flexWrap="wrap" gap={1} paddingX={1} paddingTop={1}>
            {attachments.map((attachment) => (
              <box
                key={attachment.id}
                flexDirection="row"
                gap={1}
                paddingX={1}
                backgroundColor={theme.systemBg}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onRemoveAttachment(attachment.id)
                }}
              >
                <text fg={theme.headerAccent} content="▧" />
                <text fg={theme.userFg} content={attachment.name} />
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="×" />
              </box>
            ))}
          </box>
        ) : null}
        {inputPreview ? <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={inputPreview} /> : null}
        {slashCompletion ? (
          <SlashCompletionOverlay
            isOpen={slashCompletion.isOpen}
            query={slashCompletion.query}
            mode={slashCompletion.mode}
            selectedIndex={slashCompletion.selectedIndex}
            results={slashCompletion.results}
          />
        ) : null}
        {fileMention && !slashCompletion?.isOpen ? (
          <FileMentionOverlay
            isOpen={fileMention.isOpen}
            query={fileMention.query}
            selectedIndex={fileMention.selectedIndex}
            results={fileMention.results}
          />
        ) : null}
        <box
          flexDirection="row"
          paddingLeft={1}
        >
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="› " />
          <box flexGrow={1} flexDirection="column">
            <textarea
              ref={textareaRef}
              initialValue={inputValue}
              onContentChange={onContentChange}
              onSubmit={onSubmit}
              focused={focused}
              backgroundColor={theme.background}
              focusedBackgroundColor={theme.background}
              textColor={theme.userFg}
              placeholderColor={theme.statusFg}
              placeholder="Ask anything or @ tag files/folders"
              cursorColor={theme.headerAccent}
              wrapMode="word"
              keyBindings={keyBindings}
            />
          </box>
        </box>
      </box>
    </box>
  )
}
