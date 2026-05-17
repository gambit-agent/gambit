import { createOpenRouter, type OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'

import { refererHeader, titleHeader } from '../config'
import { isCodexModel, modelRequiresApiKey } from './codex-auth'
import { createCodexLanguageModel } from './codex-model'

export type ReasoningEffort = 'low' | 'medium' | 'high'

export { isCodexModel, modelRequiresApiKey }

export function createModelSelector(apiKey: string) {
  const openrouter = createOpenRouter({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': refererHeader,
      'X-Title': titleHeader,
    },
  })

  return (modelId: string, settings?: OpenRouterProviderOptions) => {
    if (isCodexModel(modelId)) {
      const effort = settings?.reasoning?.enabled && 'effort' in settings.reasoning ? settings.reasoning.effort : null
      return createCodexLanguageModel({
        modelId,
        reasoningEffort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : null,
      })
    }

    return openrouter(modelId, settings)
  }
}
