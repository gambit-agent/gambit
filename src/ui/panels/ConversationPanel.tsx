import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import { memo, useEffect, useMemo, useState, type RefObject } from 'react'

import type { ConversationMessage } from '../../conversation/conversation-types'
import { inferFiletype } from '../../lib/change-diff'
import { Markdown } from '../Markdown'
import { getRolePresentation, layout, theme } from '../theme'
import { HoverClipboardBox } from '../components/HoverClipboardBox'
import {
  formatToolMessageLine,
  formatToolMessagePresentation,
  toolMessageRunningFrames,
  toolMessageRunningIntervalMs,
  type ToolMessagePresentationLine,
} from './tool-message-line'

export interface ConversationPanelProps {
  messages: ConversationMessage[]
  scrollboxRef: RefObject<ScrollBoxRenderable | null>
  isLightTheme?: boolean
  activeThemeId?: string
  transcriptMode?: boolean
  onClipboardError?: (error: Error) => void
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

const reasoningBorderChars = {
  topLeft: '▌',
  topRight: '▌',
  bottomLeft: '▌',
  bottomRight: '▌',
  horizontal: '▌',
  vertical: '▌',
  topT: '▌',
  bottomT: '▌',
  leftT: '▌',
  rightT: '▌',
  cross: '▌',
} as const

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

export interface ParsedAssistantReasoning {
  reasoning: string
  response: string
}

export function parseAssistantReasoning(content: string): ParsedAssistantReasoning | null {
  if (!content.startsWith('Reasoning:\n')) {
    return null
  }

  const body = content.slice('Reasoning:\n'.length)
  const separator = body.search(/\n{2,}/)
  const reasoning = (separator >= 0 ? body.slice(0, separator) : body).trim()
  const response = separator >= 0 ? body.slice(separator).replace(/^\n+/, '') : ''

  if (!reasoning) {
    return null
  }

  return { reasoning, response }
}

export function shouldRenderMessageTimestamp(message: ConversationMessage): boolean {
  return message.role !== 'assistant' || parseAssistantReasoning(message.content) === null
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

function ReasoningBlock({ content, marginBottom = 1 }: { content: string; marginBottom?: number }) {
  return (
    <box
      flexDirection="column"
      gap={0}
      marginBottom={marginBottom}
      border={['left']}
      borderColor={theme.reasoningBorder}
      customBorderChars={reasoningBorderChars}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.reasoningBg}
    >
      <Markdown content={content} textColor={theme.reasoningFg} strongColor={theme.reasoningBorder} />
    </box>
  )
}

function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) {
    return null
  }

  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
}

function getReasoningDurationMs(message: ConversationMessage): number | undefined {
  const duration = message.metadata?.reasoningDurationMs
  if (typeof duration === 'number') {
    return duration
  }

  const startedAt = message.metadata?.reasoningStartedAt
  const finishedAt = message.metadata?.reasoningFinishedAt
  if (!startedAt || !finishedAt) {
    return undefined
  }

  const startedMs = Date.parse(startedAt)
  const finishedMs = Date.parse(finishedAt)
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return undefined
  }

  return Math.max(0, finishedMs - startedMs)
}

function ThoughtToggle({
  expanded,
  durationLabel,
  marginBottom = 0,
  onToggle,
}: {
  expanded: boolean
  durationLabel: string | null
  marginBottom?: number
  onToggle: () => void
}) {
  const marker = expanded ? '-' : '+'

  return (
    <box
      flexDirection="row"
      gap={1}
      marginBottom={marginBottom}
      onMouseDown={(event) => {
        event.preventDefault()
        onToggle()
      }}
    >
      <text selectable={false} fg={theme.reasoningBorder} attributes={TextAttributes.BOLD} content={marker} />
      <text selectable={false}>
        <span fg={theme.reasoningBorder} attributes={TextAttributes.BOLD}>Thought</span>
        {durationLabel ? <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{`: ${durationLabel}`}</span> : null}
      </text>
    </box>
  )
}

