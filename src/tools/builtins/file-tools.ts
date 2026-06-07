import { mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'

import { MAX_FILE_CHARS } from '../../config'
import { createUnifiedDiff } from '../../lib/change-diff'
import { applyUnifiedDiff, sanitizePatchTargets, splitUnifiedDiffByFile } from '../../lib/diff'
import { truncate } from '../../lib/text'
import { relativeWorkspacePath, resolveWorkspacePath } from '../../lib/workspace'
import type { AnyToolDefinition, ToolDefinition } from '../tool-types'
import {
  patchFileSchema,
  readFileSchema,
  searchFilesSchema,
  writeFileSchema,
} from './schemas'
import {
  ensureNonEmptyString,
  formatFileChangeResult,
  runRipgrepSearch,
  summarizeBuiltInToolCompletion,
} from './utils'

export function createFileTools(): AnyToolDefinition[] {
  const readFileTool: ToolDefinition<typeof readFileSchema, string> = {
    id: 'readFile',
    displayName: 'Read File',
    description: 'Read a UTF-8 file from the workspace.',
    inputSchema: readFileSchema,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('readFile', context.input, result, context.artifactPath),
    execute: async ({ path: targetPath }) => {
      const normalizedPath = ensureNonEmptyString(targetPath, 'path')
      const resolvedPath = resolveWorkspacePath(normalizedPath)
      const file = Bun.file(resolvedPath)
      if (!(await file.exists())) {
        return `File not found: ${relativeWorkspacePath(resolvedPath)}`
      }
      const content = await file.text()
      return truncate(content, MAX_FILE_CHARS)
    },
  }

  const searchFilesTool: ToolDefinition<typeof searchFilesSchema, string> = {
    id: 'searchFiles',
    displayName: 'Search Files',
    description: 'Search workspace files with ripgrep. Read-only.',
    inputSchema: searchFilesSchema,
    summarize: (result, context) =>
      summarizeBuiltInToolCompletion('searchFiles', context.input, result, context.artifactPath),
    execute: async (input) => runRipgrepSearch(input),
  }

  const writeFileTool: ToolDefinition<typeof writeFileSchema, string> = {
    id: 'writeFile',
    displayName: 'Write File',
    description: 'Overwrite a file in the workspace with new content.',
    inputSchema: writeFileSchema,
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

  const patchFileTool: ToolDefinition<typeof patchFileSchema, string> = {
    id: 'patchFile',
    displayName: 'Patch File',
    description: 'Apply a unified diff patch to a file.',
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

  return [readFileTool, searchFilesTool, writeFileTool, patchFileTool]
}
