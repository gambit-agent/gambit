import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { isRecord } from './jsonl'

export interface UserConfig {
  openRouterApiKey: string | null
}

export function getUserConfigPath(home: string = homedir()): string {
  return path.join(home, '.gambit', 'config.json')
}

function parseUserConfig(value: unknown): UserConfig {
  if (!isRecord(value)) {
    return { openRouterApiKey: null }
  }

  const openRouterApiKey = value.openRouterApiKey
  return {
    openRouterApiKey: typeof openRouterApiKey === 'string' && openRouterApiKey.trim()
      ? openRouterApiKey.trim()
      : null,
  }
}

async function readUserConfigRecord(configPath: string): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }

  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
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
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}