function splitLeadingWord(value: string): { leading: string; rest: string } {
  const match = value.match(/^(\S+)(.*)$/)
  return {
    leading: match?.[1] ?? value,
    rest: match?.[2] ?? '',
  }
}

type ToolStatus = NonNullable<ConversationMessage['metadata']>['toolStatus']

function getToolStatusColor(status: ToolStatus): string {
  switch (status) {
    case 'completed':
      return theme.successFg
    case 'failed':
      return theme.errorFg
    case 'started':
      return theme.headerAccent
    default:
      return theme.statusFg
  }
}

function stripLeadingBullet(value: string): string {
  return value.replace(/^•\s*/, '')
}

function ToolHeading({
  heading,
  status,
}: {
  heading: string
  status: ToolStatus
}) {
  const bulletColor = getToolStatusColor(status)
  const normalizedHeading = stripLeadingBullet(heading)

  if (heading === 'Explored') {
    return (
      <text selectable>
        <span fg={bulletColor}>• </span>
        <span fg={theme.userFg}>{normalizedHeading}</span>
      </text>
    )
  }

  const { leading, rest } = splitLeadingWord(normalizedHeading)
  return (
    <text selectable>
      <span fg={bulletColor}>• </span>
      <span fg={theme.toolFg}>{leading}</span>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{rest}</span>
    </text>
  )
}

function ToolNormalDetailLine({ text }: { text: string }) {
  const match = text.match(/^(\s*└\s+)(\S+)(.*)$/)
  if (!match) {
    return (
      <text selectable>
        <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{text}</span>
      </text>
    )
  }

  return (
    <text selectable>
      <span fg={theme.userFg}>{match[1]}</span>
      <span fg={theme.toolFg}>{match[2]}</span>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{match[3]}</span>
    </text>
  )
}

function ToolDetailLine({ line }: { line: ToolMessagePresentationLine }) {
  if (line.kind === 'normal') {
    return (
      <box width="100%">
        <ToolNormalDetailLine text={line.text} />
      </box>
    )
  }

  const isAdded = line.kind === 'added'
  const isRemoved = line.kind === 'removed'
  const backgroundColor = isAdded ? theme.successBg : isRemoved ? theme.errorBg : undefined
  const color = isAdded ? theme.diffAddedFg : isRemoved ? theme.diffRemovedFg : theme.statusFg

  return (
    <box width="100%" backgroundColor={backgroundColor}>
      <text
        selectable
        fg={color}
        attributes={line.kind === 'context' ? TextAttributes.DIM : undefined}
      >
        {line.text}
      </text>
    </box>
  )
}

interface ConversationMessageItemProps {
  message: ConversationMessage
  isLightTheme: boolean
  activeThemeId: string
  transcriptMode: boolean
  toolMessageAnimationFrame: number
  onClipboardError?: (error: Error) => void
}

interface ToolMessageGroupProps {
  messages: ConversationMessage[]
  toolMessageAnimationFrame: number
}

type ConversationRenderItem =
  | { type: 'message'; message: ConversationMessage }
  | { type: 'tool-group'; messages: ConversationMessage[] }

function canGroupToolPresentation(message: ConversationMessage): boolean {
  if (message.role !== 'tool' || message.metadata?.toolStatus === 'failed') {
    return false
  }

  const presentation = formatToolMessagePresentation(message)
  return presentation.heading === 'Explored' && presentation.detailLines.every((line) => line.kind === 'normal')
}

function getToolGroupKey(message: ConversationMessage): string | null {
  if (!canGroupToolPresentation(message)) {
    return null
  }

  return formatToolMessagePresentation(message).heading
}

function getToolGroupRenderKey(messages: readonly ConversationMessage[]): string {
  const first = messages[0]?.id ?? 'empty'
  const last = messages.at(-1)?.id ?? first
  return `tool-group-${messages.length}-${first}-${last}`
}

