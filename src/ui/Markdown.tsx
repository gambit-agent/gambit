import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { TextAttributes } from '@opentui/core'
import { marked, type Token, type Tokens } from 'marked'

import { layout, theme } from './theme'

marked.use({
  gfm: true,
  breaks: true,
})

interface MarkdownProps {
  content: string
  textColor?: string
  strongColor?: string
}

interface RenderOptions {
  textColor: string
  strongColor: string
}

const HORIZONTAL_RULE = '─'.repeat(40)

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

function renderTable(token: Tokens.Table, key: string): ReactNode {
  const headerRow = token.header.map((cell) => cell.text)
  const dataRows = token.rows.map((row) => row.map((cell) => cell.text))

  const columnWidths = headerRow.map((cell, index) => {
    const dataWidth = Math.max(...dataRows.map((row) => row[index]?.length ?? 0))
    return Math.max(cell.length, dataWidth)
  })

  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => {
        const width = columnWidths[index] ?? cell.length
        return cell.padEnd(width, ' ')
      })
      .join(' │ ')

  const lines = [
    formatRow(headerRow),
    columnWidths.map((width) => '─'.repeat(width)).join('─┼─'),
    ...dataRows.map(formatRow),
  ]

  return (
    <box
      key={key}
      flexDirection="column"
      gap={0}
      style={{
        border: ['left'],
        borderColor: theme.divider,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.tableBg,
      }}
    >
      {lines.map((line, index) => (
        <text selectable key={`${key}-line-${index}`} content={line.length > 0 ? line : ' '} fg={theme.tableFg} />
      ))}
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
        elements.push(renderTable(token as Tokens.Table, key))
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

export function Markdown({ content, textColor, strongColor }: MarkdownProps) {
  const sanitizedContent = content.trimEnd()
  const tokens = useMemo(() => marked.lexer(sanitizedContent), [sanitizedContent])
  const resolvedColor = textColor ?? theme.assistantFg

  if (!tokens.length) {
    return <text selectable fg={resolvedColor} content={content.length ? content : ' '} />
  }

  return (
    <box flexDirection="column" gap={layout.markdownBlockGap}>
      {renderBlocks(tokens, 'md', 0, {
        textColor: resolvedColor,
        strongColor: strongColor ?? theme.responseStrongFg,
      })}
    </box>
  )
}
