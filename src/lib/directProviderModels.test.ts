import { afterEach, expect, test } from 'bun:test'

import {
  fetchDirectProviderModels,
  getDefaultDirectProviderModels,
  testProviderConnection,
} from './directProviderModels'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('getDefaultDirectProviderModels returns the curated presets for a provider', () => {
  const models = getDefaultDirectProviderModels('anthropic')
  expect(models.map((model) => model.id)).toEqual(['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'])
})

test('getDefaultDirectProviderModels is empty for LM Studio (no curated list)', () => {
  expect(getDefaultDirectProviderModels('lmstudio')).toEqual([])
})

test('fetchDirectProviderModels returns live OpenAI models on success', async () => {
  const captured: { url: string | null } = { url: null }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.url = url.toString()
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
    return jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }] })
  }) as unknown as typeof fetch

  const models = await fetchDirectProviderModels('openai', { apiKey: 'sk-test', baseURL: null })

  expect(captured.url).toBe('https://api.openai.com/v1/models')
  expect(models).toEqual([{ id: 'gpt-4o', name: 'gpt-4o' }])
})

test('fetchDirectProviderModels falls back to the curated list on failure', async () => {
  globalThis.fetch = (async () => jsonResponse({ error: 'unauthorized' }, 401)) as unknown as typeof fetch

  const models = await fetchDirectProviderModels('anthropic', { apiKey: 'bad-key', baseURL: null })

  expect(models.map((model) => model.id)).toEqual(['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'])
})

test('fetchDirectProviderModels for Z.AI always uses the curated list', async () => {
  const captured: { called: boolean } = { called: false }
  globalThis.fetch = (async () => {
    captured.called = true
    return jsonResponse({ data: [] })
  }) as unknown as typeof fetch

  const models = await fetchDirectProviderModels('zai', { apiKey: 'zai-key', baseURL: null })

  expect(captured.called).toBe(false)
  expect(models.map((model) => model.id)).toEqual(['glm-4.6', 'glm-4.5', 'glm-4.5-air'])
})

test('fetchDirectProviderModels for ChatGPT Plus/Pro always uses the curated list', async () => {
  const captured: { called: boolean } = { called: false }
  globalThis.fetch = (async () => {
    captured.called = true
    return jsonResponse({ data: [] })
  }) as unknown as typeof fetch

  const models = await fetchDirectProviderModels('chatgpt', { apiKey: null, baseURL: null, refreshToken: 'refresh-token' })

  expect(captured.called).toBe(false)
  expect(models.map((model) => model.id)).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'])
})

test('testProviderConnection reports success for a valid credential', async () => {
  globalThis.fetch = (async () => jsonResponse({ data: [{ id: 'qwen2.5-coder-32b' }] })) as unknown as typeof fetch

  const result = await testProviderConnection('lmstudio', { apiKey: null, baseURL: 'http://localhost:1234/v1' })

  expect(result).toEqual({ ok: true, unverifiable: false, error: null })
})

test('testProviderConnection reports success for a valid OpenRouter credential', async () => {
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-or' })
    return jsonResponse({ data: [{ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }] })
  }) as unknown as typeof fetch

  const result = await testProviderConnection('openrouter', { apiKey: 'sk-or', baseURL: null })

  expect(result).toEqual({ ok: true, unverifiable: false, error: null })
})

test('testProviderConnection reports failure with a message for a bad credential', async () => {
  globalThis.fetch = (async () => jsonResponse({}, 401)) as unknown as typeof fetch

  const result = await testProviderConnection('openai', { apiKey: 'bad-key', baseURL: null })

  expect(result.ok).toBe(false)
  expect(result.unverifiable).toBe(false)
  expect(result.error).toContain('401')
})

test('testProviderConnection treats Z.AI as unverifiable-but-trusted', async () => {
  const captured: { called: boolean } = { called: false }
  globalThis.fetch = (async () => {
    captured.called = true
    return jsonResponse({})
  }) as unknown as typeof fetch

  const result = await testProviderConnection('zai', { apiKey: 'zai-key', baseURL: null })

  expect(captured.called).toBe(false)
  expect(result).toEqual({ ok: true, unverifiable: true, error: null })
})

test('testProviderConnection treats ChatGPT Plus/Pro as unverifiable-but-trusted', async () => {
  const result = await testProviderConnection('chatgpt', {
    apiKey: null,
    baseURL: null,
    refreshToken: 'refresh-token',
  })

  expect(result).toEqual({ ok: true, unverifiable: true, error: null })
})
