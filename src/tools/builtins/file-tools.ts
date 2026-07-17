import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { MAX_FILE_CHARS } from '../../config'
import { createUnifiedDiff } from '../../lib/change-diff'
import { applyUnifiedDiff, sanitizePatchTargets, splitUnifiedDiffByFile } from '../../lib/diff'
import { truncate } from '../../lib/text'
import { relativeWorkspacePath, resolveReadablePath, resolveWorkspacePath } from '../../lib/workspace'
import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import {
  editFileSchema,
  globFilesSchema,
  patchFileSchema,
  readFileSchema,
  searchFilesSchema,
  writeFileSchema,
} from './schemas'
import {
  ensureNonEmptyString,
  formatFileChangeResult,
  runRipgrepGlob,
  runRipgrepSearch,
  summarizeBuiltInToolCompletion,
} from './utils'

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

function splitDisplayLines(content: string): string[] {
  if (!content) {
    return []
  }
  const lines = content.split(/\r?\n/)
  if (content.endsWith('\n') || content.endsWith('\r\n')) {
    lines.pop()
  }
  return lines
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) {
    return line
  }
  return `${line.slice(0, MAX_LINE_LENGTH)}... (line truncated to ${MAX_LINE_LENGTH} chars)`
}

async function readPagedPath(input: { path: string; offset?: number; limit?: number }): Promise<string> {
  const normalizedPath = ensureNonEmptyString(input.path, 'path')
  const offset = input.offset ?? 1
  const limit = input.limit ?? DEFAULT_READ_LIMIT
  const { absolutePath: resolvedPath, displayPath } = resolveReadablePath(normalizedPath)

  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(resolvedPath)
  } catch {
    return `File not found: ${displayPath}`
  }

  if (info.isDirectory()) {
    const entries = (await readdir(resolvedPath, { withFileTypes: true }))
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
      .sort((left, right) => left.localeCompare(right))
    const start = offset - 1
    const sliced = entries.slice(start, start + limit)
    const last = offset + sliced.length - 1
    const hasMore = start + sliced.length < entries.length
    return [
      `<path>${displayPath}</path>`,
      '<type>directory</type>',
      '<entries>',
      sliced.join('\n'),
      hasMore
        ? `\n(Showing entries ${offset}-${last} of ${entries.length}. Use offset=${last + 1} to continue.)`
        : `\n(End of directory - total ${entries.length} entries)`,
      '</entries>',
    ].join('\n')
  }

  if (!info.isFile()) {
    return `Path is not a regular file: ${displayPath}`
  }

  const content = await Bun.file(resolvedPath).text()
  const lines = splitDisplayLines(content)
  const start = offset - 1
  if (start > lines.length && !(lines.length === 0 && offset === 1)) {
    throw new Error(`Offset ${offset} is out of range for ${displayPath} (${lines.length} lines).`)
  }

  const sliced = lines.slice(start, start + limit)
  const numbered = sliced.map((line, index) => `${offset + index}: ${truncateLine(line)}`)
  const last = offset + sliced.length - 1
  const hasMore = start + sliced.length < lines.length
  const body = numbered.join('\n')
  const output = [
    `<path>${displayPath}</path>`,
    '<type>file</type>',
    '<content>',
    body,
    hasMore
      ? `\n(Showing lines ${offset}-${last} of ${lines.length}. Use offset=${last + 1} to continue.)`
      : `\n(End of file - total ${lines.length} lines)`,
    '</content>',
  ].join('\n')

  return truncate(output, MAX_FILE_CHARS)
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function convertLineEndings(text: string, ending: '\n' | '\r\n'): string {
  return ending === '\n' ? text : text.replace(/\n/g, '\r\n')
}

function replaceExact(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error('No changes to apply: oldString and newString are identical.')
  }
  if (!oldString) {
    throw new Error('oldString must not be empty. Use write for full-file creation or replacement.')
  }

  const first = content.indexOf(oldString)
  if (first === -1) {
    throw new Error('Could not find oldString in the file. Re-read the file and provide exact text.')
  }

  if (replaceAll) {
    return content.replaceAll(oldString, newString)
  }

  const last = content.lastIndexOf(oldString)
  if (first !== last) {
    throw new Error('Found multiple matches for oldString. Provide more surrounding context or set replaceAll.')
  }

  return `${content.slice(0, first)}${newString}${content.slice(first + oldString.length)}`
}

