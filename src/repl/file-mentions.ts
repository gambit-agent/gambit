import path from 'node:path'

import { workspaceRoot } from '../config'
import { fuzzyFilter } from '../lib/fuzzy'
import { getWorkspaceFiles } from '../lib/workspace-files'

const mentionBoundaryPattern = /[\s([{,;]/
const mentionQueryPattern = /^[A-Za-z0-9._/-]*$/
const mentionTokenPattern = /(^|[\s([{,;])@([A-Za-z0-9._/-]+)/g
const mentionTokenDetectorPattern = /(^|[\s([{,;])@([A-Za-z0-9._/-]+)/
const trailingPunctuationPattern = /[.,;:!?)}\]]+$/
const binaryMarker = '\u0000'

const defaultMaxResults = 20
const defaultMaxFiles = 8
const defaultMaxFileBytes = 24_000
const defaultMaxTotalBytes = 96_000

export interface ActiveFileMention {
  start: number
  end: number
  query: string
}

export interface FileMentionMatch {
  path: string
  score: number
}

export interface ReplaceFileMentionResult {
  value: string
  cursorOffset: number
}

export interface ExpandedFileMention {
  path: string
  content: string
  truncated: boolean
}

export interface FileMentionExpansion {
  content: string
  files: ExpandedFileMention[]
  omitted: string[]
}

export function findActiveFileMention(
  value: string,
  cursorOffset: number = value.length,
): ActiveFileMention | null {
  const boundedOffset = Math.max(0, Math.min(cursorOffset, value.length))
  const beforeCursor = value.slice(0, boundedOffset)
  const atIndex = beforeCursor.lastIndexOf('@')

  if (atIndex === -1) {
    return null
  }

  const previous = atIndex > 0 ? beforeCursor[atIndex - 1] : ''
  if (previous && !mentionBoundaryPattern.test(previous)) {
    return null
  }

  const query = beforeCursor.slice(atIndex + 1)
  if (!mentionQueryPattern.test(query)) {
    return null
  }

  const afterCursor = value.slice(boundedOffset)
  const tokenSuffix = afterCursor.match(/^[^\s]*/)?.[0] ?? ''
  return {
    start: atIndex,
    end: boundedOffset + tokenSuffix.length,
    query,
  }
}

export function replaceActiveFileMention(
  value: string,
  mention: ActiveFileMention,
  filePath: string,
): ReplaceFileMentionResult {
  const token = `@${filePath}`
  const nextChar = value[mention.end] ?? ''
  const suffix = nextChar && /\s/.test(nextChar) ? '' : ' '
  const nextValue = `${value.slice(0, mention.start)}${token}${suffix}${value.slice(mention.end)}`
  return {
    value: nextValue,
    cursorOffset: mention.start + token.length + suffix.length,
  }
}

export async function getFileMentionMatches(
  query: string,
  options: { maxResults?: number } = {},
): Promise<FileMentionMatch[]> {
  const maxResults = options.maxResults ?? defaultMaxResults
  const files = await getWorkspaceFiles()
  const normalizedQuery = normalizeMentionPath(query) ?? ''

  if (!normalizedQuery) {
    return files.slice(0, maxResults).map((filePath) => ({ path: filePath, score: 0 }))
  }

  return fuzzyFilter(normalizedQuery, files, (filePath) => filePath, maxResults)
    .map((result) => ({ path: result.item, score: result.score }))
}

export async function expandFileMentions(
  prompt: string,
  options: {
    rootPath?: string
    workspaceFiles?: readonly string[]
    maxFiles?: number
    maxFileBytes?: number
    maxTotalBytes?: number
  } = {},
): Promise<FileMentionExpansion> {
  if (!mentionTokenDetectorPattern.test(prompt)) {
    return { content: prompt, files: [], omitted: [] }
  }

  const rootPath = options.rootPath ?? workspaceRoot
  const workspaceFiles = options.workspaceFiles ?? (await getWorkspaceFiles())
  const mentionedPaths = collectMentionedFilePaths(prompt, workspaceFiles)

  if (mentionedPaths.length === 0) {
    return { content: prompt, files: [], omitted: [] }
  }

  const maxFiles = options.maxFiles ?? defaultMaxFiles
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes
  const maxTotalBytes = options.maxTotalBytes ?? defaultMaxTotalBytes
  const files: ExpandedFileMention[] = []
  const omitted: string[] = []
  let remainingBytes = maxTotalBytes

  for (const filePath of mentionedPaths) {
    if (files.length >= maxFiles) {
      omitted.push(filePath)
      continue
    }
    if (remainingBytes <= 0) {
      omitted.push(filePath)
      continue
    }

    const absolutePath = path.join(rootPath, filePath)
    const readLimit = Math.min(maxFileBytes, remainingBytes)
    const preview = await readFilePreview(absolutePath, readLimit)

    if (preview.content.includes(binaryMarker)) {
      omitted.push(filePath)
      continue
    }

    files.push({
      path: filePath,
      content: preview.content,
      truncated: preview.truncated,
    })
    remainingBytes -= preview.bytesRead
  }

  if (files.length === 0) {
    return { content: prompt, files, omitted }
  }

  return {
    content: `${prompt.trimEnd()}\n\n${formatFileContext(files, omitted)}`,
    files,
    omitted,
  }
}

function collectMentionedFilePaths(prompt: string, workspaceFiles: readonly string[]): string[] {
  const available = new Set(workspaceFiles)
  const mentioned: string[] = []
  const seen = new Set<string>()

  for (const match of prompt.matchAll(mentionTokenPattern)) {
    const normalized = normalizeMentionPath(trimMentionToken(match[2] ?? ''))
    if (!normalized || !available.has(normalized) || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    mentioned.push(normalized)
  }

  return mentioned
}

function trimMentionToken(token: string): string {
  let current = token
  while (current && trailingPunctuationPattern.test(current)) {
    current = current.replace(trailingPunctuationPattern, '')
  }
  return current
}

function normalizeMentionPath(value: string): string | null {
  const trimmed = value.trim().replace(/^\.?\//, '')
  if (!trimmed || trimmed.includes('\\')) {
    return trimmed || null
  }

  const normalized = path.posix.normalize(trimmed)
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    return null
  }
  return normalized
}

async function readFilePreview(
  filePath: string,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number; truncated: boolean }> {
  const file = Bun.file(filePath)
  const fileSize = file.size
  const bytesToRead = Math.min(fileSize, maxBytes)
  const bytes = await file.slice(0, bytesToRead).bytes()
  return {
    content: Buffer.from(bytes).toString('utf8'),
    bytesRead: bytes.byteLength,
    truncated: fileSize > bytes.byteLength,
  }
}

function formatFileContext(files: readonly ExpandedFileMention[], omitted: readonly string[]): string {
  const lines = [
    'File context from @ mentions:',
    '',
    '<file_context>',
  ]

  for (const file of files) {
    lines.push(
      `<file path="${file.path}">`,
      file.content,
      file.truncated ? '\n[truncated]' : '',
      '</file>',
    )
  }

  if (omitted.length > 0) {
    lines.push(
      '<omitted>',
      omitted.join('\n'),
      '</omitted>',
    )
  }

  lines.push('</file_context>')
  return lines.join('\n')
}