export function groupConversationRenderItems(
  messages: readonly ConversationMessage[],
  transcriptMode: boolean,
): ConversationRenderItem[] {
  if (transcriptMode) {
    return messages.map((message) => ({ type: 'message', message }))
  }

  const items: ConversationRenderItem[] = []

  for (const message of messages) {
    const groupKey = getToolGroupKey(message)
    const previous = items.at(-1)

    if (groupKey && previous?.type === 'tool-group') {
      const previousMessage = previous.messages.at(-1)
      if (previousMessage && getToolGroupKey(previousMessage) === groupKey) {
        previous.messages.push(message)
        continue
      }
    }

    if (groupKey) {
      items.push({ type: 'tool-group', messages: [message] })
    } else {
      items.push({ type: 'message', message })
    }
  }

  return items
}

function ToolMessageGroup({ messages, toolMessageAnimationFrame }: ToolMessageGroupProps) {
  const latestMessage = messages[messages.length - 1]
  if (!latestMessage) {
    return null
  }

  const latestPresentation = formatToolMessagePresentation(latestMessage, toolMessageAnimationFrame)
  const detailLines = messages.flatMap((message) =>
    formatToolMessagePresentation(message, toolMessageAnimationFrame).detailLines,
  )

  return (
    <box
      flexDirection="column"
      gap={0}
      paddingX={layout.messagePaddingX}
      paddingY={0}
    >
      <box flexDirection="row" gap={latestPresentation.indicator ? 1 : 0}>
        {latestPresentation.indicator ? (
          <text selectable fg={getToolStatusColor(latestMessage.metadata?.toolStatus)} attributes={TextAttributes.BOLD}>
            {latestPresentation.indicator}
          </text>
        ) : null}
        <ToolHeading heading={latestPresentation.heading} status={latestMessage.metadata?.toolStatus} />
      </box>
      {detailLines.map((line, index) => (
        <ToolDetailLine key={`${line.kind}-${index}-${line.text}`} line={line} />
      ))}
    </box>
  )
}

