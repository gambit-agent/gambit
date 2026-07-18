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

test('fetchDirectProviderModels returns live OpenAI models with current reasoning metadata', async () => {
  const captured: { url: string | null } = { url: null }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.url = url.toString()
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
    return jsonResponse({ data: [{ id: 'gpt-5.6' }, { id: 'text-embedding-3-small' }] })
  }) as unknown as typeof fetch

  const models = await fetchDirectProviderModels('openai', { apiKey: 'sk-test', baseURL: null })

  expect(captured.url).toBe('https://api.openai.com/v1/models')
  expect(models).toEqual([{
    id: 'gpt-5.6',
    name: 'gpt-5.6',
    description: null,
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
  }])
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

test('fetchDirectProviderModels uses the live ChatGPT catalog and its effort levels', async () => {
  const captured: { url: string | null } = { url: null }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.url = url.toString()
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'chatgpt-account-id': 'account-id',
    })
    return jsonResponse({
      models: [
        {
          slug: 'gpt-5.6',
          display_name: 'GPT-5.6',
          description: 'Latest model',
          visibility: 'list',
          priority: 20,
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
            { effort: 'xhigh' },
            { effort: 'max' },
          ],
        },
        { slug: 'hidden-model', visibility: 'hide', priority: 100 },
      ],
    })
  }) as unknown as typeof fetch

  const models = await fetchDirectProviderModels('chatgpt', {
    apiKey: null,
    baseURL: null,
    accessToken: 'access-token',
    accountId: 'account-id',
  })

  expect(captured.url).toContain('https://chatgpt.com/backend-api/codex/models?client_version=')
  expect(models).toEqual([{
    id: 'gpt-5.6',
    name: 'GPT-5.6',
    description: 'Latest model',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
  }])
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

test('testProviderConnection verifies ChatGPT Plus/Pro through the model catalog', async () => {
  globalThis.fetch = (async () => jsonResponse({ models: [{ slug: 'gpt-5.6', visibility: 'list' }] })) as unknown as typeof fetch

  const result = await testProviderConnection('chatgpt', {
    apiKey: null,
    baseURL: null,
    accessToken: 'access-token',
    accountId: 'account-id',
  })

  expect(result).toEqual({ ok: true, unverifiable: false, error: null })
})
