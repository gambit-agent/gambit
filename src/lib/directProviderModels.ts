/**
 * Live model discovery for directly-connected providers, with each provider's
 * curated `defaultModels` list (see `providers.ts`) as a synchronous fallback when
 * fetching fails or a provider has no listing endpoint.
 */

import { appVersion } from '../app/version'
import { writeProviderCredential } from '../session/user-config'
import { getCodexAuthToken, type CodexAuthToken } from './codex-auth'
import { resolveChatGptAuthToken } from './chatgpt-oauth'
import { isReasoningEffort, type ReasoningEffort } from './model'
import { fetchOpenRouterModels } from './openrouterModels'
import { setProviderCredential, type ProviderCredential } from './provider-credentials'
import { type DirectProviderId, type ProviderId, getProviderDefinition } from './providers'

const MODELS_TIMEOUT_MS = 8_000

/**
 * The ChatGPT backend gates `/backend-api/codex/models` on the *Codex CLI*
 * version scheme: anything below ~1.0.0 gets an empty `models` list with HTTP
 * 200. Gambit's own version (0.x) is below that cutoff, so a pinned
 * Codex-compatible version is sent instead of `appVersion`.
 */
const CHATGPT_MODELS_CLIENT_VERSION = '1.0.0'

export interface DirectProviderModel {
  id: string
  name: string
  description: string | null
  reasoningEfforts: readonly ReasoningEffort[] | null
  defaultReasoningEffort: ReasoningEffort | null
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>
}

interface ChatGptModelEntry {
  slug?: string
  display_name?: string
  description?: string | null
  visibility?: string
  priority?: number
  default_reasoning_level?: string | null
  supported_reasoning_levels?: Array<{ effort?: string }>
}

interface ChatGptModelsResponse {
  models?: ChatGptModelEntry[]
}

const OPENAI_GPT_56_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const OPENAI_FRONTIER_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const
const OPENAI_PRO_EFFORTS = ['medium', 'high', 'xhigh'] as const
const OPENAI_GPT_5_PRO_EFFORTS = ['high'] as const
const OPENAI_GPT_5_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
const OPENAI_O_SERIES_EFFORTS = ['low', 'medium', 'high'] as const

function getOpenAIReasoningEfforts(modelId: string): readonly ReasoningEffort[] | null {
  const normalized = modelId.toLowerCase()
  if (/^gpt-5\.6(?:-|$)/.test(normalized)) return OPENAI_GPT_56_EFFORTS
  if (/^gpt-5-pro(?:-|$)/.test(normalized)) return OPENAI_GPT_5_PRO_EFFORTS
  if (/^gpt-5\.(?:[2-5])-pro(?:-|$)/.test(normalized)) return OPENAI_PRO_EFFORTS
  if (/^gpt-5\.(?:[2-5])(?:-|$)/.test(normalized)) return OPENAI_FRONTIER_EFFORTS
  if (/^gpt-5(?:-|$)/.test(normalized) && !normalized.includes('-chat-')) return OPENAI_GPT_5_EFFORTS
  if (/^o[1-9](?:-|$)/.test(normalized)) return OPENAI_O_SERIES_EFFORTS
  return null
}

function getOpenAIDefaultReasoningEffort(
  modelId: string,
  reasoningEfforts: readonly ReasoningEffort[] | null,
): ReasoningEffort | null {
  if (/^gpt-5(?:\.5)?-pro(?:-|$)/i.test(modelId)) return 'high'
  return reasoningEfforts?.includes('medium') ? 'medium' : reasoningEfforts?.[0] ?? null
}

function buildModel(
  id: string,
  name: string = id,
  options: {
    description?: string | null
    reasoningEfforts?: readonly ReasoningEffort[] | null
    defaultReasoningEffort?: ReasoningEffort | null
  } = {},
): DirectProviderModel {
  return {
    id,
    name,
    description: options.description ?? null,
    reasoningEfforts: options.reasoningEfforts ?? null,
    defaultReasoningEffort: options.defaultReasoningEffort ?? null,
  }
}

async function fetchOpenAIModels(baseURL: string, apiKey: string): Promise<DirectProviderModel[]> {
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Failed to list OpenAI models (status ${response.status}).`)
  }
  const payload = (await response.json()) as OpenAIModelsResponse
  return (payload.data ?? [])
    .filter((entry): entry is { id: string } => typeof entry.id === 'string' && entry.id.length > 0)
    .filter((entry) => !/embedding|whisper|tts|dall-e|davinci|babbage|moderation/i.test(entry.id))
    .map((entry) => {
      const reasoningEfforts = getOpenAIReasoningEfforts(entry.id)
      return buildModel(entry.id, entry.id, {
        reasoningEfforts,
        defaultReasoningEffort: getOpenAIDefaultReasoningEffort(entry.id, reasoningEfforts),
      })
    })
}

async function fetchAnthropicModels(baseURL: string, apiKey: string): Promise<DirectProviderModel[]> {
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Failed to list Anthropic models (status ${response.status}).`)
  }
  const payload = (await response.json()) as AnthropicModelsResponse
  return (payload.data ?? [])
    .filter((entry): entry is { id: string; display_name?: string } => typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry) => buildModel(entry.id, entry.display_name ?? entry.id))
}

