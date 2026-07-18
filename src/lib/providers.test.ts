import { expect, test } from 'bun:test'

import {
  buildDirectProviderModelId,
  directProviders,
  findProviderDefinition,
  getDirectProviderDefinition,
  isDirectProviderId,
  isProviderId,
  isDirectProviderModelId,
  parseDirectProviderModelId,
  providers,
} from './providers'

test('registry lists exactly the supported connectable providers', () => {
  expect(providers.map((provider) => provider.id)).toEqual(['openrouter', 'openai', 'chatgpt', 'anthropic', 'lmstudio', 'zai'])
})

test('registry lists exactly the supported direct providers', () => {
  expect(directProviders.map((provider) => provider.id)).toEqual(['openai', 'chatgpt', 'anthropic', 'lmstudio', 'zai'])
})

test('isProviderId accepts all connectable provider ids', () => {
  expect(isProviderId('openrouter')).toBe(true)
  expect(isProviderId('openai')).toBe(true)
  expect(isProviderId('bogus')).toBe(false)
})

test('isDirectProviderId only accepts known provider ids', () => {
  expect(isDirectProviderId('openai')).toBe(true)
  expect(isDirectProviderId('chatgpt')).toBe(true)
  expect(isDirectProviderId('anthropic')).toBe(true)
  expect(isDirectProviderId('lmstudio')).toBe(true)
  expect(isDirectProviderId('zai')).toBe(true)
  expect(isDirectProviderId('openrouter')).toBe(false)
  expect(isDirectProviderId(42)).toBe(false)
})

test('findProviderDefinition is case-insensitive and trims whitespace', () => {
  expect(findProviderDefinition(' OpenRouter ')?.id).toBe('openrouter')
  expect(findProviderDefinition(' OpenAI ')?.id).toBe('openai')
  expect(findProviderDefinition('bogus')).toBeNull()
})

test('getDirectProviderDefinition throws for unknown ids', () => {
  // @ts-expect-error intentionally passing an invalid id to exercise the guard
  expect(() => getDirectProviderDefinition('bogus')).toThrow('Unknown direct provider: bogus')
})

test('buildDirectProviderModelId and parseDirectProviderModelId round-trip', () => {
  const id = buildDirectProviderModelId('openai', 'gpt-4o')
  expect(id).toBe('openai:gpt-4o')
  expect(parseDirectProviderModelId(id)).toEqual({ providerId: 'openai', rawModelId: 'gpt-4o' })
})

test('parseDirectProviderModelId rejects OpenRouter and codex-style ids', () => {
  expect(parseDirectProviderModelId('openai/gpt-4o')).toBeNull()
  expect(parseDirectProviderModelId('codex/gpt-5.1-codex')).toBeNull()
  expect(parseDirectProviderModelId('anthropic/claude-sonnet-4.5')).toBeNull()
})

test('parseDirectProviderModelId rejects malformed or unknown-provider ids', () => {
  expect(parseDirectProviderModelId(':gpt-4o')).toBeNull()
  expect(parseDirectProviderModelId('openai:')).toBeNull()
  expect(parseDirectProviderModelId('unknownprovider:model')).toBeNull()
  expect(parseDirectProviderModelId('plainmodel')).toBeNull()
})

test('isDirectProviderModelId mirrors parseDirectProviderModelId', () => {
  expect(isDirectProviderModelId('lmstudio:qwen2.5-coder-32b')).toBe(true)
  expect(isDirectProviderModelId('zai:glm-4.6')).toBe(true)
  expect(isDirectProviderModelId('openrouter/openai/gpt-4o')).toBe(false)
})
