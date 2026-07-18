import type { ConversationMessage } from '../../conversation/conversation-types'
import { summarizeToolEvent } from '../../lib/toolSummaries'

/** Spinner characters shown while a tool call is in the "started" state. */
export const toolMessageRunningFrames = ['-', '\\', '|', '/'] as const

/** Interval (ms) between spinner frame updates. */
export const toolMessageRunningIntervalMs = 120

type ToolMessageLineKind = 'normal' | 'context' | 'added' | 'removed'

interface DiffPreviewRow {
  lineNumber: number
  kind: Extract<ToolMessageLineKind, 'context' | 'added' | 'removed'>
  content: string
}

interface DiffFilePreview {
  path: string
  additions: number
  removals: number
  rows: DiffPreviewRow[]
}

export interface ToolMessagePresentationLine {
  text: string
  kind: ToolMessageLineKind
}

export interface ToolMessagePresentation {
  indicator: string | null
  heading: string
  detailLines: ToolMessagePresentationLine[]
}

function formatToolStatus(value?: 'started' | 'completed' | 'failed' | 'cancelled'): string | null {
  switch (value) {
    case 'started':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return null
  }
}

function getRunningIndicator(frameIndex: number): string {
  const frameCount = toolMessageRunningFrames.length
  const normalizedIndex = ((frameIndex % frameCount) + frameCount) % frameCount
  return toolMessageRunningFrames[normalizedIndex] ?? toolMessageRunningFrames[0]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function formatPath(value: unknown): string | null {
  const raw = asString(value)
  return raw ? raw.replace(/\\/g, '/') : null
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

function normalizeDiffPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/dev/null') {
    return null
  }
  return trimmed.replace(/^[ab]\//, '').replace(/\\/g, '/')
}

function parseHunkHeader(line: string): { oldLine: number; newLine: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) {
    return null
  }

  return {
    oldLine: Number.parseInt(match[1] ?? '1', 10),
    newLine: Number.parseInt(match[2] ?? '1', 10),
  }
}

function parseDiffPreviewFiles(diff: string, fallbackPath: string | null): DiffFilePreview[] {
  const files: DiffFilePreview[] = []
  let current: DiffFilePreview | null = null
  let oldLine: number | null = null
  let newLine: number | null = null

  const ensureCurrent = () => {
    if (!current) {
      current = { path: fallbackPath ?? 'file', additions: 0, removals: 0, rows: [] }
      files.push(current)
    }
    return current
  }

  for (const line of diff.split(/\r?\n/)) {
    const gitHeader = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/)
    if (gitHeader) {
      current = {
        path: normalizeDiffPath(gitHeader[2] ?? '') ?? normalizeDiffPath(gitHeader[1] ?? '') ?? fallbackPath ?? 'file',
        additions: 0,
        removals: 0,
        rows: [],
      }
      files.push(current)
      oldLine = null
      newLine = null
      continue
    }

    if (line.startsWith('+++ ')) {
      const parsedPath = normalizeDiffPath(line.slice(4))
      if (parsedPath) {
        ensureCurrent().path = parsedPath
      }
      continue
    }

    const hunk = parseHunkHeader(line)
    if (hunk) {
      ensureCurrent()
      oldLine = hunk.oldLine
      newLine = hunk.newLine
      continue
    }

    if (!current || oldLine === null || newLine === null || line.startsWith('\\')) {
      continue
    }

    if (line.startsWith('+')) {
      current.additions += 1
      current.rows.push({ lineNumber: newLine, kind: 'added', content: line.slice(1) })
      newLine += 1
      continue
    }

    if (line.startsWith('-')) {
      current.removals += 1
      current.rows.push({ lineNumber: oldLine, kind: 'removed', content: line.slice(1) })
      oldLine += 1
      continue
    }

    if (line.startsWith(' ')) {
      current.rows.push({ lineNumber: newLine, kind: 'context', content: line.slice(1) })
      oldLine += 1
      newLine += 1
    }
  }

  return files.filter((file) => file.additions > 0 || file.removals > 0)
}