async function fetchOpenAICompatibleModels(baseURL: string, apiKey: string | null): Promise<DirectProviderModel[]> {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
    headers,
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Failed to list models (status ${response.status}).`)
  }
  const payload = (await response.json()) as OpenAIModelsResponse
  return (payload.data ?? [])
    .filter((entry): entry is { id: string } => typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry) => buildModel(entry.id))
}

async function fetchChatGptModels(token: CodexAuthToken): Promise<DirectProviderModel[]> {
  const response = await fetch(
    `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(CHATGPT_MODELS_CLIENT_VERSION)}`,
    {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'chatgpt-account-id': token.accountId,
        originator: 'gambit',
        'User-Agent': `gambit/${appVersion}`,
      },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    },
  )
  if (!response.ok) {
    throw new Error(`Failed to list ChatGPT models (status ${response.status}).`)
  }

  const payload = (await response.json()) as ChatGptModelsResponse
  return (payload.models ?? [])
    .filter((entry): entry is ChatGptModelEntry & { slug: string } =>
      typeof entry.slug === 'string'
      && entry.slug.length > 0
      && (entry.visibility === undefined || entry.visibility === 'list'),
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((entry) => {
      const reasoningEfforts = Array.from(new Set(
        (entry.supported_reasoning_levels ?? [])
          .map((level) => level.effort)
          .filter(isReasoningEffort),
      ))
      const defaultReasoningEffort = isReasoningEffort(entry.default_reasoning_level)
        ? entry.default_reasoning_level
        : null
      return buildModel(entry.slug, entry.display_name ?? entry.slug, {
        description: entry.description,
        reasoningEfforts: reasoningEfforts.length > 0 ? reasoningEfforts : null,
        defaultReasoningEffort,
      })
    })
}

function fallbackModels(providerId: DirectProviderId): DirectProviderModel[] {
  return getProviderDefinition(providerId).defaultModels.map((id) => {
    if (providerId === 'openai') {
      const reasoningEfforts = getOpenAIReasoningEfforts(id)
      return buildModel(id, id, {
        reasoningEfforts,
        defaultReasoningEffort: getOpenAIDefaultReasoningEffort(id, reasoningEfforts),
      })
    }
    if (providerId === 'chatgpt') {
      const reasoningEfforts = getOpenAIReasoningEfforts(id) ?? OPENAI_FRONTIER_EFFORTS
      return buildModel(id, id, {
        reasoningEfforts,
        defaultReasoningEffort: getOpenAIDefaultReasoningEffort(id, reasoningEfforts),
      })
    }
    return buildModel(id)
  })
}

/**
 * Raw per-provider live fetch. Throws on failure (network error, bad
 * credential, unsupported endpoint) so callers can distinguish "verified" from
 * "fell back to the curated list".
 */
async function fetchLiveModels(providerId: ProviderId, credential: ProviderCredential): Promise<DirectProviderModel[]> {
  const definition = getProviderDefinition(providerId)
  const baseURL = credential.baseURL || definition.defaultBaseURL

  switch (providerId) {
    case 'openrouter':
      if (!credential.apiKey) throw new Error('OpenRouter requires an API key.')
      return (await fetchOpenRouterModels(credential.apiKey)).map((model) => buildModel(model.id, model.name, {
        description: model.description,
      }))
    case 'openai':
      if (!credential.apiKey) throw new Error('OpenAI requires an API key.')
      return fetchOpenAIModels(baseURL ?? 'https://api.openai.com/v1', credential.apiKey)
    case 'chatgpt':
      return fetchChatGptModels(await resolveChatGptAuthToken(credential, async (refreshed) => {
        setProviderCredential('chatgpt', refreshed)
        await writeProviderCredential('chatgpt', refreshed)
      }))
    case 'anthropic':
      if (!credential.apiKey) throw new Error('Anthropic requires an API key.')
      return fetchAnthropicModels(baseURL ?? 'https://api.anthropic.com/v1', credential.apiKey)
    case 'lmstudio':
      if (!baseURL) throw new Error('LM Studio requires a base URL.')
      return fetchOpenAICompatibleModels(baseURL, credential.apiKey)
    case 'zai':
      // The coding-plan endpoint does not expose a reliable listing route.
      throw new Error('Z.AI Coding Plan has no model-listing endpoint.')
  }
}

/**
 * Fetches the live model list for a connected provider. Never throws: on any
 * failure (network error, unsupported endpoint, missing credential) — or when
 * the provider "succeeds" with an empty list — the curated `defaultModels`
 * fallback is returned instead so the model picker always has something to show.
 */
export async function fetchDirectProviderModels(
  providerId: DirectProviderId,
  credential: ProviderCredential,
): Promise<DirectProviderModel[]> {
  try {
    const models = await fetchLiveModels(providerId, credential)
    return models.length > 0 ? models : fallbackModels(providerId)
  } catch {
    return fallbackModels(providerId)
  }
}

/** Fetches the live catalog for the subscription token managed by `codex login`. */
export async function fetchCodexSubscriptionModels(): Promise<DirectProviderModel[]> {
  return fetchChatGptModels(await getCodexAuthToken())
}

export interface ProviderConnectionTestResult {
  ok: boolean
  /** Set when the provider has no reliable way to verify a credential (e.g. Z.AI). */
  unverifiable: boolean
  error: string | null
}

/**
 * Actively verifies a credential against the provider's API. Used by the
 * `/connect` dialog before persisting a credential. Providers with no reliable
 * listing endpoint (Z.AI Coding Plan) are reported as `unverifiable` rather than
 * failed, so the dialog can save the credential on trust.
 */
export async function testProviderConnection(
  providerId: ProviderId,
  credential: ProviderCredential,
): Promise<ProviderConnectionTestResult> {
  if (providerId === 'zai') {
    return { ok: true, unverifiable: true, error: null }
  }

  try {
    await fetchLiveModels(providerId, credential)
    return { ok: true, unverifiable: false, error: null }
  } catch (error) {
    return { ok: false, unverifiable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Synchronous curated list, used to render immediately while a live fetch (if any)
 * is still in flight.
 */
export function getDefaultDirectProviderModels(providerId: DirectProviderId): DirectProviderModel[] {
  return fallbackModels(providerId)
}
