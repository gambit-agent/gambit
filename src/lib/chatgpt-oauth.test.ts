import { afterEach, expect, test } from 'bun:test'

import { pollChatGptDeviceAuthorization, resolveChatGptAuthToken } from './chatgpt-oauth'
import type { ProviderCredential } from './provider-credentials'

const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

function makeAccessToken(accountId: string, expiresAtSeconds: number): string {
  return makeJwt({ exp: expiresAtSeconds, [JWT_CLAIM_PATH]: { chatgpt_account_id: accountId } })
}

function expiredCredential(refreshToken: string): ProviderCredential {
  return {
    apiKey: null,
    baseURL: null,
    accessToken: makeAccessToken('acct_old', Math.floor(Date.now() / 1000) - 3600),
    refreshToken,
    expiresAt: Date.now() - 60_000,
    accountId: 'acct_old',
  }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function tokenResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

test('refresh keeps a rotated refresh token', async () => {
  const newAccessToken = makeAccessToken('acct_new', Math.floor(Date.now() / 1000) + 3600)
  globalThis.fetch = (async () =>
    tokenResponse({ access_token: newAccessToken, refresh_token: 'rotated-refresh', expires_in: 3600 })) as unknown as typeof fetch

  const persisted: ProviderCredential[] = []
  const result = await resolveChatGptAuthToken(expiredCredential('refresh-rotation'), (credential) => {
    persisted.push(credential)
  })

  expect(result.accessToken).toBe(newAccessToken)
  expect(result.accountId).toBe('acct_new')
  expect(persisted).toHaveLength(1)
  expect(persisted[0]?.refreshToken).toBe('rotated-refresh')
  expect(persisted[0]?.accessToken).toBe(newAccessToken)
})

test('refresh falls back to the existing refresh token when the response omits it', async () => {
  const newAccessToken = makeAccessToken('acct_new', Math.floor(Date.now() / 1000) + 3600)
  globalThis.fetch = (async () =>
    tokenResponse({ access_token: newAccessToken, expires_in: 3600 })) as unknown as typeof fetch

  const persisted: ProviderCredential[] = []
  const result = await resolveChatGptAuthToken(expiredCredential('refresh-no-rotation'), (credential) => {
    persisted.push(credential)
  })

  expect(result.accessToken).toBe(newAccessToken)
  expect(persisted[0]?.refreshToken).toBe('refresh-no-rotation')
})

test('concurrent callers share a single in-flight refresh', async () => {
  const newAccessToken = makeAccessToken('acct_new', Math.floor(Date.now() / 1000) + 3600)
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return tokenResponse({ access_token: newAccessToken, refresh_token: 'rotated-refresh', expires_in: 3600 })
  }) as unknown as typeof fetch

  const credential = expiredCredential('refresh-concurrent')
  const [first, second] = await Promise.all([
    resolveChatGptAuthToken(credential),
    resolveChatGptAuthToken(credential),
  ])

  expect(fetchCalls).toBe(1)
  expect(first).toEqual(second)
  expect(first?.accessToken).toBe(newAccessToken)

  // Once settled, a later expired credential triggers a fresh grant.
  await resolveChatGptAuthToken(credential)
  expect(fetchCalls).toBe(2)
})

test('valid unexpired credentials resolve without a network call', async () => {
  globalThis.fetch = (async () => {
    throw new Error('unexpected network call')
  }) as unknown as typeof fetch

  const accessToken = makeAccessToken('acct_live', Math.floor(Date.now() / 1000) + 3600)
  const result = await resolveChatGptAuthToken({
    apiKey: null,
    baseURL: null,
    accessToken,
    refreshToken: 'unused',
    expiresAt: Date.now() + 3_600_000,
    accountId: 'acct_live',
  })

  expect(result).toEqual({ accessToken, accountId: 'acct_live' })
})

test('device authorization polling times out at the deadline', async () => {
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    return new Response('{}', { status: 403 })
  }) as unknown as typeof fetch

  await expect(
    pollChatGptDeviceAuthorization({
      deviceAuthId: 'device-1',
      userCode: 'ABCD-1234',
      intervalMs: 1,
      verificationUrl: 'https://auth.openai.com/codex/device',
      expiresInMs: 0,
    }),
  ).rejects.toThrow(/timed out/)
  expect(fetchCalls).toBe(0)
})
