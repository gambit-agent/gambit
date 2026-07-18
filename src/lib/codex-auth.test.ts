import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { getCodexAuthToken } from './codex-auth'

const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

/**
 * Builds a synthetic JWT. The padding claim forces bytes whose base64 encoding
 * uses `+`/`/`, so the base64url payload contains `-`/`_` — exactly the
 * alphabet that `atob()` rejects.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const fullPayload = { ...payload, pad: '>>>???>>>???' }
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(fullPayload)}.signature`
}

function accountPayload(accountId: string, expiresAtSeconds: number): Record<string, unknown> {
  return {
    exp: expiresAtSeconds,
    [JWT_CLAIM_PATH]: { chatgpt_account_id: accountId },
  }
}

let tempDir: string
let authPath: string
const originalFetch = globalThis.fetch
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ['CODEX_AUTH_FILE', 'OPENAI_CODEX_ACCESS_TOKEN', 'CODEX_ACCESS_TOKEN'] as const

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'gambit-codex-auth-'))
  authPath = path.join(tempDir, 'auth.json')
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.CODEX_AUTH_FILE = authPath
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  await rm(tempDir, { recursive: true, force: true })
})

async function writeAuthFile(tokens: Record<string, unknown>): Promise<void> {
  await Bun.write(authPath, JSON.stringify({ tokens }, null, 2))
}

test('decodes base64url JWTs when reading a valid token', async () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const accessToken = makeJwt(accountPayload('acct_valid', futureExp))
  // Ensure the payload actually exercises the base64url alphabet.
  expect(accessToken.split('.')[1]).toMatch(/[-_]/)

  await writeAuthFile({ access_token: accessToken, refresh_token: 'refresh-1' })
  globalThis.fetch = (async () => {
    throw new Error('unexpected network call')
  }) as unknown as typeof fetch

  const result = await getCodexAuthToken()
  expect(result.accessToken).toBe(accessToken)
  expect(result.accountId).toBe('acct_valid')
})

test('refreshes an expired token and persists the rotated refresh token', async () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const expiredToken = makeJwt(accountPayload('acct_old', pastExp))
  const newToken = makeJwt(accountPayload('acct_new', futureExp))

  await writeAuthFile({ access_token: expiredToken, refresh_token: 'original-refresh' })

  let refreshBody = ''
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    refreshBody = String(init?.body)
    return new Response(
      JSON.stringify({ access_token: newToken, refresh_token: 'rotated-refresh', expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const result = await getCodexAuthToken()
  expect(result.accessToken).toBe(newToken)
  expect(result.accountId).toBe('acct_new')
  expect(refreshBody).toContain('refresh_token=original-refresh')

  const persisted = (await Bun.file(authPath).json()) as { tokens: Record<string, unknown> }
  expect(persisted.tokens.access_token).toBe(newToken)
  expect(persisted.tokens.refresh_token).toBe('rotated-refresh')
  expect(persisted.tokens.account_id).toBe('acct_new')
})

test('keeps the existing refresh token when the response does not rotate it', async () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const expiredToken = makeJwt(accountPayload('acct_old', pastExp))
  const newToken = makeJwt(accountPayload('acct_new', futureExp))

  await writeAuthFile({ access_token: expiredToken, refresh_token: 'original-refresh' })

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: newToken, expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

  await getCodexAuthToken()

  const persisted = (await Bun.file(authPath).json()) as { tokens: Record<string, unknown> }
  expect(persisted.tokens.access_token).toBe(newToken)
  expect(persisted.tokens.refresh_token).toBe('original-refresh')
})

test('concurrent calls with an expired token share a single refresh grant', async () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const expiredToken = makeJwt(accountPayload('acct_old', pastExp))
  const newToken = makeJwt(accountPayload('acct_new', futureExp))

  await writeAuthFile({ access_token: expiredToken, refresh_token: 'single-flight-refresh' })

  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    // Hold the response open long enough for both callers to hit the refresh path.
    await new Promise((resolve) => setTimeout(resolve, 25))
    return new Response(
      JSON.stringify({ access_token: newToken, refresh_token: 'rotated-refresh', expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const [first, second] = await Promise.all([getCodexAuthToken(), getCodexAuthToken()])

  expect(fetchCalls).toBe(1)
  expect(first.accessToken).toBe(newToken)
  expect(second.accessToken).toBe(newToken)
  expect(first.accountId).toBe('acct_new')
  expect(second.accountId).toBe('acct_new')

  const persisted = (await Bun.file(authPath).json()) as { tokens: Record<string, unknown> }
  expect(persisted.tokens.refresh_token).toBe('rotated-refresh')
})

test('refresh failures never leak the token response body', async () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600
  const expiredToken = makeJwt(accountPayload('acct_old', pastExp))
  await writeAuthFile({ access_token: expiredToken, refresh_token: 'original-refresh' })

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'invalid_grant', refresh_token: 'super-secret-token' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

  const error = await getCodexAuthToken().then(
    () => null,
    (thrown: unknown) => thrown as Error,
  )
  expect(error).toBeInstanceOf(Error)
  expect(error?.message).toContain('HTTP 400')
  expect(error?.message).toContain('invalid_grant')
  expect(error?.message).not.toContain('super-secret-token')
})

test('missing access_token in the refresh response fails without echoing the payload', async () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600
  const expiredToken = makeJwt(accountPayload('acct_old', pastExp))
  await writeAuthFile({ access_token: expiredToken, refresh_token: 'original-refresh' })

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ refresh_token: 'super-secret-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

  const error = await getCodexAuthToken().then(
    () => null,
    (thrown: unknown) => thrown as Error,
  )
  expect(error).toBeInstanceOf(Error)
  expect(error?.message).not.toContain('super-secret-token')
})
