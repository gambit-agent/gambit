import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter, type OpenRouterChatSettings } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

import { refererHeader, titleHeader } from '../config'
import { isCodexModel, modelRequiresApiKey } from './codex-auth'
import { createCodexLanguageModel } from './codex-model'
import { resolveChatGptAuthToken } from './chatgpt-oauth'
import { getProviderCredential, setProviderCredential } from './provider-credentials'
import {
  getDirectProviderDefinition,
  isDirectProviderModelId,
  parseDirectProviderModelId,
  type DirectProviderId,
} from './providers'
import { writeProviderCredential } from '../session/user-config'

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

/**
 * Whether running `modelId` requires an OpenRouter API key. Codex models use a
 * subscription token instead, and direct-provider models (`openai:`, `chatgpt:`,
 * `anthropic:`, `lmstudio:`, `zai:`) use their own connected credential (see `/connect`).
 */
export function modelNeedsOpenRouterApiKey(modelId: string): boolean {
  return modelRequiresApiKey(modelId) && !isDirectProviderModelId(modelId)
}

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

    const directProviderRef = parseDirectProviderModelId(modelId)
    if (directProviderRef) {
      return buildDirectProviderModel(directProviderRef.providerId, directProviderRef.rawModelId)
    }

    return this.openrouter(modelId, settings)
  }
}

function buildDirectProviderModel(providerId: DirectProviderId, rawModelId: string): LanguageModel {
  const definition = getDirectProviderDefinition(providerId)
  const credential = getProviderCredential(providerId)
  if (!credential) {
    throw new Error(`${definition.name} is not connected. Run /connect to add it.`)
  }

  switch (providerId) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: credential.apiKey ?? undefined, baseURL: credential.baseURL ?? undefined })
      return openai(rawModelId)
    }
    case 'chatgpt':
      return createCodexLanguageModel({
        modelId: rawModelId,
        authToken: async () => resolveChatGptAuthToken(
          getProviderCredential('chatgpt') ?? credential,
          async (refreshed) => {
            setProviderCredential('chatgpt', refreshed)
            await writeProviderCredential('chatgpt', refreshed)
          },
        ),
      })
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: credential.apiKey ?? undefined, baseURL: credential.baseURL ?? undefined })
      return anthropic(rawModelId)
    }
    case 'lmstudio':
    case 'zai': {
      const baseURL = credential.baseURL ?? definition.defaultBaseURL
      if (!baseURL) {
        throw new Error(`${definition.name} has no base URL configured. Run /connect to add it.`)
      }
      const compatible = createOpenAICompatible({
        name: providerId,
        baseURL,
        apiKey: credential.apiKey ?? 'placeholder',
      })
      return compatible(rawModelId)
    }
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}

export function createModelSelector(apiKey: string): ModelProvider['getModel'] {
  const provider = new RuntimeModelProvider(apiKey)
  return provider.getModel.bind(provider)
}