function selectPreviewRows(rows: readonly DiffPreviewRow[]): DiffPreviewRow[] {
  const firstChangeIndex = rows.findIndex((row) => row.kind !== 'context')
  if (firstChangeIndex < 0) {
    return []
  }

  let lastChangeIndex = firstChangeIndex
  while (lastChangeIndex + 1 < rows.length && rows[lastChangeIndex + 1]?.kind !== 'context') {
    lastChangeIndex += 1
  }

  const start = Math.max(0, firstChangeIndex - 1)
  const end = Math.min(rows.length, lastChangeIndex + 2)
  return rows.slice(start, end)
}

function formatDiffRows(rows: readonly DiffPreviewRow[]): ToolMessagePresentationLine[] {
  if (rows.length === 0) {
    return []
  }

  const lineNumberWidth = Math.max(2, ...rows.map((row) => String(row.lineNumber).length))
  return rows.map((row) => {
    const marker = row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '
    return {
      kind: row.kind,
      text: `    ${String(row.lineNumber).padStart(lineNumberWidth, ' ')} ${marker}${row.content}`,
    }
  })
}

function extractChangePreview(message: ConversationMessage): {
  heading: string
  lines: ToolMessagePresentationLine[]
} | null {
  const toolName = message.metadata?.toolName
  if (toolName !== 'write' && toolName !== 'writeFile' && toolName !== 'edit' && toolName !== 'editFile' && toolName !== 'patchFile') {
    return null
  }

  const args = asRecord(message.metadata?.toolArgs)
  const result = asRecord(message.metadata?.toolResult)
  const embeddedDiff = parseEmbeddedDiff(message.metadata?.toolResult)
  const fallbackPath = formatPath(args?.path)
  const diff =
    toolName === 'patchFile' && typeof args?.patch === 'string'
      ? args.patch
      : embeddedDiff?.diff ?? (typeof result?.diff === 'string' ? result.diff : null)

  if (!diff?.trim()) {
    return null
  }

  const files = parseDiffPreviewFiles(diff, fallbackPath)
  const additions = files.reduce((total, file) => total + file.additions, 0)
  const removals = files.reduce((total, file) => total + file.removals, 0)
  const firstFile = files[0]

  if (!firstFile) {
    return null
  }

  const target = files.length === 1 ? firstFile.path : `${files.length} files`
  const previewRows = selectPreviewRows(firstFile.rows)

  return {
    heading: `Edited ${target} (+${additions} -${removals})`,
    lines: formatDiffRows(previewRows),
  }
}

function getToolActionVerb(toolName: string): string {
  switch (toolName) {
    case 'read':
    case 'readFile':
    case 'readTaskOutput':
    case 'read-mcp-resource':
      return 'Explored'
    case 'glob':
    case 'globFiles':
    case 'grep':
    case 'grepFiles':
    case 'searchFiles':
      return 'Explored'
    case 'write':
    case 'writeFile':
    case 'edit':
    case 'editFile':
    case 'patchFile':
    case 'writeMemory':
    case 'add-mcp-server':
    case 'remove-mcp-server':
    case 'toggle-mcp-server':
      return 'Edited'
    case 'listTasks':
    case 'getTaskStatus':
    case 'waitForTasks':
    case 'list-mcp-resources':
    case 'list-mcp-tools':
    case 'list-mcp-servers':
      return 'Explored'
    case 'bash':
    case 'executeShell':
    case 'slashCommand':
    case 'workflow':
    case 'call-mcp-tool':
      return 'Ran'
    case 'activateSkill':
      return 'Activated'
    case 'spawnAgent':
    case 'runAgents':
      return 'Delegated'
    case 'cancelTask':
      return 'Canceled'
    default:
      return 'Used'
  }
}