export function createFileTools(): AnyToolDefinition[] {
  const readFileTool: ToolDefinition<typeof readFileSchema, string> = {
    id: 'readFile',
    displayName: 'Read File',
    description:
      'Compatibility alias for read. Read a UTF-8 file or directory with line-numbered, paged output.',
    inputSchema: readFileSchema,
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('readFile', context.input, result, context.artifactPath),
    execute: readPagedPath,
  }

  const readTool: ToolDefinition<typeof readFileSchema, string> = {
    ...readFileTool,
    id: 'read',
    displayName: 'Read',
    hiddenFromModel: false,
    description:
      'Read a file or directory with line-numbered, paged output using path, offset, and limit.',
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('read', context.input, result, context.artifactPath),
  }

  const searchFilesTool: ToolDefinition<typeof searchFilesSchema, string> = {
    id: 'searchFiles',
    displayName: 'Search Files',
    description:
      'Compatibility alias for grep. Search workspace files with ripgrep using a text or regex pattern plus optional path/glob.',
    inputSchema: searchFilesSchema,
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('searchFiles', context.input, result, context.artifactPath),
    execute: async (input) => runRipgrepSearch(input),
  }

  const grepFilesTool: ToolDefinition<typeof searchFilesSchema, string> = {
    ...searchFilesTool,
    id: 'grepFiles',
    displayName: 'Grep Files',
    description:
      'Compatibility alias for grep. Search workspace file contents with ripgrep.',
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('grepFiles', context.input, result, context.artifactPath),
  }

  const grepTool: ToolDefinition<typeof searchFilesSchema, string> = {
    ...grepFilesTool,
    id: 'grep',
    displayName: 'Grep',
    hiddenFromModel: false,
    description:
      'Search file contents with a regex pattern plus optional path and glob/include filter. Use glob when looking for file names.',
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('grep', context.input, result, context.artifactPath),
  }

  const globFilesTool: ToolDefinition<typeof globFilesSchema, string> = {
    id: 'globFiles',
    displayName: 'Glob Files',
    description:
      'Compatibility alias for glob. Find workspace files by glob pattern.',
    inputSchema: globFilesSchema,
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('globFiles', context.input, result, context.artifactPath),
    execute: async (input) => runRipgrepGlob(input),
  }

  const globTool: ToolDefinition<typeof globFilesSchema, string> = {
    ...globFilesTool,
    id: 'glob',
    displayName: 'Glob',
    hiddenFromModel: false,
    description:
      'Find files by glob pattern, optionally scoped to a workspace-relative path.',
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('glob', context.input, result, context.artifactPath),
  }

  const writeFileTool: ToolDefinition<typeof writeFileSchema, string> = {
    id: 'writeFile',
    displayName: 'Write File',
    description:
      'Compatibility alias for write. Create or overwrite a workspace-relative file with complete content.',
    inputSchema: writeFileSchema,
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('writeFile', context.input, result, context.artifactPath),
    execute: async ({ path: targetPath, content }) => {
      const normalizedPath = ensureNonEmptyString(targetPath, 'path')
      if (typeof content !== 'string') {
        throw new Error('Parameter "content" must be a string.')
      }

      const resolvedPath = resolveWorkspacePath(normalizedPath)
      const relativePath = relativeWorkspacePath(resolvedPath)
      const file = Bun.file(resolvedPath)
      const exists = await file.exists()
      const oldText = exists ? await file.text() : ''
      const diff = createUnifiedDiff({
        oldPath: exists ? relativePath : null,
        newPath: relativePath,
        oldText,
        newText: content,
      })

      await mkdir(path.dirname(resolvedPath), { recursive: true })
      const bytesWritten = await Bun.write(resolvedPath, content)
      return formatFileChangeResult(`Wrote ${bytesWritten} bytes to ${relativePath}.`, diff)
    },
    getPermissionRequest: ({ path: targetPath }) => ({
      subject: `Write file: ${targetPath}`,
      metadata: { path: targetPath },
    }),
    permissionMetadata: {
      planFilePath: ({ path: targetPath }) => targetPath,
    },
  }

  const writeTool: ToolDefinition<typeof writeFileSchema, string> = {
    ...writeFileTool,
    id: 'write',
    displayName: 'Write',
    hiddenFromModel: false,
    description:
      'Create or overwrite a workspace-relative file with complete content. Prefer edit for exact local changes and patchFile for multi-file diffs.',
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('write', context.input, result, context.artifactPath),
  }

  const editFileTool: ToolDefinition<typeof editFileSchema, string> = {
    id: 'editFile',
    displayName: 'Edit File',
    description:
      'Compatibility alias for edit. Replace exact text in an existing workspace file.',
    inputSchema: editFileSchema,
    hiddenFromModel: true,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('editFile', context.input, result, context.artifactPath),
    execute: async ({ path: targetPath, oldString, newString, replaceAll }) => {
      const normalizedPath = ensureNonEmptyString(targetPath, 'path')
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        throw new Error('Parameters "oldString" and "newString" must be strings.')
      }

      const resolvedPath = resolveWorkspacePath(normalizedPath)
      const relativePath = relativeWorkspacePath(resolvedPath)
      const file = Bun.file(resolvedPath)
      if (!(await file.exists())) {
        throw new Error(`File not found: ${relativePath}`)
      }

      const oldText = await file.text()
      const ending = detectLineEnding(oldText)
      const normalizedOldString = convertLineEndings(normalizeLineEndings(oldString), ending)
      const normalizedNewString = convertLineEndings(normalizeLineEndings(newString), ending)
      const newText = replaceExact(oldText, normalizedOldString, normalizedNewString, replaceAll)
      const diff = createUnifiedDiff({
        oldPath: relativePath,
        newPath: relativePath,
        oldText,
        newText,
      })

      await Bun.write(resolvedPath, newText)
      return formatFileChangeResult(`Edited ${relativePath}.`, diff)
    },
    getPermissionRequest: ({ path: targetPath, replaceAll }) => ({
      subject: `Edit file: ${targetPath}`,
      metadata: { path: targetPath, replaceAll: replaceAll ?? false },
    }),
    permissionMetadata: {
      planFilePath: ({ path: targetPath }) => targetPath,
    },
  }

  const editTool: ToolDefinition<typeof editFileSchema, string> = {
    ...editFileTool,
    id: 'edit',
    displayName: 'Edit',
    hiddenFromModel: false,
    description:
      'Replace exact text in an existing workspace file using oldString and newString.',
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('edit', context.input, result, context.artifactPath),
  }

  const patchFileTool: ToolDefinition<typeof patchFileSchema, string> = {
    id: 'patchFile',
    displayName: 'Patch File',
    description:
      'Apply a git-style unified diff in the workspace. Supports single-file or multi-file update/create/delete/rename patches; omit path for multi-file patches. Do not use apply_patch formatted patches.',
    inputSchema: patchFileSchema,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('patchFile', context.input, result, context.artifactPath),
    execute: async ({ path: targetPath, patch }) => {
      const normalizedPatch = ensureNonEmptyString(patch, 'patch')

      if (normalizedPatch.includes('*** Begin Patch')) {
        throw new Error('apply_patch formatted patches are not supported.')
      }

      const trimmedTarget = targetPath?.trim()
      const explicitTarget = trimmedTarget ? relativeWorkspacePath(resolveWorkspacePath(trimmedTarget)) : null
      const perFilePatches = splitUnifiedDiffByFile(normalizedPatch)

      if (perFilePatches.length === 0) {
        if (!explicitTarget) {
          throw new Error('Unable to determine patch target. Provide a path parameter.')
        }

        const resolvedPath = resolveWorkspacePath(explicitTarget)
        const relativePath = relativeWorkspacePath(resolvedPath)
        sanitizePatchTargets(normalizedPatch, relativePath)

        const file = Bun.file(resolvedPath)
        const exists = await file.exists()
        const baseText = exists ? await file.text() : ''
        const updated = applyUnifiedDiff(baseText, normalizedPatch)
        const isDeletion = /\+\+\+\s+\/dev\/null/.test(normalizedPatch)

        if (isDeletion) {
          if (!exists) {
            throw new Error(`Cannot delete non-existent file: ${relativePath}`)
          }
          await unlink(resolvedPath)
          return `Deleted ${relativePath} via patch.`
        }

        await mkdir(path.dirname(resolvedPath), { recursive: true })
        await Bun.write(resolvedPath, updated)

        return `${exists ? 'Updated' : 'Created'} ${relativePath} via patch.`
      }

      if (explicitTarget && perFilePatches.length > 1) {
        throw new Error('Patch modifies multiple files. Omit the path parameter to allow this.')
      }

      const results: string[] = []

      for (const filePatch of perFilePatches) {
        const { patchText, oldPath, newPath } = filePatch
        const resolvedOld = oldPath ? resolveWorkspacePath(oldPath) : null
        const resolvedNew = newPath ? resolveWorkspacePath(newPath) : null
        const relativeOld = resolvedOld ? relativeWorkspacePath(resolvedOld) : null
        const relativeNew = resolvedNew ? relativeWorkspacePath(resolvedNew) : null
        const allowedTargets = [relativeOld, relativeNew].filter((value): value is string => Boolean(value))

        if (explicitTarget && !allowedTargets.includes(explicitTarget)) {
          throw new Error(`Patch modifies ${allowedTargets.join(', ')} but expected ${explicitTarget}.`)
        }

        sanitizePatchTargets(patchText, allowedTargets)

        if (!resolvedNew) {
          if (!resolvedOld) {
            throw new Error('Patch missing target path for deletion.')
          }

          const file = Bun.file(resolvedOld)
          if (!(await file.exists())) {
            throw new Error(`Cannot delete non-existent file: ${relativeOld}`)
          }
          await unlink(resolvedOld)
          results.push(`Deleted ${relativeOld} via patch.`)
          continue
        }

        const basePath = resolvedOld ?? resolvedNew
        const baseFile = Bun.file(basePath)
        const baseExists = await baseFile.exists()

        if (!resolvedOld && baseExists) {
          throw new Error(`Cannot create ${relativeNew}: file already exists.`)
        }

        if (resolvedOld && !(await Bun.file(resolvedOld).exists())) {
          throw new Error(`Base file not found: ${relativeOld}`)
        }

        const baseText = baseExists ? await baseFile.text() : ''
        const updated = applyUnifiedDiff(baseText, patchText)

        await mkdir(path.dirname(resolvedNew), { recursive: true })
        await Bun.write(resolvedNew, updated)

        const isRename = Boolean(resolvedOld && resolvedOld !== resolvedNew)
        const relativeResolvedNew = relativeWorkspacePath(resolvedNew)
        const toPosix = (value: string) => value.split(path.sep).join('/')

        if (isRename && resolvedOld) {
          const existingOld = Bun.file(resolvedOld)
          if (await existingOld.exists()) {
            await unlink(resolvedOld)
          }
        }

        if (isRename && relativeOld) {
          results.push(`Moved ${toPosix(relativeOld)} -> ${toPosix(relativeResolvedNew)} via patch.`)
        } else if (baseExists) {
          results.push(`Updated ${relativeResolvedNew} via patch.`)
        } else {
          results.push(`Created ${relativeResolvedNew} via patch.`)
        }
      }

      return results.length === 1 ? (results[0] ?? '') : results.join('\n')
    },
    getPermissionRequest: ({ path: targetPath }) => ({
      subject: `Apply patch${targetPath ? `: ${targetPath}` : ''}`,
      metadata: { path: targetPath ?? null },
    }),
    permissionMetadata: {
      planFilePath: ({ path: targetPath }) => targetPath,
    },
  }

  return [
    readTool,
    readFileTool,
    globTool,
    globFilesTool,
    grepTool,
    grepFilesTool,
    searchFilesTool,
    editTool,
    editFileTool,
    writeTool,
    writeFileTool,
    patchFileTool,
  ]
}
