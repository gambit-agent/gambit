import { afterEach, expect, test } from 'bun:test'

import {
  buildModelRuntimeSettings,
  buildOpenRouterModelSettings,
  createModelSelector,
  modelNeedsOpenRouterApiKey,
  normalizeProviderSlug,
} from './model'
import { clearProviderCredential, primeProviderCredentials, setProviderCredential } from './provider-credentials'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  clearProviderCredential('openai')
  clearProviderCredential('chatgpt')
})

test('buildOpenRouterModelSettings includes reasoning and exclusive provider routing', () => {
  expect(
    buildOpenRouterModelSettings({
      reasoningEffort: 'high',
      providerSlug: 'deepinfra/turbo',
    }),
  ).toEqual({
    reasoning: { enabled: true, effort: 'high' },
    provider: {
      order: ['deepinfra/turbo'],
      allow_fallbacks: false,
    },
  })
})

test('normalizeProviderSlug accepts endpoint variants and rejects invalid values', () => {
  expect(normalizeProviderSlug(' Provider:Google-Vertex/us-east5 ')).toBe('google-vertex/us-east5')
  expect(normalizeProviderSlug('not a slug')).toBeNull()
})

test('modelNeedsOpenRouterApiKey is false for codex and direct-provider ids', () => {
  expect(modelNeedsOpenRouterApiKey('codex/gpt-5.1-codex')).toBe(false)
  expect(modelNeedsOpenRouterApiKey('openai:gpt-4o')).toBe(false)
  expect(modelNeedsOpenRouterApiKey('anthropic/claude-sonnet-4.5')).toBe(true)
})

test('createModelSelector throws a friendly error for an unconnected direct provider', () => {
  primeProviderCredentials({})
  const getModel = createModelSelector('')

  expect(() => getModel('openai:gpt-4o')).toThrow('OpenAI is not connected. Run /connect to add it.')
})

test('createModelSelector builds an OpenAI model once connected', () => {
  setProviderCredential('openai', { apiKey: 'sk-test', baseURL: null })
  const getModel = createModelSelector('')

  expect(() => getModel('openai:gpt-4o')).not.toThrow()

  clearProviderCredential('openai')
})

test('createModelSelector builds a ChatGPT subscription model once connected', () => {
  setProviderCredential('chatgpt', { apiKey: null, baseURL: null, refreshToken: 'refresh-token' })
  const getModel = createModelSelector('')

  expect(() => getModel('chatgpt:gpt-5.5')).not.toThrow()

  clearProviderCredential('chatgpt')
})

test('ChatGPT subscription requests include the selected live-catalog effort', async () => {
  setProviderCredential('chatgpt', {
    apiKey: null,
    baseURL: null,
    accessToken: 'access-token',
    accountId: 'account-id',
  })
  let requestBody: Record<string, unknown> | null = null
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ error: { message: 'stop after capture' } }), { status: 400 })
  }) as unknown as typeof fetch

  const getModel = createModelSelector('')
  const model = getModel('chatgpt:gpt-5.6', buildModelRuntimeSettings({ reasoningEffort: 'max' }))
  await expect(Promise.resolve(
    (model as unknown as { doStream(options: unknown): PromiseLike<unknown> }).doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
  )).rejects.toThrow('stop after capture')

  expect(requestBody).toMatchObject({ reasoning: { effort: 'max', summary: 'auto' } })
})

test('direct OpenAI requests include the selected reasoning effort', async () => {
  setProviderCredential('openai', { apiKey: 'sk-test', baseURL: null })
  let requestBody: Record<string, unknown> | null = null
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ error: { message: 'stop after capture', type: 'invalid_request_error' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const getModel = createModelSelector('')
  const model = getModel('openai:gpt-5.6', buildModelRuntimeSettings({ reasoningEffort: 'max' }))
  await Promise.resolve(
    (model as unknown as { doStream(options: unknown): PromiseLike<unknown> }).doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }),
  ).catch(() => undefined)

  expect(requestBody).toMatchObject({ reasoning: { effort: 'max' } })
})

test('createModelSelector builds an Anthropic model once connected', () => {
  setProviderCredential('anthropic', { apiKey: 'sk-ant', baseURL: null })
  const getModel = createModelSelector('')

  expect(() => getModel('anthropic:claude-opus-4-5')).not.toThrow()

  clearProviderCredential('anthropic')
})

test('createModelSelector builds an LM Studio model via the OpenAI-compatible client', () => {
  setProviderCredential('lmstudio', { apiKey: null, baseURL: 'http://localhost:1234/v1' })
  const getModel = createModelSelector('')

  expect(() => getModel('lmstudio:qwen2.5-coder-32b')).not.toThrow()

  clearProviderCredential('lmstudio')
})
