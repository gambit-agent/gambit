/**
 * Live model discovery for directly-connected providers, with each provider's
 * curated `defaultModels` list (see `providers.ts`) as a synchronous fallback when
 * fetching fails or a provider has no listing endpoint.
 */

import type { ProviderCredential } from './provider-credentials'
import { fetchOpenRouterModels } from './openrouterModels'
import { type DirectProviderId, type ProviderId, getProviderDefinition } from './providers'

const MODELS_TIMEOUT_MS = 8_000

export interface DirectProviderModel {
  id: string
  name: string
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>
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
    .map((entry) => ({ id: entry.id, name: entry.id }))
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
    .map((entry) => ({ id: entry.id, name: entry.display_name ?? entry.id }))
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
    .map((entry) => ({ id: entry.id, name: entry.id }))
}

function fallbackModels(providerId: DirectProviderId): DirectProviderModel[] {
  return getProviderDefinition(providerId).defaultModels.map((id) => ({ id, name: id }))
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
      return (await fetchOpenRouterModels(credential.apiKey)).map((model) => ({ id: model.id, name: model.name }))
    case 'openai':
      if (!credential.apiKey) throw new Error('OpenAI requires an API key.')
      return fetchOpenAIModels(baseURL ?? 'https://api.openai.com/v1', credential.apiKey)
    case 'chatgpt':
      throw new Error('ChatGPT subscription auth has no model-listing endpoint.')
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
 * failure (network error, unsupported endpoint, missing credential) the curated
 * `defaultModels` fallback is returned instead so the model picker always has
 * something to show.
 */
export async function fetchDirectProviderModels(
  providerId: DirectProviderId,
  credential: ProviderCredential,
): Promise<DirectProviderModel[]> {
  try {
    return await fetchLiveModels(providerId, credential)
  } catch {
    return fallbackModels(providerId)
  }
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
  if (providerId === 'zai' || providerId === 'chatgpt') {
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
