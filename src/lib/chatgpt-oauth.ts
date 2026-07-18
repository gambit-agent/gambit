import { setTimeout as sleep } from 'node:timers/promises'

import type { CodexAuthToken } from './codex-auth'
import { decodeJwt, isJwtExpired } from './jwt'
import type { ProviderCredential } from './provider-credentials'

const ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEVICE_URL = `${ISSUER}/codex/device`
const TOKEN_URL = `${ISSUER}/oauth/token`
const USER_AGENT = 'gambit'
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000
const DEVICE_AUTH_TIMEOUT_MS = 15 * 60_000
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

export interface ChatGptDeviceAuthorization {
  deviceAuthId: string
  userCode: string
  intervalMs: number
  verificationUrl: string
  /** How long polling may continue before the device code is considered expired. */
  expiresInMs?: number
}

interface DeviceAuthorizationResponse {
  device_auth_id?: string
  user_code?: string
  interval?: string | number
  expires_in?: string | number
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
  const expiresInSeconds = Number.parseInt(String(payload.expires_in ?? ''), 10)
  return {
    deviceAuthId: payload.device_auth_id,
    userCode: payload.user_code,
    intervalMs: intervalSeconds * 1000,
    verificationUrl: DEVICE_URL,
    expiresInMs: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : undefined,
  }
}

export async function pollChatGptDeviceAuthorization(
  authorization: ChatGptDeviceAuthorization,
  signal?: AbortSignal,
): Promise<ProviderCredential> {
  const deadline = Date.now() + (authorization.expiresInMs ?? DEVICE_AUTH_TIMEOUT_MS)
  while (!signal?.aborted) {
    if (Date.now() >= deadline) {
      throw new Error('ChatGPT authorization timed out. Run /connect chatgpt to try again.')
    }
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

/**
 * Concurrent callers (e.g. the model picker fetch and a stream start) share a
 * single in-flight refresh, keyed by the refresh token being spent. Without
 * this, two simultaneous refresh grants can invalidate each other when the
 * server rotates refresh tokens.
 */
const inflightRefreshes = new Map<string, Promise<CodexAuthToken>>()

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

  const refreshToken = credential.refreshToken
  if (!refreshToken) {
    throw new Error('ChatGPT subscription token is expired and no refresh token was found. Run /connect chatgpt again.')
  }

  let pending = inflightRefreshes.get(refreshToken)
  if (!pending) {
    pending = refreshChatGptCredential(refreshToken, onRefresh).finally(() => {
      inflightRefreshes.delete(refreshToken)
    })
    inflightRefreshes.set(refreshToken, pending)
  }
  return pending
}

async function refreshChatGptCredential(
  refreshToken: string,
  onRefresh?: (credential: ProviderCredential) => Promise<void> | void,
): Promise<CodexAuthToken> {
  const tokens = await refreshAccessToken(refreshToken)
  // Refresh responses may omit refresh_token when the server does not rotate
  // it; keep using the one we already have.
  if (!tokens.refresh_token) {
    tokens.refresh_token = refreshToken
  }
  const refreshed = credentialFromTokenResponse(tokens)
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