function getExploredDetail(toolName: string, args: Record<string, unknown> | null): string | null {
  switch (toolName) {
    case 'read':
    case 'readFile':
      return `Read ${formatPath(args?.path) ?? 'file'}`
    case 'readTaskOutput':
      return `Read ${asString(args?.taskId) ?? 'task output'}`
    case 'read-mcp-resource':
      return `Read ${asString(args?.uri) ?? 'resource'}`
    case 'glob':
    case 'globFiles':
      return `Matched ${asString(args?.pattern) ?? 'files'}`
    case 'grep':
    case 'grepFiles':
    case 'searchFiles':
      return `Searched ${asString(args?.pattern) ?? 'files'}`
    case 'listTasks':
      return 'Listed tasks'
    case 'getTaskStatus':
      return `Checked ${asString(args?.taskId) ?? 'task'}`
    case 'waitForTasks':
      return Array.isArray(args?.taskIds) ? `Waited for ${args.taskIds.length} tasks` : 'Waited for tasks'
    case 'list-mcp-resources':
      return 'Listed MCP resources'
    case 'list-mcp-tools':
      return 'Listed MCP tools'
    case 'list-mcp-servers':
      return 'Listed MCP servers'
    default:
      return null
  }
}

function extractSkillDirectory(output: unknown): string | null {
  if (typeof output !== 'string') {
    return null
  }

  const match = output.match(/^Skill directory:\s*(.+)$/m)
  return formatPath(match?.[1])
}

/**
 * Render a structured status block for a tool message in the REPL.
 * Normal mode uses this for the compact bullet/tree presentation.
 */
export function formatToolMessagePresentation(
  message: ConversationMessage,
  animationFrame = 0,
): ToolMessagePresentation {
  const toolName = message.metadata?.toolName ?? 'tool'
  const toolStatus = formatToolStatus(message.metadata?.toolStatus) ?? 'done'
  const args = asRecord(message.metadata?.toolArgs)

  if (toolStatus === 'done') {
    const changePreview = extractChangePreview(message)
    if (changePreview) {
      return {
        indicator: null,
        heading: changePreview.heading,
        detailLines: changePreview.lines,
      }
    }
  }

  const summary = summarizeToolEvent({
    toolName,
    status: message.metadata?.toolStatus,
    args: message.metadata?.toolArgs,
    result: message.metadata?.toolResult,
    artifactPath: message.metadata?.toolArtifactPath,
  })

  const detail = summary.detail ?? summary.headline ?? toolName
  const action = getToolActionVerb(toolName)
  const exploredDetail = action === 'Explored' ? getExploredDetail(toolName, args) : null
  if (toolName === 'activateSkill') {
    const skillDirectory = extractSkillDirectory(message.metadata?.toolResult)
    return {
      indicator: toolStatus === 'running' ? getRunningIndicator(animationFrame) : null,
      heading: summary.headline,
      detailLines: skillDirectory ? [{ text: `  └ ${skillDirectory}`, kind: 'normal' }] : [],
    }
  }

  if (toolStatus === 'failed') {
    return {
      indicator: null,
      heading: summary.detail ? `${summary.headline} ${summary.detail}` : summary.headline,
      detailLines: summary.note ? [{ text: `  └ ${summary.note}`, kind: 'normal' }] : [],
    }
  }

  if (toolStatus === 'cancelled') {
    // A cancelled tool must not render identically to a completed one: mark
    // the heading so it stays visible (and ungrouped) in the conversation.
    return {
      indicator: null,
      heading: `${action === 'Explored' ? 'Explored' : `${action} ${detail}`} (cancelled)`,
      detailLines: exploredDetail ? [{ text: `  └ ${exploredDetail}`, kind: 'normal' }] : [],
    }
  }

  return {
    indicator: toolStatus === 'running' ? getRunningIndicator(animationFrame) : null,
    heading: action === 'Explored' ? 'Explored' : `${action} ${detail}`,
    detailLines: exploredDetail ? [{ text: `  └ ${exploredDetail}`, kind: 'normal' }] : [],
  }
}

/**
 * Compatibility helper for tests and any callers that only need the first line.
 */
export function formatToolMessageLine(
  message: ConversationMessage,
  animationFrame = 0,
): { indicator: string | null; text: string } {
  const presentation = formatToolMessagePresentation(message, animationFrame)
  return {
    indicator: presentation.indicator,
    text: `• ${presentation.heading}`,
  }
}
