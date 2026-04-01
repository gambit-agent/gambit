import path from 'node:path'

import { relativeWorkspacePath } from './workspace'
import type { ToolEventPayload, ToolEventStatus } from '../types/tools'
import type { SlashCommandExecution } from './slashCommands'

const MAX_DETAIL_CHARS = 120

interface ToolSummaryParts {
  headline: string
  detail?: string
  note?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function formatPath(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) {
    return null
  }

  if (path.isAbsolute(raw)) {
    try {
      return toPosix(relativeWorkspacePath(raw))
    } catch {
      return toPosix(raw)
    }
  }

  return toPosix(raw)
}

function formatInlineText(value: unknown, maxChars = MAX_DETAIL_CHARS): string | null {
  const raw = asString(value)
  if (!raw) {
    return null
  }

  const compact = raw.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxChars) {
    return compact
  }

  return `${compact.slice(0, maxChars - 1)}…`
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0
  }

  return text.split(/\r?\n/).length
}

function formatTextStats(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const charsLabel = `${value.length} chars`
  const lineCount = countLines(value)
  if (lineCount <= 0) {
    return charsLabel
  }

  return `${charsLabel} · ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`
}

function firstUsefulLine(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && !trimmed.endsWith('<empty>')) {
      return formatInlineText(trimmed, 160)
    }
  }

  return null
}

function extractTextOutput(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  const record = asRecord(value)
  if (!record) {
    return null
  }

  const type = asString(record.type)
  if ((type === 'text' || type === 'error-text') && typeof record.value === 'string') {
    return record.value
  }

  return null
}

function parseShellOutput(value: unknown): { exitCode?: number; stdout?: string; stderr?: string } {
  const text = extractTextOutput(value)
  if (!text) {
    return {}
  }

  const exitMatch = text.match(/(?:^|\n)exit_code:\s*(-?\d+)/)
  const stdoutMatch = text.match(/(?:^|\n)stdout:\n([\s\S]*?)(?:\n\nstderr:|$)/)
  const stderrMatch = text.match(/(?:^|\n)stderr:\n([\s\S]*)$/)

  return {
    exitCode: exitMatch ? Number.parseInt(exitMatch[1] ?? '', 10) : undefined,
    stdout: stdoutMatch?.[1]?.trim(),
    stderr: stderrMatch?.[1]?.trim(),
  }
}

function formatSlashCommandName(value: unknown): string | null {
  const name = asString(value)
  if (!name) {
    return null
  }

  return name.startsWith('/') ? name : `/${name}`
}

function summarizeReadFile(input: unknown, output: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const filePath = formatPath(args?.path) ?? 'file'
  const stats = formatTextStats(extractTextOutput(output))

  return {
    headline: 'Read file',
    detail: stats ? `${filePath} · ${stats}` : filePath,
  }
}

function summarizeWriteFile(input: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const filePath = formatPath(args?.path) ?? 'file'
  const stats = formatTextStats(typeof args?.content === 'string' ? args.content : null)

  return {
    headline: 'Wrote file',
    detail: stats ? `${filePath} · ${stats}` : filePath,
  }
}

function summarizePatchResult(output: unknown): ToolSummaryParts {
  const text = extractTextOutput(output)
  if (!text) {
    return { headline: 'Applied patch' }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return { headline: 'Applied patch' }
  }

  if (lines.length === 1) {
    return { headline: lines[0] ?? 'Applied patch' }
  }

  return {
    headline: `Patched ${lines.length} files`,
    detail: formatInlineText(lines[0]) ?? undefined,
    note: lines.length > 1 ? `+${lines.length - 1} more changes` : undefined,
  }
}

function summarizeShell(input: unknown, output: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const command = formatInlineText(args?.command) ?? 'command'
  const parsed = parseShellOutput(output)
  const errorPreview = parsed.exitCode && parsed.exitCode !== 0 ? firstUsefulLine(parsed.stderr ?? parsed.stdout) : null

  return {
    headline:
      parsed.exitCode === undefined
        ? 'Command completed'
        : parsed.exitCode === 0
          ? 'Command completed · exit 0'
          : `Command exited · ${parsed.exitCode}`,
    detail: command,
    note: errorPreview ?? undefined,
  }
}

function summarizeSlashCommand(input: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const name = formatSlashCommandName(args?.name) ?? '/command'
  const commandArgs = formatInlineText(args?.arguments)

  return {
    headline: `Ran ${name}`,
    detail: commandArgs ?? undefined,
  }
}

function summarizeReadTaskOutput(input: unknown, output: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const taskId = formatInlineText(args?.taskId, 40) ?? 'task'
  const stats = formatTextStats(extractTextOutput(output))

  return {
    headline: 'Read task output',
    detail: stats ? `${taskId} · ${stats}` : taskId,
  }
}

function summarizeWriteMemory(input: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const memoryType = asString(args?.type) ?? 'memory'
  const name = formatInlineText(args?.name)

  return {
    headline: `Saved ${memoryType} memory`,
    detail: name ?? undefined,
  }
}

function summarizeSpawnAgent(input: unknown, output: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const role = asString(args?.role) ?? 'agent'
  const firstLine = firstUsefulLine(extractTextOutput(output))
  const detail = formatInlineText(args?.description) ?? formatInlineText(args?.prompt)

  return {
    headline: firstLine ?? `Spawned ${role} agent`,
    detail: detail ?? undefined,
  }
}

function summarizeSlashCommandExecution(result: SlashCommandExecution, input: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const name = formatSlashCommandName(args?.name ?? result.command) ?? '/command'
  const commandArgs = formatInlineText(args?.arguments ?? result.arguments)

  return {
    headline: `Ran ${name}`,
    detail: commandArgs ?? undefined,
  }
}

