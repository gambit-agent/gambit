import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import { useEffect, useState, type RefObject } from 'react'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { Markdown } from '../Markdown'
import { layout, rolePresentation, theme } from '../theme'
import { formatToolMessageLine, toolMessageRunningFrames, toolMessageRunningIntervalMs } from './tool-message-line'

export interface ConversationPanelProps {
  messages: ConversationMessage[]
  scrollboxRef: RefObject<ScrollBoxRenderable | null>
  transcriptMode?: boolean
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

function formatToolDetail(label: string, value: unknown, maxLength = 500): string | null {
  if (value === undefined || value === null) {
    return null
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const truncated = text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
  return `${label}: ${truncated}`
}

export function ConversationPanel({ messages, scrollboxRef, transcriptMode = false }: ConversationPanelProps) {
  const [toolMessageAnimationFrame, setToolMessageAnimationFrame] = useState(0)
  const hasRunningToolMessage = messages.some(
    (message) => message.role === 'tool' && message.metadata?.toolStatus === 'started',
  )

  useEffect(() => {
    if (!hasRunningToolMessage) {
      setToolMessageAnimationFrame(0)
      return
    }

    setToolMessageAnimationFrame(0)
    const intervalId = setInterval(() => {
      setToolMessageAnimationFrame((current) => (current + 1) % toolMessageRunningFrames.length)
    }, toolMessageRunningIntervalMs)

    return () => {
      clearInterval(intervalId)
    }
  }, [hasRunningToolMessage])

  return (
    <scrollbox
      ref={scrollboxRef}
      scrollY
      stickyScroll
      stickyStart="bottom"
      style={{
        rootOptions: {
          flexGrow: 1,
          flexShrink: 1,
          minHeight: 0,
          backgroundColor: theme.background,
        },
        contentOptions: {
          flexDirection: 'column',
          gap: 0,
          paddingY: 1,
          backgroundColor: theme.background,
        },
      }}
    >
      {messages
        .filter((message) => !message.hidden)
        .map((message) => {
          const isToolMessage = message.role === 'tool'
          const presentation = rolePresentation[message.role] ?? rolePresentation.system
          const isUser = message.role === 'user'

          if (isToolMessage) {
            const toolLine = formatToolMessageLine(message, toolMessageAnimationFrame)

            if (transcriptMode) {
              const argsDetail = formatToolDetail('Args', message.metadata?.toolArgs)
              const resultDetail = formatToolDetail('Result', message.metadata?.toolResult)
              const artifactPath = message.metadata?.toolArtifactPath

              return (
                <box
                  key={message.id}
                  flexDirection="column"
                  paddingX={layout.messagePaddingX}
                  paddingY={1}
                  gap={0}
                  style={{
                    border: ['left'],
                    borderColor: theme.toolFg,
                    paddingLeft: 2,
                  }}
                >
                  <box flexDirection="row" gap={1}>
                    {toolLine.indicator ? (
                      <text fg={theme.toolFg} attributes={TextAttributes.BOLD}>
                        {toolLine.indicator}
                      </text>
                    ) : null}
                    <text fg={theme.toolFg} attributes={TextAttributes.BOLD}>
                      {toolLine.text}
                    </text>
                  </box>
                  {argsDetail ? (
                    <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                      {argsDetail}
                    </text>
                  ) : null}
                  {resultDetail ? (
                    <text fg={theme.statusFg}>
                      {resultDetail}
                    </text>
                  ) : null}
                  {artifactPath ? (
                    <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                      {`Path: ${artifactPath}`}
                    </text>
                  ) : null}
                </box>
              )
            }

            return (
              <box
                key={message.id}
                flexDirection="row"
                gap={toolLine.indicator ? 1 : 0}
                paddingX={layout.messagePaddingX}
                paddingY={0}
              >
                {toolLine.indicator ? (
                  <text fg={theme.toolFg} attributes={TextAttributes.BOLD}>
                    {toolLine.indicator}
                  </text>
                ) : null}
                <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                  {toolLine.text}
                </text>
              </box>
            )
          }

          return (
            <box
              key={message.id}
              flexDirection="column"
              alignItems={isUser ? 'flex-end' : 'flex-start'}
              paddingX={layout.messagePaddingX}
              paddingY={1}
            >
              <box flexDirection="column" gap={0}>
                {/* For user, we might want right-aligned markdown. We rely on the parent alignItems='flex-end' */}
                <Markdown content={message.content} textColor={presentation.textColor} />
              </box>
              <box marginTop={1}>
                <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                  {formatTimestamp(message.timestamp)}
                </text>
              </box>
            </box>
          )
        })}
    </scrollbox>
  )
}
