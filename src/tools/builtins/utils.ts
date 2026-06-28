import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Glob } from 'bun'

import { MAX_AGENT_BATCH_INLINE_OUTPUT_CHARS, MAX_SHELL_OUTPUT, workspaceRoot } from '../../config'
import type { TaskRecord } from '../../tasks/task-types'
import { formatToolSummary, summarizeToolCompletion } from '../../lib/toolSummaries'
import { relativeWorkspacePath, resolveWorkspacePath } from '../../lib/workspace'
import { truncate } from '../../lib/text'

interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
}

const FALLBACK_SEARCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.next',
  '.turbo',
])

let forceRipgrepFallbackForTesting = false

export function summarizeBuiltInToolCompletion(
  toolId: string,
  input: unknown,
  result: unknown,
  artifactPath?: string,
): string {
  return formatToolSummary(summarizeToolCompletion(toolId, input, result, { artifactPath }))
}

export function formatFileChangeResult(message: string, diff: string): string {
  return diff.trim() ? `${message}\n\nDiff:\n\`\`\`diff\n${diff.trimEnd()}\n\`\`\`` : message
}

export function ensureNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${label}" must be a string.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Parameter "${label}" must not be empty.`)
  }

  return trimmed
}

export function setRipgrepFallbackForTesting(enabled: boolean): void {
  forceRipgrepFallbackForTesting = enabled
}

async function runProcess(command: string, cwd: string): Promise<ProcessResult> {
  const process = Bun.spawn(['bash', '-lc', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdoutPromise = process.stdout ? new Response(process.stdout).text() : Promise.resolve('')
  const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve('')
  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, process.exited])
  return { stdout, stderr, exitCode }
}

async function runExecutable(command: string, args: string[], cwd: string): Promise<ProcessResult | null> {
  try {
    const process = Bun.spawn([command, ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdoutPromise = process.stdout ? new Response(process.stdout).text() : Promise.resolve('')
    const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve('')
    const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, process.exited])
    if (exitCode === 127 && /not found|no such file|ENOENT/i.test(stderr)) {
      return null
    }
    return { stdout, stderr, exitCode }
  } catch (error) {
    if (isMissingExecutableError(error)) {
      return null
    }
    throw error
  }
}

function isMissingExecutableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const errorWithCode = error as Error & { code?: string }
  return errorWithCode.code === 'ENOENT' || /not found|no such file|ENOENT/i.test(error.message)
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

function matchesFallbackGlob(relativePath: string, searchPath: string, glob: Glob): boolean {
  const normalizedSearchPath = toPosixPath(searchPath)
  const normalizedRelativePath = toPosixPath(relativePath)
  const searchRelativePath =
    normalizedSearchPath === '.'
      ? normalizedRelativePath
      : path.posix.relative(normalizedSearchPath, normalizedRelativePath)

  return (
    glob.match(normalizedRelativePath)
    || glob.match(searchRelativePath)
    || glob.match(path.posix.basename(normalizedRelativePath))
  )
}

async function collectFallbackSearchFiles(searchPath: string): Promise<string[]> {
  const absoluteSearchPath = path.resolve(workspaceRoot, searchPath)
  const searchStats = await stat(absoluteSearchPath).catch(() => null)
  if (!searchStats) {
    return []
  }

  if (searchStats.isFile()) {
    return [toPosixPath(relativeWorkspacePath(absoluteSearchPath))]
  }
  if (!searchStats.isDirectory()) {
    return []
  }

  const files: string[] = []
  await collectFallbackSearchFilesFromDirectory(absoluteSearchPath, files)
  return files.sort((left, right) => left.localeCompare(right))
}

async function collectFallbackSearchFilesFromDirectory(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (FALLBACK_SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
        continue
      }
      await collectFallbackSearchFilesFromDirectory(absolutePath, files)
      continue
    }
    if (entry.isFile()) {
      files.push(toPosixPath(relativeWorkspacePath(absolutePath)))
    }
  }
}

function compileFallbackSearchPattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid grep pattern: ${message}`)
  }
}

async function runFallbackSearch(input: { pattern: string; searchPath: string; glob?: string }): Promise<string> {
  const regex = compileFallbackSearchPattern(input.pattern)
  const fileGlob = input.glob?.trim() ? new Glob(input.glob.trim()) : null
  const files = await collectFallbackSearchFiles(input.searchPath)
  const matches: string[] = []

  for (const filePath of files) {
    if (fileGlob && !matchesFallbackGlob(filePath, input.searchPath, fileGlob)) {
      continue
    }

    const absolutePath = path.resolve(workspaceRoot, filePath)
    const content = await readFile(absolutePath, 'utf8').catch(() => null)
    if (content === null || content.includes('\0')) {
      continue
    }

    const lines = content.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      regex.lastIndex = 0
      if (regex.test(line)) {
        matches.push(`${filePath}:${index + 1}:${line}`)
      }
    }
  }

  return matches.length > 0 ? truncate(matches.join('\n'), MAX_SHELL_OUTPUT) : 'No matches found.'
}

async function runFallbackGlob(input: { pattern: string; searchPath: string }): Promise<string> {
  const glob = new Glob(input.pattern)
  const files = await collectFallbackSearchFiles(input.searchPath)
  const matches = files.filter((filePath) => matchesFallbackGlob(filePath, input.searchPath, glob))

  return matches.length > 0 ? truncate(matches.join('\n'), MAX_SHELL_OUTPUT) : 'No files found.'
}

export async function runShell(command: string): Promise<ProcessResult> {
  return runProcess(command, workspaceRoot)
}

export async function runShellInDirectory(
  command: string,
  cwd: string,
): Promise<ProcessResult> {
  return runProcess(command, cwd)
}

export async function runRipgrepSearch(input: { pattern: string; path?: string; glob?: string }): Promise<string> {
  const pattern = ensureNonEmptyString(input.pattern, 'pattern')
  const searchPath = input.path?.trim() ? relativeWorkspacePath(resolveWorkspacePath(input.path)) : '.'
  const args = ['--line-number', '--no-heading', '--color=never']
  if (input.glob?.trim()) {
    args.push('--glob', input.glob.trim())
  }
  args.push('--', pattern, searchPath)

  if (forceRipgrepFallbackForTesting) {
    return runFallbackSearch({ pattern, searchPath, glob: input.glob })
  }

  const result = await runExecutable('rg', args, workspaceRoot)
  if (result === null) {
    return runFallbackSearch({ pattern, searchPath, glob: input.glob })
  }
  if (result.exitCode === 0) {
    return truncate(result.stdout, MAX_SHELL_OUTPUT)
  }
  if (result.exitCode === 1) {
    return 'No matches found.'
  }
  throw new Error(result.stderr.trim() || `rg exited with code ${result.exitCode}`)
}

export async function runRipgrepGlob(input: { pattern: string; path?: string }): Promise<string> {
  const pattern = ensureNonEmptyString(input.pattern, 'pattern')
  const searchPath = input.path?.trim() ? relativeWorkspacePath(resolveWorkspacePath(input.path)) : '.'
  const args = ['--files', '--color=never', '--glob', pattern, '--', searchPath]

  if (forceRipgrepFallbackForTesting) {
    return runFallbackGlob({ pattern, searchPath })
  }

  const result = await runExecutable('rg', args, workspaceRoot)
  if (result === null) {
    return runFallbackGlob({ pattern, searchPath })
  }
  if (result.exitCode === 0) {
    return truncate(result.stdout.trimEnd(), MAX_SHELL_OUTPUT) || 'No files found.'
  }
  if (result.exitCode === 1) {
    return 'No files found.'
  }
  throw new Error(result.stderr.trim() || `rg exited with code ${result.exitCode}`)
}

export function summarizeTask(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    status: task.status,
    background: task.background,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    progressSummary: task.progressSummary,
    error: task.error,
    metadata: task.metadata,
  }
}

export function formatAgentBatchResult(result: {
  tasks: Array<{ task: TaskRecord; output: string }>
}): string {
  const sections = result.tasks.map(({ task, output }, index) => {
    const header = [
      `## Agent ${index + 1}: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
      task.outputPath ? `Full output: ${task.outputPath}` : null,
      task.error ? `Error: ${task.error}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    const body = truncate(
      output.trim() || task.progressSummary || '(no output)',
      MAX_AGENT_BATCH_INLINE_OUTPUT_CHARS,
    )
    return `${header}\n\n${body}`
  })

  const failed = result.tasks.filter(({ task }) => task.status === 'failed' || task.status === 'cancelled')
  const summary =
    failed.length === 0
      ? `Ran ${result.tasks.length} delegated agent${result.tasks.length === 1 ? '' : 's'} concurrently.`
      : `Ran ${result.tasks.length} delegated agent${result.tasks.length === 1 ? '' : 's'} concurrently; ${failed.length} did not complete successfully.`

  return `${summary}\n\n${sections.join('\n\n---\n\n')}`
}

export function formatShellResult(exitCode: number, stdout: string, stderr: string): string {
  const outputParts = [
    `exit_code: ${exitCode}`,
    stdout ? `stdout:\n${truncate(stdout, MAX_SHELL_OUTPUT)}` : 'stdout: <empty>',
    stderr ? `stderr:\n${truncate(stderr, MAX_SHELL_OUTPUT)}` : 'stderr: <empty>',
  ]
  return outputParts.join('\n\n')
}