function summarizeGenericCompletion(toolName: string, input: unknown, output: unknown): ToolSummaryParts {
  const toolLabel = formatInlineText(toolName) ?? 'tool'
  const textOutput = extractTextOutput(output)
  const inputPath = formatPath(asRecord(input)?.path)
  const detail = inputPath ?? firstUsefulLine(textOutput)

  return {
    headline: `${toolLabel} completed`,
    detail: detail ?? undefined,
  }
}

function summarizeFailure(toolName: string, input: unknown, output: unknown): ToolSummaryParts {
  const args = asRecord(input)
  const detail =
    formatPath(args?.path) ??
    formatInlineText(args?.command) ??
    formatInlineText(args?.name) ??
    formatInlineText(args?.taskId)

  return {
    headline: `${toolName} failed`,
    detail: detail ?? undefined,
    note: firstUsefulLine(extractTextOutput(output)) ?? undefined,
  }
}

function summarizeStarted(toolName: string, input: unknown): ToolSummaryParts {
  const args = asRecord(input)

  switch (toolName) {
    case 'readFile':
      return { headline: 'Reading file', detail: formatPath(args?.path) ?? 'file' }
    case 'writeFile':
      return { headline: 'Writing file', detail: formatPath(args?.path) ?? 'file' }
    case 'patchFile':
      return { headline: 'Applying patch', detail: formatPath(args?.path) ?? 'multiple files' }
    case 'executeShell':
      return { headline: 'Running command', detail: formatInlineText(args?.command) ?? 'command' }
    case 'slashCommand':
      return {
        headline: `Running ${formatSlashCommandName(args?.name) ?? '/command'}`,
        detail: formatInlineText(args?.arguments) ?? undefined,
      }
    case 'spawnAgent':
      return {
        headline: `Spawning ${asString(args?.role) ?? 'agent'} agent`,
        detail: formatInlineText(args?.description) ?? formatInlineText(args?.prompt) ?? undefined,
      }
    case 'readTaskOutput':
      return { headline: 'Reading task output', detail: formatInlineText(args?.taskId, 40) ?? 'task' }
    case 'writeMemory':
      return {
        headline: `Saving ${asString(args?.type) ?? 'memory'} memory`,
        detail: formatInlineText(args?.name) ?? undefined,
      }
    default:
      return { headline: `Running ${toolName}` }
  }
}

function withArtifactNote(parts: ToolSummaryParts, artifactPath?: string): ToolSummaryParts {
  const resolvedArtifactPath = formatPath(artifactPath)
  if (!resolvedArtifactPath) {
    return parts
  }

  return {
    ...parts,
    note: parts.note ?? `Stored full output in ${resolvedArtifactPath}`,
  }
}

export function summarizeToolCompletion(
  toolName: string,
  input: unknown,
  output: unknown,
  options: { artifactPath?: string; status?: Exclude<ToolEventStatus, 'started'> } = {},
): ToolSummaryParts {
  const status = options.status ?? 'completed'

  if (status === 'failed') {
    return withArtifactNote(summarizeFailure(toolName, input, output), options.artifactPath)
  }

  if (toolName === 'readFile') {
    return withArtifactNote(summarizeReadFile(input, output), options.artifactPath)
  }

  if (toolName === 'writeFile') {
    return withArtifactNote(summarizeWriteFile(input), options.artifactPath)
  }

  if (toolName === 'patchFile') {
    return withArtifactNote(summarizePatchResult(output), options.artifactPath)
  }

  if (toolName === 'executeShell') {
    return withArtifactNote(summarizeShell(input, output), options.artifactPath)
  }

  if (toolName === 'slashCommand') {
    const execution = asRecord(output) as SlashCommandExecution | null
    if (execution && typeof execution.command === 'string') {
      return withArtifactNote(summarizeSlashCommandExecution(execution, input), options.artifactPath)
    }
    return withArtifactNote(summarizeSlashCommand(input), options.artifactPath)
  }

  if (toolName === 'spawnAgent') {
    return withArtifactNote(summarizeSpawnAgent(input, output), options.artifactPath)
  }

  if (toolName === 'readTaskOutput') {
    return withArtifactNote(summarizeReadTaskOutput(input, output), options.artifactPath)
  }

  if (toolName === 'writeMemory') {
    return withArtifactNote(summarizeWriteMemory(input), options.artifactPath)
  }

  return withArtifactNote(summarizeGenericCompletion(toolName, input, output), options.artifactPath)
}

export function summarizeToolEvent(event: ToolEventPayload): ToolSummaryParts {
  const toolName = String(event.toolName ?? event.name ?? 'tool')
  const status = event.status ?? (event.result !== undefined || event.output !== undefined ? 'completed' : 'started')

  if (status === 'started') {
    return summarizeStarted(toolName, event.args ?? event.arguments ?? {})
  }

  return summarizeToolCompletion(toolName, event.args ?? event.arguments ?? {}, event.result ?? event.output, {
    artifactPath: event.artifactPath,
    status,
  })
}

export function formatToolSummary(summary: ToolSummaryParts): string {
  return [summary.headline, summary.detail, summary.note].filter(Boolean).join('\n')
}

export function formatCompactToolSummary(event: ToolEventPayload): string {
  const lines = formatToolSummary(summarizeToolEvent(event))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return ''
  }

  return lines.slice(0, 2).join(' · ')
}

export function formatToolEvent(event: ToolEventPayload): string {
  return formatToolSummary(summarizeToolEvent(event))
}
