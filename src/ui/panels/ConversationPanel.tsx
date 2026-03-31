import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import type { RefObject } from 'react'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { Markdown } from '../Markdown'
import { rolePresentation, theme } from '../theme'

export interface ConversationPanelProps {
  messages: ConversationMessage[]
  scrollboxRef: RefObject<ScrollBoxRenderable | null>
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const timestampLabels: Record<ConversationMessage['role'], string> = {
  system: 'System',
  user: 'Sent',
  assistant: 'Responded',
  tool: 'Tool event',
}

function formatTimestamp(value: string): string {
  return timestampFormatter.format(new Date(value))
}

export function ConversationPanel({ messages, scrollboxRef }: ConversationPanelProps) {
  return (
    <scrollbox
      ref={scrollboxRef}
      scrollY
      stickyScroll
      stickyStart="bottom"
      style={{
        rootOptions: {
          flexGrow: 1,
          backgroundColor: theme.background,
          borderColor: theme.bodyBorder,
        },
        contentOptions: { flexDirection: 'column', gap: 1, padding: 1, backgroundColor: theme.background },
      }}
    >
      {messages
        .filter((message) => !message.hidden)
        .map((message) => {
          const presentation = rolePresentation[message.role] ?? rolePresentation.system
          const labelSuffix =
            message.role === 'tool' && message.metadata?.toolName ? ` · ${message.metadata.toolName}` : ''

          return (
            <box
              key={message.id}
              flexDirection="column"
              gap={0}
              style={{
                border: ['left'],
                borderStyle: 'heavy',
                padding: 1,
                backgroundColor: presentation.backgroundColor,
                borderColor: theme.bodyBorder,
              }}
            >
              <text
                fg={theme.headerAccent}
                attributes={TextAttributes.BOLD}
                content={`${presentation.label}${labelSuffix}`}
              />
              <Markdown content={message.content} textColor={presentation.textColor} />
              <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                {timestampLabels[message.role]} · {formatTimestamp(message.timestamp)}
              </text>
            </box>
          )
        })}
    </scrollbox>
  )
}
