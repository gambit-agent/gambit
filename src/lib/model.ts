import { createOpenRouter, type OpenRouterChatSettings } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

import { refererHeader, titleHeader } from '../config'
import { isCodexModel, modelRequiresApiKey } from './codex-auth'
import { createCodexLanguageModel } from './codex-model'

export const reasoningEfforts = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const
export type ReasoningEffort = (typeof reasoningEfforts)[number]

export const codexReasoningEfforts = ['low', 'medium', 'high'] as const
export type CodexReasoningEffort = (typeof codexReasoningEfforts)[number]

export interface ModelRuntimeOptions {
  reasoningEffort?: ReasoningEffort | null
  providerSlug?: string | null
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && reasoningEfforts.includes(value as ReasoningEffort)
}

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return typeof value === 'string' && codexReasoningEfforts.includes(value as CodexReasoningEffort)
}

export function normalizeProviderSlug(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().toLowerCase().replace(/^provider\s*[:=]\s*/, '')
  if (!trimmed) {
    return null
  }
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(trimmed)) {
    return null
  }
  return trimmed
}

export function buildOpenRouterModelSettings(options: ModelRuntimeOptions): OpenRouterChatSettings | undefined {
  const settings: OpenRouterChatSettings = {}
  if (options.reasoningEffort) {
    settings.reasoning = { enabled: true, effort: options.reasoningEffort }
  }
  if (options.providerSlug) {
    settings.provider = {
      order: [options.providerSlug],
      allow_fallbacks: false,
    }
  }
  return Object.keys(settings).length > 0 ? settings : undefined
}

export { modelRequiresApiKey }

export interface ModelProvider {
  getModel(modelId: string, settings?: OpenRouterChatSettings): LanguageModel
}

class RuntimeModelProvider implements ModelProvider {
  private readonly openrouter: ReturnType<typeof createOpenRouter>

  constructor(apiKey: string) {
    this.openrouter = createOpenRouter({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': refererHeader,
        'X-Title': titleHeader,
      },
    })
  }

  getModel(modelId: string, settings?: OpenRouterChatSettings): LanguageModel {
    if (isCodexModel(modelId)) {
      const effort = settings?.reasoning?.enabled && 'effort' in settings.reasoning ? settings.reasoning.effort : null
      return createCodexLanguageModel({
        modelId,
        reasoningEffort: isCodexReasoningEffort(effort) ? effort : null,
      })
    }

    return this.openrouter(modelId, settings)
  }
}

export function createModelSelector(apiKey: string): ModelProvider['getModel'] {
  const provider = new RuntimeModelProvider(apiKey)
  return provider.getModel.bind(provider)
}
