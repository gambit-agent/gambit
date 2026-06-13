import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { parseOptionalPositiveInteger } from '../config'
import { isRecord } from './jsonl'

export interface UserConfig {
  openRouterApiKey: string | null
  maxDepth: number | null
}

export function getUserConfigPath(home: string = homedir()): string {
  return path.join(home, '.gambit', 'config.json')
}

function emptyUserConfig(): UserConfig {
  return { openRouterApiKey: null, maxDepth: null }
}

function parseUserConfig(value: unknown): UserConfig {
  if (!isRecord(value)) {
    return emptyUserConfig()
  }

  const openRouterApiKey = value.openRouterApiKey
  const maxDepth = value.max_depth ?? value.maxDepth ?? value.maxDelegationDepth
  return {
    openRouterApiKey: typeof openRouterApiKey === 'string' && openRouterApiKey.trim()
      ? openRouterApiKey.trim()
      : null,
    maxDepth: parseOptionalPositiveInteger(
      typeof maxDepth === 'string' || typeof maxDepth === 'number' ? maxDepth : null,
    ),
  }
}

async function readUserConfigRecord(configPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = await Bun.file(configPath, { type: 'application/json' }).json()
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    if (error instanceof SyntaxError) {
      return {}
    }
    throw error
  }
}

export async function readUserConfig(configPath: string = getUserConfigPath()): Promise<UserConfig> {
  return parseUserConfig(await readUserConfigRecord(configPath))
}

export async function readOpenRouterApiKey(configPath: string = getUserConfigPath()): Promise<string | null> {
  return (await readUserConfig(configPath)).openRouterApiKey
}

export async function writeOpenRouterApiKey(
  openRouterApiKey: string,
  configPath: string = getUserConfigPath(),
): Promise<void> {
  const current = await readUserConfigRecord(configPath)
  const next = {
    ...current,
    openRouterApiKey: openRouterApiKey.trim() || null,
  }

  await mkdir(path.dirname(configPath), { recursive: true })
  await Bun.write(configPath, `${JSON.stringify(next, null, 2)}\n`)
}
