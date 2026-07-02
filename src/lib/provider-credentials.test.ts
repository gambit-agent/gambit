import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  clearProviderCredential,
  getProviderCredential,
  isProviderConnected,
  listConnectedDirectProviderIds,
  primeProviderCredentials,
  setProviderCredential,
} from './provider-credentials'

const envKeysUnderTest = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ZAI_API_KEY', 'LMSTUDIO_BASE_URL']
const savedEnv = new Map<string, string | undefined>()

beforeEach(() => {
  primeProviderCredentials({})
  for (const key of envKeysUnderTest) {
    savedEnv.set(key, Bun.env[key])
    delete Bun.env[key]
  }
})

afterEach(() => {
  primeProviderCredentials({})
  for (const key of envKeysUnderTest) {
    const value = savedEnv.get(key)
    if (value === undefined) {
      delete Bun.env[key]
    } else {
      Bun.env[key] = value
    }
  }
})

test('an unconfigured provider is not connected', () => {
  expect(isProviderConnected('openai')).toBe(false)
  expect(getProviderCredential('openai')).toBeNull()
})

test('setProviderCredential connects an api-key provider', () => {
  setProviderCredential('openai', { apiKey: 'sk-test', baseURL: null })

  expect(isProviderConnected('openai')).toBe(true)
  expect(getProviderCredential('openai')).toEqual({ apiKey: 'sk-test', baseURL: null })
})

test('setProviderCredential connects OpenRouter through the provider store', () => {
  setProviderCredential('openrouter', { apiKey: 'sk-or', baseURL: null })

  expect(isProviderConnected('openrouter')).toBe(true)
  expect(getProviderCredential('openrouter')).toEqual({ apiKey: 'sk-or', baseURL: null })
})

test('setProviderCredential connects an oauth provider', () => {
  setProviderCredential('chatgpt', {
    apiKey: null,
    baseURL: null,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 123,
    accountId: 'account-id',
  })

  expect(isProviderConnected('chatgpt')).toBe(true)
  expect(getProviderCredential('chatgpt')).toEqual({
    apiKey: null,
    baseURL: null,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 123,
    accountId: 'account-id',
  })
})

test('clearProviderCredential disconnects a provider', () => {
  setProviderCredential('anthropic', { apiKey: 'sk-ant', baseURL: null })
  clearProviderCredential('anthropic')

  expect(isProviderConnected('anthropic')).toBe(false)
})

test('primeProviderCredentials loads a saved config snapshot and ignores unknown ids', () => {
  primeProviderCredentials({
    openai: { apiKey: 'sk-openai', baseURL: null },
    'not-a-provider': { apiKey: 'sk-x', baseURL: null },
  })

  expect(isProviderConnected('openai')).toBe(true)
  expect(isProviderConnected('anthropic')).toBe(false)
})

test('local providers are connected once a base URL is present', () => {
  expect(isProviderConnected('lmstudio')).toBe(false)

  setProviderCredential('lmstudio', { apiKey: null, baseURL: 'http://localhost:1234/v1' })

  expect(isProviderConnected('lmstudio')).toBe(true)
  expect(getProviderCredential('lmstudio')).toEqual({ apiKey: null, baseURL: 'http://localhost:1234/v1' })
})

test('cached api-key credentials do not include a base URL unless explicitly saved', () => {
  setProviderCredential('zai', { apiKey: 'zai-key', baseURL: null })

  expect(getProviderCredential('zai')).toEqual({ apiKey: 'zai-key', baseURL: null })
})

test('environment variables are used when nothing is cached', () => {
  Bun.env.OPENAI_API_KEY = 'sk-from-env'

  expect(isProviderConnected('openai')).toBe(true)
  expect(getProviderCredential('openai')).toEqual({ apiKey: 'sk-from-env', baseURL: null })
})

test('cached credentials take priority over environment variables', () => {
  Bun.env.OPENAI_API_KEY = 'sk-from-env'
  setProviderCredential('openai', { apiKey: 'sk-from-cache', baseURL: null })

  expect(getProviderCredential('openai')?.apiKey).toBe('sk-from-cache')
})

test('listConnectedDirectProviderIds only returns direct providers with a usable credential', () => {
  setProviderCredential('openrouter', { apiKey: 'sk-or', baseURL: null })
  setProviderCredential('openai', { apiKey: 'sk-openai', baseURL: null })
  setProviderCredential('chatgpt', { apiKey: null, baseURL: null, refreshToken: 'refresh-token' })
  setProviderCredential('lmstudio', { apiKey: null, baseURL: 'http://localhost:1234/v1' })

  expect(listConnectedDirectProviderIds().sort()).toEqual(['chatgpt', 'lmstudio', 'openai'])
})
