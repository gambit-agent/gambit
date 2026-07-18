import { homedir } from 'node:os'
import path from 'node:path'

import { workspaceRoot } from '../../config'
import { collectFiles } from '../file-scanner'
import { deriveDescription, extractFrontmatter } from './frontmatter'
import { filterUserConflicts } from './resolver'
import type { SlashCommandDefinition, SlashCommandScope } from './types'

const MARKDOWN_EXTENSIONS = new Set(['.md'])

let projectCommandsDirOverride: string | null = null
let userCommandsDirOverride: string | null = null

function getProjectCommandsDir(): string {
  return projectCommandsDirOverride ?? path.join(workspaceRoot, '.gambit', 'commands')
}

function getUserCommandsDir(): string {
  return userCommandsDirOverride ?? path.join(homedir(), '.gambit', 'commands')
}

export function setSlashCommandDirectoriesForTesting(options: {
  project?: string | null
  user?: string | null
}): void {
  if (Object.prototype.hasOwnProperty.call(options, 'project')) {
    projectCommandsDirOverride = options.project ?? null
  }
  if (Object.prototype.hasOwnProperty.call(options, 'user')) {
    userCommandsDirOverride = options.user ?? null
  }
}

export async function loadSlashCommands(): Promise<SlashCommandDefinition[]> {
  const projectDir = getProjectCommandsDir()
  const userDir = getUserCommandsDir()

  const [projectCommands, userCommands] = await Promise.all([
    collectCommands(projectDir, 'project', projectDir),
    collectCommands(userDir, 'user', userDir),
  ])

  const commands = [...projectCommands, ...filterUserConflicts(projectCommands, userCommands)]
  commands.sort((a, b) => a.id.localeCompare(b.id))
  return commands
}

async function collectCommands(
  directory: string,
  scope: SlashCommandScope,
  rootDir: string,
): Promise<SlashCommandDefinition[]> {
  const files = await collectFiles(directory, { extensions: MARKDOWN_EXTENSIONS })
  const parsed = await Promise.all(files.map((filePath) => parseCommandFile(filePath, scope, rootDir)))
  return parsed.filter((definition): definition is SlashCommandDefinition => Boolean(definition))
}

async function parseCommandFile(
  filePath: string,
  scope: SlashCommandScope,
  rootDir: string,
): Promise<SlashCommandDefinition | null> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return null
  }

  const content = await file.text()
  const { frontmatter, body } = extractFrontmatter(content)

  const relativePath = path.relative(scope === 'project' ? workspaceRoot : homedir(), filePath)
  const namespace = determineNamespace(filePath, rootDir)
  const name = path.basename(filePath).replace(/\.[^.]+$/, '')
  const id = namespace ? `${namespace}/${name}` : name
  const description = frontmatter.description ?? deriveDescription(body)

  return {
    id,
    name,
    namespace,
    scope,
    description,
    argumentHint: frontmatter.argumentHint,
    allowedTools: frontmatter.allowedTools ?? [],
    model: frontmatter.model,
    disableModelInvocation: frontmatter.disableModelInvocation ?? false,
    filePath,
    relativePath,
    body,
  }
}

function determineNamespace(filePath: string, rootDir: string): string | null {
  const relative = path.relative(rootDir, path.dirname(filePath))
  if (!relative) {
    return null
  }
  const normalized = relative.split(path.sep).filter(Boolean).join('/')
  return normalized.length > 0 ? normalized : null
}
