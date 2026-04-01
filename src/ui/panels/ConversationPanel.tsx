import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import type { RefObject } from 'react'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { formatCompactToolSummary } from '../../lib/toolSummaries'
import { Markdown } from '../Markdown'
import { layout, rolePresentation, theme } from '../theme'

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

function formatToolStatus(value?: 'started' | 'completed' | 'failed'): string | null {
  switch (value) {
    case 'started':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

function renderToolLine(message: ConversationMessage) {
  const toolName = message.metadata?.toolName ?? 'tool'
  const toolStatus = formatToolStatus(message.metadata?.toolStatus) ?? 'done'
  const compactSummary = formatCompactToolSummary({
    toolName,
    status: message.metadata?.toolStatus,
    args: message.metadata?.toolArgs,
    result: message.metadata?.toolResult,
    artifactPath: message.metadata?.toolArtifactPath,
  })

  return (
    <text>
      <b fg={theme.headerAccent}>{`Tool · ${toolName} · ${toolStatus}`}</b>
      {compactSummary ? <span fg={rolePresentation.tool.textColor}>{` ${compactSummary}`}</span> : null}
    </text>
  )
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
        contentOptions: {
          flexDirection: 'column',
          gap: layout.sectionGap,
          paddingTop: layout.sectionGap,
          paddingRight: layout.sectionGap,
          paddingBottom: layout.sectionGap,
          paddingLeft: 0,
          backgroundColor: theme.background,
        },
      }}
    >
      {messages
        .filter((message) => !message.hidden)
        .map((message) => {
          const isToolMessage = message.role === 'tool'
          const presentation = rolePresentation[message.role] ?? rolePresentation.system
          const labelSuffix = ''

          return (
            <box
              key={message.id}
              flexDirection="column"
              gap={isToolMessage ? 0 : layout.panelGap}
              style={{
                border: ['left'],
                borderStyle: 'heavy',
                paddingTop: isToolMessage ? 0 : layout.messagePaddingY,
                paddingRight: layout.messagePaddingX,
                paddingBottom: isToolMessage ? 0 : layout.messagePaddingY,
                paddingLeft: layout.messagePaddingX,
                backgroundColor: presentation.backgroundColor,
                borderColor: presentation.borderColor,
              }}
            >
              {isToolMessage ? (
                renderToolLine(message)
              ) : (
                <>
                  <box flexDirection="column" gap={0}>
                    <text
                      fg={theme.headerAccent}
                      attributes={TextAttributes.BOLD}
                      content={`${presentation.label}${labelSuffix}`}
                    />
                    <Markdown content={message.content} textColor={presentation.textColor} />
                  </box>
                  <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                    {timestampLabels[message.role]} · {formatTimestamp(message.timestamp)}
                  </text>
                </>
              )}
            </box>
          )
        })}
    </scrollbox>
  )
}
