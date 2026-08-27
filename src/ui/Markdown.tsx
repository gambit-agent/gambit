import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/react'
import { marked, type Token, type Tokens } from 'marked'

import {
  buildBorderLine,
  buildRowLines,
  layoutMarkdownTable,
  type ColumnAlign,
} from './markdown-table'
import { isMermaidLanguage, renderMermaid } from './mermaid'
import { layout, theme } from './theme'

marked.use({
  gfm: true,
  breaks: true,
})

interface MarkdownProps {
  content: string
  textColor?: string
  strongColor?: string
  /**
   * Columns available to block content. Defaults to the terminal width less
   * the conversation's own padding; diagrams need it to decide whether they
   * fit or must fall back to source.
   */
  availableWidth?: number
}

interface RenderOptions {
  textColor: string
  strongColor: string
  availableWidth: number
}

const HORIZONTAL_RULE = '─'.repeat(40)
/** Screen padding plus message padding on both sides of a rendered block. */
const CONVERSATION_CHROME_WIDTH = (layout.screenPadding + layout.messagePaddingX) * 2
const headingSizeToAttributes: Record<number, number> = {
  1: TextAttributes.BOLD,
  2: TextAttributes.BOLD,
  3: TextAttributes.BOLD,
  4: TextAttributes.BOLD,
  5: TextAttributes.BOLD,
  6: TextAttributes.BOLD,
}

type InlineNode = ReactNode

function renderPlainText(text: string): InlineNode[] {
  if (!text.includes('\n')) {
    return [text]
  }

  const nodes: InlineNode[] = []
  const parts = text.split(/\n/g)
  parts.forEach((part, index) => {
    if (index > 0) {
      nodes.push('\n')
    }
    if (part.length > 0) {
      nodes.push(part)
    }
  })
  return nodes
}

