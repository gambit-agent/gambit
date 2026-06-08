import { expect, test } from 'bun:test'

import { buildOpenRouterModelSettings, normalizeProviderSlug } from './model'

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
