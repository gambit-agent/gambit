import { expect, test } from 'bun:test'

import { buildModelSearchText, filterModels, isFreeModel, isOpenRouterRoutedModel } from './modelPicker'
import type { ModelListItem } from './openrouterModels'

function model(overrides: Partial<ModelListItem> & Pick<ModelListItem, 'id'>): ModelListItem {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    description: overrides.description ?? null,
    provider: overrides.provider ?? (overrides.id.includes('/') ? overrides.id.split('/')[0] ?? null : null),
    promptPrice: overrides.promptPrice ?? null,
    completionPrice: overrides.completionPrice ?? null,
    requestPrice: overrides.requestPrice ?? null,
    supportsReasoning: overrides.supportsReasoning ?? false,
  }
}

const models = [
  model({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', promptPrice: '0.000003', completionPrice: '0.000015' }),
  model({ id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek Chat V3 Free', promptPrice: '0', completionPrice: '0' }),
  model({ id: 'google/gemini-flash', name: 'Gemini Flash', description: 'Fast zero-cost preview', promptPrice: '0', completionPrice: '0' }),
  model({ id: 'openai/gpt-5', name: 'GPT-5', supportsReasoning: true }),
]

test('detects free models from ids and zero prices', () => {
  expect(isFreeModel(models[0]!)).toBe(false)
  expect(isFreeModel(models[1]!)).toBe(true)
  expect(isFreeModel(models[2]!)).toBe(true)
})

test('builds searchable model text with tags', () => {
  const searchText = buildModelSearchText(models[3]!)

  expect(searchText).toContain('openai/gpt-5')
  expect(searchText).toContain('reasoning')
  expect(searchText).toContain('gpt5')
})

test('filters models by free tag, provider, description, and multiple terms', () => {
  expect(filterModels(models, 'free').map((entry) => entry.id)).toEqual([
    'deepseek/deepseek-chat-v3-0324:free',
    'google/gemini-flash',
  ])
  expect(filterModels(models, 'zero-cost').map((entry) => entry.id)).toEqual(['google/gemini-flash'])
  expect(filterModels(models, 'deepseek free').map((entry) => entry.id)).toEqual([
    'deepseek/deepseek-chat-v3-0324:free',
  ])
  expect(filterModels(models, 'reasoning gpt5').map((entry) => entry.id)).toEqual(['openai/gpt-5'])
})

test('isOpenRouterRoutedModel is true for OpenRouter ids, false for codex and direct-provider ids', () => {
  expect(isOpenRouterRoutedModel({ id: 'openai/gpt-5' })).toBe(true)
  expect(isOpenRouterRoutedModel({ id: 'codex/gpt-5.1-codex' })).toBe(false)
  expect(isOpenRouterRoutedModel({ id: 'openai:gpt-4o' })).toBe(false)
  expect(isOpenRouterRoutedModel({ id: 'chatgpt:gpt-5.5' })).toBe(false)
  expect(isOpenRouterRoutedModel({ id: 'lmstudio:qwen2.5-coder-32b' })).toBe(false)
})
