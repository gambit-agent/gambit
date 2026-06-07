import { createOpenRouter, type OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

import { refererHeader, titleHeader } from '../config'
import { isCodexModel, modelRequiresApiKey } from './codex-auth'
import { createCodexLanguageModel } from './codex-model'

export type ReasoningEffort = 'low' | 'medium' | 'high'

export { modelRequiresApiKey }

export interface ModelProvider {
  getModel(modelId: string, settings?: OpenRouterProviderOptions): LanguageModel
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

  getModel(modelId: string, settings?: OpenRouterProviderOptions): LanguageModel {
    if (isCodexModel(modelId)) {
      const effort = settings?.reasoning?.enabled && 'effort' in settings.reasoning ? settings.reasoning.effort : null
      return createCodexLanguageModel({
        modelId,
        reasoningEffort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : null,
      })
    }

    return this.openrouter(modelId, settings)
  }
}

export function createModelSelector(apiKey: string): ModelProvider['getModel'] {
  const provider = new RuntimeModelProvider(apiKey)
  return provider.getModel.bind(provider)
}