function renderInline(tokens: Token[] | undefined, keyPrefix: string, options: RenderOptions): InlineNode[] {
  if (!tokens?.length) {
    return []
  }

  const nodes: InlineNode[] = []

  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-inline-${index}`

    switch (token.type) {
      case 'text':
      case 'escape': {
        nodes.push(...renderPlainText(token.text))
        break
      }
      case 'strong': {
        nodes.push(
          <span key={key} fg={options.strongColor}>
            <b>{renderInline(token.tokens, key, options)}</b>
          </span>,
        )
        break
      }
      case 'em': {
        nodes.push(<i key={key}>{renderInline(token.tokens, key, options)}</i>)
        break
      }
      case 'del': {
        nodes.push(
          <span key={key} attributes={TextAttributes.STRIKETHROUGH}>
            {renderInline(token.tokens, key, options)}
          </span>,
        )
        break
      }
      case 'codespan': {
        nodes.push(
          <span
            key={key}
            bg={theme.codeInlineBg}
            fg={theme.codeInlineFg}
          >
            {token.text}
          </span>,
        )
        break
      }
      case 'br': {
        nodes.push('\n')
        break
      }
      case 'link': {
        const children = token.tokens?.length ? renderInline(token.tokens, key, options) : renderPlainText(token.text)
        nodes.push(
          <span key={key} fg={theme.linkFg} attributes={TextAttributes.UNDERLINE}>
            {children}
          </span>,
        )
        if (token.href) {
          nodes.push(
            <span key={`${key}-href`} fg={theme.linkSecondaryFg} attributes={TextAttributes.DIM}>
              {` <${token.href}>`}
            </span>,
          )
        }
        break
      }
      case 'image': {
        const alt = token.text || 'image'
        nodes.push(
          <span key={key} attributes={TextAttributes.DIM}>
            {`[${alt}]`}
          </span>,
        )
        break
      }
      default:
        if ('tokens' in token && token.tokens) {
          nodes.push(...renderInline(token.tokens, key, options))
        } else if (token.raw) {
          nodes.push(token.raw)
        }
    }
  })

  return nodes
}

function toColumnAlign(value: string | null | undefined): ColumnAlign {
  return value === 'center' || value === 'right' ? value : 'left'
}

/**
 * Flatten a table cell's inline tokens to plain text. The token's own `text`
 * still carries markdown syntax, so a cell holding `` `~/.gambit/` `` would
 * otherwise render with its backticks visible.
 */
function cellPlainText(cell: Tokens.TableCell): string {
  const collect = (tokens: Token[] | undefined): string => {
    if (!tokens?.length) {
      return ''
    }
    return tokens
      .map((token) => {
        if (token.type === 'br') {
          return ' '
        }
        if ('tokens' in token && token.tokens?.length) {
          return collect(token.tokens as Token[])
        }
        return (token as { text?: string }).text ?? token.raw ?? ''
      })
      .join('')
  }

  const flattened = collect(cell.tokens as Token[] | undefined)
  return (flattened || cell.text).replace(/\s+/gu, ' ').trim()
}

/**
 * Draw a GFM table with the same `<box>`/`<text>` primitives as every other
 * block. Cells are rendered as plain text: wrapping styled inline spans across
 * lines is not worth the complexity here, and the header carries the emphasis.
 */
function renderTable(token: Tokens.Table, key: string, options: RenderOptions): ReactNode {
  const header = token.header.map(cellPlainText)
  const rows = token.rows.map((row) => row.map(cellPlainText))
  const aligns = token.align.map(toColumnAlign)

  const layout = layoutMarkdownTable(header, rows, aligns, options.availableWidth)
  const { columnWidths, aligns: resolvedAligns } = layout

  const line = (content: string, lineKey: string, bold = false): ReactNode => (
    <text
      selectable
      key={lineKey}
      content={content}
      fg={bold ? theme.headingFg : theme.tableFg}
      attributes={bold ? TextAttributes.BOLD : undefined}
    />
  )

  const elements: ReactNode[] = [line(buildBorderLine(columnWidths, 'top'), `${key}-top`)]

  buildRowLines(layout.header, columnWidths, resolvedAligns).forEach((rowLine, index) => {
    elements.push(line(rowLine, `${key}-header-${index}`, true))
  })
  elements.push(line(buildBorderLine(columnWidths, 'middle'), `${key}-header-rule`))

  layout.rows.forEach((row, rowIndex) => {
    buildRowLines(row, columnWidths, resolvedAligns).forEach((rowLine, index) => {
      elements.push(line(rowLine, `${key}-row-${rowIndex}-${index}`))
    })
  })

  elements.push(line(buildBorderLine(columnWidths, 'bottom'), `${key}-bottom`))

  return (
    <box key={key} flexDirection="column" gap={0}>
      {elements}
    </box>
  )
}

function renderListItem(
  item: Tokens.ListItem,
  key: string,
  symbol: string,
  depth: number,
  options: RenderOptions,
): ReactNode {
  let inlineTokens: Token[] | undefined
  const nestedTokens: Token[] = []

  for (const child of item.tokens) {
    if (!inlineTokens && (child.type === 'text' || child.type === 'paragraph')) {
      inlineTokens = child.type === 'paragraph' ? child.tokens : child.tokens ?? [child]
      continue
    }
    nestedTokens.push(child)
  }

  const inlineContent = inlineTokens?.length ? renderInline(inlineTokens, `${key}-inline`, options) : []
  const nestedContent = nestedTokens.length ? (
    <box flexDirection="column" gap={layout.markdownBlockGap}>
      {renderBlocks(nestedTokens, `${key}-nested`, depth + 1, options)}
    </box>
  ) : null

  return (
    <box key={key} flexDirection="row" gap={1} alignItems="flex-start">
      <text selectable content={symbol} fg={theme.listBulletFg} attributes={TextAttributes.BOLD} />
      <box flexDirection="column" gap={nestedContent ? layout.markdownBlockGap : 0} flexGrow={1}>
        {inlineContent.length ? <text selectable fg={options.textColor}>{inlineContent}</text> : null}
        {nestedContent}
      </box>
    </box>
  )
}

function renderBlocks(
  tokens: Token[] | undefined,
  keyPrefix: string,
  depth: number,
  options: RenderOptions,
): ReactNode[] {
  if (!tokens?.length) {
    return []
  }

  const elements: ReactNode[] = []

  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-block-${index}`

    switch (token.type) {
      case 'space': {
        break
      }
      case 'paragraph': {
        elements.push(
          <text selectable key={key} fg={options.textColor}>
            {renderInline(token.tokens, key, options)}
          </text>,
        )
        break
      }
      case 'heading': {
        const attributes = headingSizeToAttributes[token.depth] ?? TextAttributes.BOLD
        elements.push(
          <text selectable key={key} attributes={attributes} fg={theme.headingFg}>
            {renderInline(token.tokens, key, options)}
          </text>,
        )
        break
      }
      case 'code': {
        // Mermaid blocks are drawn as diagrams when they fit; anything we
        // cannot draw falls through to the normal code block below, so the
        // source is always still readable.
        if (isMermaidLanguage(token.lang)) {
          const diagram = renderMermaid(token.text, options.availableWidth)
          if (diagram) {
            elements.push(
              <box
                key={key}
                flexDirection="column"
                gap={0}
                style={{
                  border: ['left'],
                  borderColor: theme.codeBlockBorder,
                  paddingLeft: 1,
                  paddingRight: 1,
                }}
              >
                {diagram.map((line: string, lineIndex: number) => (
                  <text
                    selectable
                    key={`${key}-diagram-${lineIndex}`}
                    content={line.length > 0 ? line : ' '}
                    fg={theme.tableFg}
                  />
                ))}
              </box>,
            )
            break
          }
        }

        const lines = token.text.replace(/\n$/u, '').split('\n')
        elements.push(
          <box
            key={key}
            flexDirection="column"
            gap={0}
            style={{
              border: ['left'],
              borderColor: theme.codeBlockBorder,
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: theme.codeBlockBg,
            }}
          >
            {token.lang ? (
              <text selectable fg={theme.codeBlockAccent} attributes={TextAttributes.BOLD} content={`// ${token.lang}`} />
            ) : null}
            {lines.map((line: string, lineIndex: number) => (
              <text selectable key={`${key}-line-${lineIndex}`} content={line.length > 0 ? line : ' '} fg={theme.codeBlockFg} />
            ))}
          </box>,
        )
        break
      }
      case 'blockquote': {
        const blockquoteToken = token as Tokens.Blockquote
        elements.push(
          <box
            key={key}
            flexDirection="column"
            gap={layout.markdownBlockGap}
            style={{
              border: ['left'],
              borderColor: theme.blockquoteBorder,
              paddingLeft: 2,
              backgroundColor: theme.blockquoteBg,
            }}
          >
            {renderBlocks(blockquoteToken.tokens, `${key}-quote`, depth + 1, options)}
          </box>,
        )
        break
      }
      case 'list': {
        const listToken = token as Tokens.List
        const start = listToken.start === '' ? 1 : Number(listToken.start || 1)
        const symbols = listToken.items.map((item: Tokens.ListItem, itemIndex: number) =>
          item.task ? (item.checked ? '[x]' : '[ ]') : listToken.ordered ? `${start + itemIndex}.` : '•',
        )

        elements.push(
          <box key={key} flexDirection="column" gap={0} style={{ paddingLeft: depth > 0 ? 2 : 0 }}>
            {listToken.items.map((item: Tokens.ListItem, itemIndex: number) =>
              renderListItem(item, `${key}-item-${itemIndex}`, symbols[itemIndex] ?? '•', depth, options),
            )}
          </box>,
        )
        break
      }
      case 'hr': {
        elements.push(
          <text selectable key={key} fg={theme.divider} attributes={TextAttributes.DIM} content={HORIZONTAL_RULE} />,
        )
        break
      }
      case 'table': {
        elements.push(renderTable(token as Tokens.Table, key, options))
        break
      }
      case 'html':
      case 'tag': {
        elements.push(
          <text selectable key={key} fg={options.textColor}>
            {token.text ?? token.raw}
          </text>,
        )
        break
      }
      case 'text': {
        const inlineTokens = token.tokens?.length ? token.tokens : [token]
        elements.push(
          <text selectable key={key} fg={options.textColor}>
            {renderInline(inlineTokens, key, options)}
          </text>,
        )
        break
      }
      default: {
        elements.push(
          <text selectable key={key} fg={options.textColor}>
            {token.raw ?? ''}
          </text>,
        )
      }
    }
  })

  return elements
}

export function Markdown({ content, textColor, strongColor, availableWidth }: MarkdownProps) {
  const sanitizedContent = content.trimEnd()
  const tokens = useMemo(() => marked.lexer(sanitizedContent), [sanitizedContent])
  const { width: terminalWidth } = useTerminalDimensions()
  const resolvedColor = textColor ?? theme.assistantFg
  const resolvedStrongColor = strongColor ?? theme.responseStrongFg
  const resolvedWidth = Math.max(0, availableWidth ?? terminalWidth - CONVERSATION_CHROME_WIDTH)
  const renderedBlocks = useMemo(
    () =>
      renderBlocks(tokens, 'md', 0, {
        textColor: resolvedColor,
        strongColor: resolvedStrongColor,
        availableWidth: resolvedWidth,
      }),
    [resolvedColor, resolvedStrongColor, resolvedWidth, tokens],
  )

  if (!tokens.length) {
    return <text selectable fg={resolvedColor} content={content.length ? content : ' '} />
  }

  return (
    <box flexDirection="column" gap={layout.markdownBlockGap}>
      {renderedBlocks}
    </box>
  )
}