const ConversationMessageItem = memo(function ConversationMessageItem({
  message,
  transcriptMode,
  toolMessageAnimationFrame,
  onClipboardError,
}: ConversationMessageItemProps) {
  const isToolMessage = message.role === 'tool'
  const presentation = getRolePresentation(message.role, theme)
  const isUser = message.role === 'user'
  const [reasoningExpanded, setReasoningExpanded] = useState(false)
  const assistantReasoning =
    message.role === 'assistant' ? parseAssistantReasoning(message.content) : null
  const hasAssistantResponse = Boolean(assistantReasoning?.response.trim())
  const renderTimestamp = shouldRenderMessageTimestamp(message)
  const reasoningDurationLabel = assistantReasoning ? formatDuration(getReasoningDurationMs(message)) : null

  if (isToolMessage) {
    const toolLine = formatToolMessageLine(message, toolMessageAnimationFrame)
    const toolPresentation = formatToolMessagePresentation(message, toolMessageAnimationFrame)
    const toolDiff = message.metadata?.toolStatus === 'completed' ? getToolDiff(message) : null

    if (transcriptMode) {
      const argsDetail = formatToolDetail('Args', message.metadata?.toolArgs)
      const resultDetail = formatToolDetail('Result', getToolResultMessage(message.metadata?.toolResult))
      const artifactPath = message.metadata?.toolArtifactPath

      return (
        <box
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
              <text selectable fg={getToolStatusColor(message.metadata?.toolStatus)} attributes={TextAttributes.BOLD}>
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
        flexDirection="column"
        gap={0}
        paddingX={layout.messagePaddingX}
        paddingY={0}
      >
        <box flexDirection="row" gap={toolPresentation.indicator ? 1 : 0}>
          {toolPresentation.indicator ? (
            <text selectable fg={getToolStatusColor(message.metadata?.toolStatus)} attributes={TextAttributes.BOLD}>
              {toolPresentation.indicator}
            </text>
          ) : null}
          <ToolHeading heading={toolPresentation.heading} status={message.metadata?.toolStatus} />
        </box>
        {toolPresentation.detailLines.map((line, index) => (
          <ToolDetailLine key={`${line.kind}-${index}-${line.text}`} line={line} />
        ))}
      </box>
    )
  }

  return (
    <HoverClipboardBox
      content={message.content}
      onCopyError={onClipboardError}
      flexDirection="column"
      alignItems={isUser ? 'flex-end' : 'flex-start'}
      paddingX={layout.messagePaddingX}
      paddingY={1}
    >
      <box flexDirection="column" gap={0}>
        {assistantReasoning ? (
          <>
            <ThoughtToggle
              expanded={reasoningExpanded}
              durationLabel={reasoningDurationLabel}
              marginBottom={!reasoningExpanded && hasAssistantResponse ? 1 : 0}
              onToggle={() => setReasoningExpanded((current) => !current)}
            />
            {reasoningExpanded ? (
              <ReasoningBlock content={assistantReasoning.reasoning} marginBottom={hasAssistantResponse ? 1 : 0} />
            ) : null}
            {hasAssistantResponse ? (
              <Markdown
                content={assistantReasoning.response}
                textColor={presentation.textColor}
                strongColor={theme.responseStrongFg}
              />
            ) : null}
          </>
        ) : (
          <Markdown
            content={message.content}
            textColor={presentation.textColor}
            strongColor={message.role === 'assistant' ? theme.responseStrongFg : presentation.textColor}
          />
        )}
      </box>
      {renderTimestamp ? (
        <box marginTop={1}>
          <text selectable fg={theme.statusFg} attributes={TextAttributes.DIM}>
            {formatTimestamp(message.timestamp)}
          </text>
        </box>
      ) : null}
    </HoverClipboardBox>
  )
}, areConversationMessageItemPropsEqual)

function areConversationMessageItemPropsEqual(
  previous: ConversationMessageItemProps,
  next: ConversationMessageItemProps,
): boolean {
  if (
    previous.message !== next.message ||
    previous.isLightTheme !== next.isLightTheme ||
    previous.activeThemeId !== next.activeThemeId ||
    previous.transcriptMode !== next.transcriptMode ||
    previous.onClipboardError !== next.onClipboardError
  ) {
    return false
  }

  return !(
    next.message.role === 'tool' &&
    next.message.metadata?.toolStatus === 'started' &&
    previous.toolMessageAnimationFrame !== next.toolMessageAnimationFrame
  )
}

export function ConversationPanel({
  messages,
  scrollboxRef,
  isLightTheme = false,
  activeThemeId = "",
  transcriptMode = false,
  onClipboardError,
}: ConversationPanelProps) {
  const [toolMessageAnimationFrame, setToolMessageAnimationFrame] = useState(0)
  const visibleMessages = useMemo(() => messages.filter((message) => !message.hidden), [messages])
  const renderItems = useMemo(
    () => groupConversationRenderItems(visibleMessages, transcriptMode),
    [transcriptMode, visibleMessages],
  )
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
      {renderItems.map((item) =>
        item.type === 'tool-group' ? (
          <ToolMessageGroup
            key={getToolGroupRenderKey(item.messages)}
            messages={item.messages}
            toolMessageAnimationFrame={toolMessageAnimationFrame}
          />
        ) : (
          <ConversationMessageItem
            key={item.message.id}
            message={item.message}
            isLightTheme={isLightTheme}
            activeThemeId={activeThemeId}
            transcriptMode={transcriptMode}
            toolMessageAnimationFrame={toolMessageAnimationFrame}
            onClipboardError={onClipboardError}
          />
        ),
      )}
    </scrollbox>
  )
}
