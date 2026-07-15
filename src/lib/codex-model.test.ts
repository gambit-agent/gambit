import { expect, test } from 'bun:test'
import type { LanguageModelV2CallOptions } from '@ai-sdk/provider'

import { buildRequestBody } from './codex-model'

const baseOptions: LanguageModelV2CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

test('includes prompt_cache_key when a cache key is provided', () => {
  const body = buildRequestBody('gpt-5.1-codex', {
    ...baseOptions,
    providerOptions: { openai: { promptCacheKey: 'conversation-123' } },
  })

  expect(body.prompt_cache_key).toBe('conversation-123')
})

test('omits prompt_cache_key when no cache key is provided', () => {
  const body = buildRequestBody('gpt-5.1-codex', baseOptions)

  expect(body).not.toHaveProperty('prompt_cache_key')
})

test('maps cached input tokens from the responses usage payload', async () => {
  const { extractUsage } = await import('./codex-model')

  expect(
    extractUsage({
      input_tokens: 2620,
      input_tokens_details: { cached_tokens: 2304, cache_write_tokens: 0 },
      output_tokens: 5,
      total_tokens: 2625,
    }),
  ).toEqual({ inputTokens: 2620, outputTokens: 5, totalTokens: 2625, cachedInputTokens: 2304 })

  expect(extractUsage({ input_tokens: 10, output_tokens: 2 }).cachedInputTokens).toBeUndefined()
})
