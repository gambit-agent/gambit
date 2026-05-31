import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import { useEffect, useState, type RefObject } from 'react'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { inferFiletype } from '../../lib/change-diff'
import { Markdown } from '../Markdown'
import { getRolePresentation, layout, theme } from '../theme'
import { HoverClipboardBox } from '../components/HoverClipboardBox'
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseEmbeddedDiff(value: unknown): { message: string; diff: string } | null {
  if (typeof value !== 'string') {
    return null
  }

  const match = value.match(/^(.*?)\n\nDiff:\n```diff\n([\s\S]*?)\n```\s*$/)
  if (!match) {
    return null
  }

  return { message: match[1] ?? '', diff: match[2] ?? '' }
}

function getToolResultMessage(value: unknown): unknown {
  const embeddedDiff = parseEmbeddedDiff(value)
  if (embeddedDiff) {
    return embeddedDiff.message
  }

  const record = asRecord(value)
  return typeof record?.message === 'string' ? record.message : value
}

function formatToolDetail(label: string, value: unknown, maxLength = 500): string | null {
  if (value === undefined || value === null) {
    return null
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const truncated = text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
  return `${label}: ${truncated}`
}

function getToolDiff(message: ConversationMessage): { diff: string; filetype?: string } | null {
  const toolName = message.metadata?.toolName
  const args = asRecord(message.metadata?.toolArgs)
  const result = asRecord(message.metadata?.toolResult)
  const embeddedDiff = parseEmbeddedDiff(message.metadata?.toolResult)
  const diff =
    toolName === 'patchFile' && typeof args?.patch === 'string'
      ? args.patch
      : embeddedDiff?.diff ?? (typeof result?.diff === 'string' ? result.diff : null)

  if (!diff?.trim()) {
    return null
  }

  const path = typeof args?.path === 'string' ? args.path : undefined
  return { diff, filetype: inferFiletype(path) }
}

function ToolDiffView({ diff, filetype }: { diff: string; filetype?: string }) {
  const height = Math.min(18, Math.max(6, diff.split(/\r?\n/).length + 1))

  return (
    <box marginTop={1} width="100%" height={height}>
      <diff
        diff={diff}
        view="unified"
        filetype={filetype}
        showLineNumbers
        wrapMode="none"
        addedBg={theme.successBg}
        removedBg={theme.errorBg}
        addedSignColor={theme.diffAddedFg}
        removedSignColor={theme.diffRemovedFg}
        lineNumberFg={theme.diffLineNumberFg}
        width="100%"
        height="100%"
      />
    </box>
  )
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
          const presentation = getRolePresentation(message.role, theme)
          const isUser = message.role === 'user'

          if (isToolMessage) {
            const toolLine = formatToolMessageLine(message, toolMessageAnimationFrame)
            const toolDiff = message.metadata?.toolStatus === 'completed' ? getToolDiff(message) : null

            if (transcriptMode) {
              const argsDetail = formatToolDetail('Args', message.metadata?.toolArgs)
              const resultDetail = formatToolDetail('Result', getToolResultMessage(message.metadata?.toolResult))
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
                      <text selectable fg={theme.toolFg} attributes={TextAttributes.BOLD}>
                        {toolLine.indicator}
                      </text>
                    ) : null}
                    <text selectable fg={theme.toolFg} attributes={TextAttributes.BOLD}>
                      {toolLine.text}
                    </text>
                  </box>
                  {argsDetail ? (
                    <text selectable fg={theme.statusFg} attributes={TextAttributes.DIM}>
                      {argsDetail}
                    </text>
                  ) : null}
                  {resultDetail ? (
                    <text selectable fg={theme.statusFg}>
                      {resultDetail}
                    </text>
                  ) : null}
                  {artifactPath ? (
                    <text selectable fg={theme.statusFg} attributes={TextAttributes.DIM}>
                      {`Path: ${artifactPath}`}
                    </text>
                  ) : null}
                  {toolDiff ? <ToolDiffView diff={toolDiff.diff} filetype={toolDiff.filetype} /> : null}
                </box>
              )
            }

            return (
              <box
                key={message.id}
                flexDirection="column"
                gap={0}
                paddingX={layout.messagePaddingX}
                paddingY={0}
              >
                <box flexDirection="row" gap={toolLine.indicator ? 1 : 0}>
                  {toolLine.indicator ? (
                    <text selectable fg={theme.toolFg} attributes={TextAttributes.BOLD}>
                      {toolLine.indicator}
                    </text>
                  ) : null}
                  <text selectable fg={theme.statusFg} attributes={TextAttributes.DIM}>
                    {toolLine.text}
                  </text>
                </box>
                {toolDiff ? <ToolDiffView diff={toolDiff.diff} filetype={toolDiff.filetype} /> : null}
              </box>
            )
          }

          return (
            <HoverClipboardBox
              key={message.id}
              content={message.content}
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
                <text selectable fg={theme.statusFg} attributes={TextAttributes.DIM}>
                  {formatTimestamp(message.timestamp)}
                </text>
              </box>
            </HoverClipboardBox>
          )
        })}
    </scrollbox>
  )
}
