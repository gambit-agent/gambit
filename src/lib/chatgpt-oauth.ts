import { setTimeout as sleep } from 'node:timers/promises'

import type { CodexAuthToken } from './codex-auth'
import type { ProviderCredential } from './provider-credentials'

const ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEVICE_URL = `${ISSUER}/codex/device`
const TOKEN_URL = `${ISSUER}/oauth/token`
const USER_AGENT = 'gambit'
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

export interface ChatGptDeviceAuthorization {
  deviceAuthId: string
  userCode: string
  intervalMs: number
  verificationUrl: string
}

interface DeviceAuthorizationResponse {
  device_auth_id?: string
  user_code?: string
  interval?: string | number
}

interface DeviceTokenResponse {
  authorization_code?: string
  code_verifier?: string
}

interface TokenResponse {
  id_token?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

export async function createChatGptDeviceAuthorization(): Promise<ChatGptDeviceAuthorization> {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })

  if (!response.ok) {
    throw new Error(`Failed to start ChatGPT authorization (${response.status}).`)
  }

  const payload = (await response.json()) as DeviceAuthorizationResponse
  if (!payload.device_auth_id || !payload.user_code) {
    throw new Error('ChatGPT authorization response was missing a device code.')
  }

  const intervalSeconds = Math.max(Number.parseInt(String(payload.interval ?? '5'), 10) || 5, 1)
  return {
    deviceAuthId: payload.device_auth_id,
    userCode: payload.user_code,
    intervalMs: intervalSeconds * 1000,
    verificationUrl: DEVICE_URL,
  }
}

export async function pollChatGptDeviceAuthorization(
  authorization: ChatGptDeviceAuthorization,
  signal?: AbortSignal,
): Promise<ProviderCredential> {
  while (!signal?.aborted) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        device_auth_id: authorization.deviceAuthId,
        user_code: authorization.userCode,
      }),
      signal,
    })

    if (response.ok) {
      const deviceToken = (await response.json()) as DeviceTokenResponse
      if (!deviceToken.authorization_code || !deviceToken.code_verifier) {
        throw new Error('ChatGPT authorization response was missing token exchange data.')
      }
      const tokens = await exchangeAuthorizationCode(deviceToken.authorization_code, deviceToken.code_verifier, signal)
      return credentialFromTokenResponse(tokens)
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`ChatGPT authorization failed (${response.status}).`)
    }

    await sleep(authorization.intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, undefined, { signal })
  }

  throw new Error('ChatGPT authorization was cancelled.')
}

export async function resolveChatGptAuthToken(
  credential: ProviderCredential,
  onRefresh?: (credential: ProviderCredential) => Promise<void> | void,
): Promise<CodexAuthToken> {
  if (credential.accessToken && !isJwtExpired(credential.accessToken) && !isTimestampExpired(credential.expiresAt)) {
    return {
      accessToken: credential.accessToken,
      accountId: credential.accountId || extractAccountId(credential.accessToken),
    }
  }

  if (!credential.refreshToken) {
    throw new Error('ChatGPT subscription token is expired and no refresh token was found. Run /connect chatgpt again.')
  }

  const refreshed = credentialFromTokenResponse(await refreshAccessToken(credential.refreshToken))
  await onRefresh?.(refreshed)
  if (!refreshed.accessToken) {
    throw new Error('ChatGPT token refresh response was missing an access token.')
  }
  return {
    accessToken: refreshed.accessToken,
    accountId: refreshed.accountId || extractAccountId(refreshed.accessToken),
  }
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`ChatGPT token exchange failed (${response.status}).`)
  }
  return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
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
    throw new Error(`ChatGPT token refresh failed (${response.status}).`)
  }
  return response.json()
}

function credentialFromTokenResponse(tokens: TokenResponse): ProviderCredential {
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('ChatGPT token response was missing required OAuth tokens.')
  }
  return {
    apiKey: null,
    baseURL: null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountIdFromTokens(tokens),
  }
}

function isTimestampExpired(expiresAt: number | null | undefined): boolean {
  return typeof expiresAt === 'number' && Date.now() >= expiresAt - 60_000
}

function isJwtExpired(token: string): boolean {
  const payload = decodeJwt(token)
  const exp = typeof payload?.exp === 'number' ? payload.exp : undefined
  return typeof exp === 'number' && Date.now() >= exp * 1000 - 60_000
}

function extractAccountIdFromTokens(tokens: TokenResponse): string {
  if (tokens.id_token) {
    const accountId = extractAccountIdFromToken(tokens.id_token)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const accountId = extractAccountIdFromToken(tokens.access_token)
    if (accountId) return accountId
  }
  throw new Error('Failed to extract ChatGPT account id from OAuth token.')
}

function extractAccountId(token: string): string {
  const accountId = extractAccountIdFromToken(token)
  if (!accountId) {
    throw new Error('Failed to extract ChatGPT account id from OAuth token.')
  }
  return accountId
}

function extractAccountIdFromToken(token: string): string | null {
  const payload = decodeJwt(token)
  const direct = payload?.chatgpt_account_id
  if (typeof direct === 'string' && direct.length > 0) return direct

  const auth = payload?.[JWT_CLAIM_PATH]
  const authAccountId = auth && typeof auth === 'object'
    ? (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id
    : undefined
  if (typeof authAccountId === 'string' && authAccountId.length > 0) return authAccountId

  const organizations = payload?.organizations
  if (Array.isArray(organizations)) {
    const firstOrganizationId = (organizations[0] as { id?: unknown } | undefined)?.id
    if (typeof firstOrganizationId === 'string' && firstOrganizationId.length > 0) return firstOrganizationId
  }

  return null
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>
  } catch {
    return null
  }
}
