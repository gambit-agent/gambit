import { homedir } from 'node:os'
import path from 'node:path'

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

  const refreshed = await refreshCodexToken(refreshToken)
  await persistRefreshedToken(authPath, auth, refreshed).catch(() => undefined)
  return refreshed
}

async function readCodexAuthFile(authPath: string): Promise<CodexAuthFile> {
  try {
    return (await Bun.file(authPath).json()) as CodexAuthFile
  } catch (error) {
    throw new Error(`Failed to read Codex auth file at ${authPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function persistRefreshedToken(authPath: string, current: CodexAuthFile, token: CodexAuthToken): Promise<void> {
  const next = {
    ...current,
    tokens: {
      ...current.tokens,
      access_token: token.accessToken,
      account_id: token.accountId,
    },
    last_refresh: new Date().toISOString(),
  }
  await Bun.write(authPath, `${JSON.stringify(next, null, 2)}\n`)
}

async function refreshCodexToken(refreshToken: string): Promise<CodexAuthToken> {
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
    const text = await response.text().catch(() => '')
    throw new Error(`Codex token refresh failed (${response.status}): ${text || response.statusText}`)
  }

  const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new Error(`Codex token refresh response missing access_token: ${JSON.stringify(json)}`)
  }

  return {
    accessToken: json.access_token,
    accountId: extractAccountId(json.access_token),
  }
}

function isJwtExpired(token: string): boolean {
  const payload = decodeJwt(token)
  const exp = typeof payload?.exp === 'number' ? payload.exp : undefined
  if (!exp) return false
  return Date.now() >= exp * 1000 - 60_000
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    return JSON.parse(atob(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
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
