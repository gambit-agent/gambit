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

export const reasoningEfforts = ['ultra', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const
export type KnownReasoningEffort = (typeof reasoningEfforts)[number]
export type ReasoningEffort = KnownReasoningEffort | (string & {})

export const openRouterReasoningEfforts = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const
export type OpenRouterReasoningEffort = (typeof openRouterReasoningEfforts)[number]

export const codexReasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export interface ModelRuntimeOptions {
  reasoningEffort?: ReasoningEffort | null
  providerSlug?: string | null
}

export type ModelRuntimeSettings = ModelRuntimeOptions

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value)
}

export function isOpenRouterReasoningEffort(value: unknown): value is OpenRouterReasoningEffort {
  return typeof value === 'string' && openRouterReasoningEfforts.includes(value as OpenRouterReasoningEffort)
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

export function buildModelRuntimeSettings(options: ModelRuntimeOptions): ModelRuntimeSettings | undefined {
  return options.reasoningEffort || options.providerSlug ? options : undefined
}

export function buildOpenRouterModelSettings(options: ModelRuntimeOptions): OpenRouterChatSettings | undefined {
  const settings: OpenRouterChatSettings = {}
  if (isOpenRouterReasoningEffort(options.reasoningEffort)) {
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
  getModel(modelId: string, settings?: ModelRuntimeSettings): LanguageModel
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

  getModel(modelId: string, settings?: ModelRuntimeSettings): LanguageModel {
    const reasoningEffort = settings?.reasoningEffort ?? null
    if (isCodexModel(modelId)) {
      return createCodexLanguageModel({
        modelId,
        reasoningEffort,
      })
    }

    const directProviderRef = parseDirectProviderModelId(modelId)
    if (directProviderRef) {
      return buildDirectProviderModel(directProviderRef.providerId, directProviderRef.rawModelId, reasoningEffort)
    }

    return this.openrouter(modelId, buildOpenRouterModelSettings(settings ?? {}))
  }
}

function buildDirectProviderModel(
  providerId: DirectProviderId,
  rawModelId: string,
  reasoningEffort: ReasoningEffort | null,
): LanguageModel {
  const definition = getDirectProviderDefinition(providerId)
  const credential = getProviderCredential(providerId)
  if (!credential) {
    throw new Error(`${definition.name} is not connected. Run /connect to add it.`)
  }

  switch (providerId) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: credential.apiKey ?? undefined, baseURL: credential.baseURL ?? undefined })
      return withOpenAIReasoning(openai.responses(rawModelId), reasoningEffort)
    }
    case 'chatgpt':
      return createCodexLanguageModel({
        modelId: rawModelId,
        reasoningEffort,
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

function withOpenAIReasoning(model: LanguageModel, reasoningEffort: ReasoningEffort | null): LanguageModel {
  if (!reasoningEffort) {
    return model
  }

  return new Proxy(model as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if ((property !== 'doGenerate' && property !== 'doStream') || typeof value !== 'function') {
        return value
      }
      return (options: { providerOptions?: Record<string, Record<string, unknown>> }) => value.call(target, {
        ...options,
        providerOptions: {
          ...options.providerOptions,
          openai: {
            ...options.providerOptions?.openai,
            forceReasoning: true,
            reasoningEffort,
          },
        },
      })
    },
  }) as LanguageModel
}

export function createModelSelector(apiKey: string): ModelProvider['getModel'] {
  const provider = new RuntimeModelProvider(apiKey)
  return provider.getModel.bind(provider)
}
