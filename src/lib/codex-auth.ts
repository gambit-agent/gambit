import { homedir } from 'node:os'
import path from 'node:path'

import { decodeJwt, isJwtExpired } from './jwt'

const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

export interface CodexAuthToken {
  accessToken: string
  accountId: string
}

interface CodexAuthFile {
  tokens?: {
    access_token?: string
    refresh_token?: string
    account_id?: string
  }
}

export function isCodexModel(modelId: string): boolean {
  return modelId.startsWith('codex/') || modelId.startsWith('openai-codex/')
}

export function normalizeCodexModelId(modelId: string): string {
  if (modelId.startsWith('codex/')) return modelId.slice('codex/'.length)
  if (modelId.startsWith('openai-codex/')) return modelId.slice('openai-codex/'.length)
  return modelId
}

export function modelRequiresApiKey(modelId: string): boolean {
  return !isCodexModel(modelId)
}

export async function getCodexAuthToken(): Promise<CodexAuthToken> {
  const envToken = Bun.env.OPENAI_CODEX_ACCESS_TOKEN?.trim() || Bun.env.CODEX_ACCESS_TOKEN?.trim()
  if (envToken) {
    return {
      accessToken: envToken,
      accountId: extractAccountId(envToken),
    }
  }

  const authPath = Bun.env.CODEX_AUTH_FILE?.trim() || path.join(homedir(), '.codex', 'auth.json')
  const auth = await readCodexAuthFile(authPath)
  const accessToken = auth.tokens?.access_token
  const refreshToken = auth.tokens?.refresh_token
  if (!accessToken) {
    throw new Error(`No Codex subscription token found. Run codex login or set OPENAI_CODEX_ACCESS_TOKEN.`)
  }

  if (!isJwtExpired(accessToken)) {
    return {
      accessToken,
      accountId: auth.tokens?.account_id || extractAccountId(accessToken),
    }
  }

  if (!refreshToken) {
    throw new Error('Codex subscription token is expired and no refresh token was found. Run codex login again.')
  }

  let pending = inflightRefreshes.get(refreshToken)
  if (!pending) {
    pending = refreshAndPersistCodexToken(authPath, auth, refreshToken).finally(() => {
      inflightRefreshes.delete(refreshToken)
    })
    inflightRefreshes.set(refreshToken, pending)
  }
  return pending
}

/**
 * Concurrent callers (per-stream getAuthToken, parallel subagents, the model
 * picker fetch) share a single in-flight refresh, keyed by the refresh token
 * being spent. Without this, two simultaneous refresh grants can invalidate
 * each other when the server rotates refresh tokens.
 */
const inflightRefreshes = new Map<string, Promise<CodexAuthToken>>()

async function refreshAndPersistCodexToken(
  authPath: string,
  auth: CodexAuthFile,
  refreshToken: string,
): Promise<CodexAuthToken> {
  const refreshed = await refreshCodexToken(refreshToken)
  await persistRefreshedToken(authPath, auth, refreshed).catch(() => undefined)
  return { accessToken: refreshed.accessToken, accountId: refreshed.accountId }
}

async function readCodexAuthFile(authPath: string): Promise<CodexAuthFile> {
  try {
    return (await Bun.file(authPath).json()) as CodexAuthFile
  } catch (error) {
    throw new Error(`Failed to read Codex auth file at ${authPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface RefreshedCodexToken extends CodexAuthToken {
  /** Rotated refresh token when the server issued one; null when it did not. */
  refreshToken: string | null
}

async function persistRefreshedToken(authPath: string, current: CodexAuthFile, token: RefreshedCodexToken): Promise<void> {
  const next = {
    ...current,
    tokens: {
      ...current.tokens,
      access_token: token.accessToken,
      // Keep the rotated refresh token, otherwise the stored one goes stale
      // after the first rotation and every later refresh fails.
      refresh_token: token.refreshToken ?? current.tokens?.refresh_token,
      account_id: token.accountId,
    },
    last_refresh: new Date().toISOString(),
  }
  await Bun.write(authPath, `${JSON.stringify(next, null, 2)}\n`)
}

async function refreshCodexToken(refreshToken: string): Promise<RefreshedCodexToken> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })

  if (!response.ok) {
    // Never surface the response body: OAuth error payloads can echo tokens.
    const code = await extractOAuthErrorCode(response)
    throw new Error(`Codex token refresh failed (HTTP ${response.status}${code ? `, ${code}` : ''}). Run codex login again.`)
  }

  const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new Error('Codex token refresh response was missing an access token. Run codex login again.')
  }

  return {
    accessToken: json.access_token,
    accountId: extractAccountId(json.access_token),
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
  }
}

/** Extracts only the OAuth error code (e.g. `invalid_grant`) — never token material. */
async function extractOAuthErrorCode(response: Response): Promise<string | null> {
  try {
    const json = (await response.json()) as { error?: unknown }
    if (typeof json.error === 'string' && json.error) return json.error
    if (json.error && typeof json.error === 'object') {
      const code = (json.error as { code?: unknown }).code
      if (typeof code === 'string' && code) return code
    }
  } catch {}
  return null
}

function extractAccountId(token: string): string {
  const payload = decodeJwt(token)
  const auth = payload?.[JWT_CLAIM_PATH]
  const accountId = auth && typeof auth === 'object' ? (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id : undefined
  if (typeof accountId === 'string' && accountId.length > 0) {
    return accountId
  }
  throw new Error('Failed to extract ChatGPT account id from Codex token')
}
