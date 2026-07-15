import { expect, test } from 'bun:test'

import {
  buildModelSearchText,
  filterModels,
  getAllowedReasoningEfforts,
  isFreeModel,
  isOpenRouterRoutedModel,
  mergePreservingProviderModels,
  replaceProviderModels,
} from './modelPicker'
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
    reasoningEfforts: overrides.reasoningEfforts ?? null,
    defaultReasoningEffort: overrides.defaultReasoningEffort ?? null,
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

test('replaceProviderModels keeps OpenRouter entries whose vendor matches a direct provider id', () => {
  const current = [
    model({ id: 'openai/gpt-5' }),
    model({ id: 'openai/gpt-4o' }),
    model({ id: 'openai:gpt-4o', provider: 'openai' }),
  ]
  const replacement = [model({ id: 'openai:gpt-5.6', provider: 'openai' })]

  expect(replaceProviderModels(current, 'openai', replacement).map((entry) => entry.id)).toEqual([
    'openai/gpt-5',
    'openai/gpt-4o',
    'openai:gpt-5.6',
  ])
})

test('replaceProviderModels only replaces codex/ entries for the codex provider', () => {
  const current = [
    model({ id: 'openai/gpt-5' }),
    model({ id: 'codex/gpt-5.4', provider: 'codex' }),
  ]
  const replacement = [model({ id: 'codex/gpt-5.6', provider: 'codex' })]

  expect(replaceProviderModels(current, 'codex', replacement).map((entry) => entry.id)).toEqual([
    'openai/gpt-5',
    'codex/gpt-5.6',
  ])
})

test('mergePreservingProviderModels keeps direct and codex entries across catalog refreshes', () => {
  const current = [
    model({ id: 'qwen/qwen3.6-plus' }),
    model({ id: 'codex/gpt-5.6', provider: 'codex' }),
    model({ id: 'chatgpt:gpt-5.6', provider: 'chatgpt' }),
  ]
  const catalog = [
    model({ id: 'openai/gpt-5' }),
    model({ id: 'anthropic/claude-sonnet-4' }),
    model({ id: 'chatgpt:gpt-5.6', provider: 'chatgpt', name: 'stale curated entry' }),
  ]

  const merged = mergePreservingProviderModels(catalog, current)

  expect(merged.map((entry) => entry.id)).toEqual([
    'openai/gpt-5',
    'anthropic/claude-sonnet-4',
    'codex/gpt-5.6',
    'chatgpt:gpt-5.6',
  ])
  // The live-fetched entry wins over the curated duplicate from the new base list.
  expect(merged.find((entry) => entry.id === 'chatgpt:gpt-5.6')?.name).toBe('chatgpt:gpt-5.6')
})

test('uses model-specific effort levels from a live provider catalog', () => {
  const directModel = model({
    id: 'chatgpt:gpt-5.6',
    provider: 'chatgpt',
    supportsReasoning: true,
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
  })

  expect(getAllowedReasoningEfforts(directModel)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
})
