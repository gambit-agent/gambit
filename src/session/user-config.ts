import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { parseOptionalPositiveInteger } from '../config'
import { isProviderId } from '../lib/providers'
import { isRecord } from './jsonl'

export interface UserConfigProviderCredential {
  apiKey: string | null
  baseURL: string | null
  accessToken?: string | null
  refreshToken?: string | null
  expiresAt?: number | null
  accountId?: string | null
}

export interface UserConfig {
  maxDepth: number | null
  theme: string | null
  providers: Record<string, UserConfigProviderCredential>
}

export function getUserConfigPath(home: string = homedir()): string {
  return path.join(home, '.gambit', 'config.json')
}

function emptyUserConfig(): UserConfig {
  return { maxDepth: null, theme: null, providers: {} }
}

function parseProviderCredential(value: unknown): UserConfigProviderCredential | null {
  if (!isRecord(value)) {
    return null
  }
  const apiKey = typeof value.apiKey === 'string' && value.apiKey.trim() ? value.apiKey.trim() : null
  const baseURL = typeof value.baseURL === 'string' && value.baseURL.trim() ? value.baseURL.trim() : null
  const accessToken = typeof value.accessToken === 'string' && value.accessToken.trim() ? value.accessToken.trim() : null
  const refreshToken = typeof value.refreshToken === 'string' && value.refreshToken.trim() ? value.refreshToken.trim() : null
  const accountId = typeof value.accountId === 'string' && value.accountId.trim() ? value.accountId.trim() : null
  const expiresAt = typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
    ? Math.max(0, Math.floor(value.expiresAt))
    : null
  if (!apiKey && !baseURL && !accessToken && !refreshToken) {
    return null
  }

  const credential: UserConfigProviderCredential = { apiKey, baseURL }
  if (accessToken) credential.accessToken = accessToken
  if (refreshToken) credential.refreshToken = refreshToken
  if (expiresAt) credential.expiresAt = expiresAt
  if (accountId) credential.accountId = accountId
  return credential
}

function parseProviders(value: unknown): Record<string, UserConfigProviderCredential> {
  if (!isRecord(value)) {
    return {}
  }
  const result: Record<string, UserConfigProviderCredential> = {}
  for (const [id, credential] of Object.entries(value)) {
    if (!isProviderId(id)) {
      continue
    }
    const parsed = parseProviderCredential(credential)
    if (parsed) {
      result[id] = parsed
    }
  }
  return result
}

function parseUserConfig(value: unknown): UserConfig {
  if (!isRecord(value)) {
    return emptyUserConfig()
  }

  const maxDepth = value.max_depth ?? value.maxDepth ?? value.maxDelegationDepth
  return {
    maxDepth: parseOptionalPositiveInteger(
      typeof maxDepth === 'string' || typeof maxDepth === 'number' ? maxDepth : null,
    ),
    theme: typeof value.theme === 'string' && value.theme.trim()
      ? value.theme.trim()
      : null,
    providers: parseProviders(value.providers),
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

export async function writeProviderCredential(
  providerId: string,
  credential: UserConfigProviderCredential,
  configPath: string = getUserConfigPath(),
): Promise<void> {
  const current = await readUserConfigRecord(configPath)
  const providers = isRecord(current.providers) ? { ...current.providers } : {}
  const nextCredential: UserConfigProviderCredential = {
    apiKey: credential.apiKey?.trim() || null,
    baseURL: credential.baseURL?.trim() || null,
  }
  if (credential.accessToken?.trim()) nextCredential.accessToken = credential.accessToken.trim()
  if (credential.refreshToken?.trim()) nextCredential.refreshToken = credential.refreshToken.trim()
  if (typeof credential.expiresAt === 'number' && Number.isFinite(credential.expiresAt)) {
    nextCredential.expiresAt = Math.max(0, Math.floor(credential.expiresAt))
  }
  if (credential.accountId?.trim()) nextCredential.accountId = credential.accountId.trim()

  providers[providerId] = nextCredential
  const next = { ...current, providers }

  await writeUserConfigRecord(configPath, next)
}

export async function removeProviderCredential(
  providerId: string,
  configPath: string = getUserConfigPath(),
): Promise<void> {
  const current = await readUserConfigRecord(configPath)
  const providers = isRecord(current.providers) ? { ...current.providers } : {}
  delete providers[providerId]
  const next = { ...current, providers }

  await writeUserConfigRecord(configPath, next)
}

export async function writeThemePreference(
  themeId: string,
  configPath: string = getUserConfigPath(),
): Promise<void> {
  const current = await readUserConfigRecord(configPath)
  const next = {
    ...current,
    theme: themeId.trim() || null,
  }

  await writeUserConfigRecord(configPath, next)
}

async function writeUserConfigRecord(configPath: string, record: Record<string, unknown>): Promise<void> {
  const { openRouterApiKey: _openRouterApiKey, ...next } = record
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await chmod(configPath, 0o600).catch(() => undefined)
}
