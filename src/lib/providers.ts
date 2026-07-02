/**
 * Registry of providers configurable through `/connect`.
 *
 * OpenRouter is the routed default for bare `vendor/model` ids. Direct model
 * providers are addressed as `<providerId>:<modelId>`, e.g. `openai:gpt-4o`, to
 * avoid colliding with OpenRouter's own namespace.
 */

export type ProviderId = 'openrouter' | 'openai' | 'chatgpt' | 'anthropic' | 'lmstudio' | 'zai'
export type DirectProviderId = Exclude<ProviderId, 'openrouter'>

export type DirectProviderAuthMethod = 'api-key' | 'oauth' | 'local'

export type ProviderRouting = 'openrouter' | 'direct'

export interface ProviderDefinition {
  id: ProviderId
  name: string
  routing: ProviderRouting
  authMethod: DirectProviderAuthMethod
  /** Environment variable checked as a fallback credential source. */
  envVar?: string
  /** Environment variable checked as a fallback base URL override. */
  baseUrlEnvVar?: string
  /** Default base URL used when the provider is local or self-hosted. */
  defaultBaseURL?: string
  /** Where a user can generate/manage an API key for this provider. */
  docsUrl: string
  /** Short blurb shown in the connect dialog. */
  description: string
  /** Curated model ids used before/if live discovery is unavailable. */
  defaultModels: string[]
}

export const providers: ProviderDefinition[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    routing: 'openrouter',
    authMethod: 'api-key',
    envVar: 'OPENROUTER_API_KEY',
    docsUrl: 'https://openrouter.ai/settings/keys',
    description: 'Connect with an OpenRouter API key.',
    defaultModels: [],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    routing: 'direct',
    authMethod: 'api-key',
    envVar: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/api-keys',
    description: 'Connect with an OpenAI API key.',
    defaultModels: ['gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini'],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Plus/Pro',
    routing: 'direct',
    authMethod: 'oauth',
    docsUrl: 'https://chatgpt.com',
    description: 'Reuse a ChatGPT Plus or Pro subscription with OpenAI OAuth.',
    defaultModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    routing: 'direct',
    authMethod: 'api-key',
    envVar: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Connect with an Anthropic API key.',
    defaultModels: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    routing: 'direct',
    authMethod: 'local',
    baseUrlEnvVar: 'LMSTUDIO_BASE_URL',
    defaultBaseURL: 'http://localhost:1234/v1',
    docsUrl: 'https://lmstudio.ai/docs/local-server',
    description: 'Connect to a local LM Studio server (no API key required).',
    defaultModels: [],
  },
  {
    id: 'zai',
    name: 'Z.AI Coding Plan',
    routing: 'direct',
    authMethod: 'api-key',
    envVar: 'ZAI_API_KEY',
    defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4',
    docsUrl: 'https://z.ai/manage-apikey/apikey-list',
    description: 'Connect with a Z.AI Coding Plan API key.',
    defaultModels: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
  },
]

export const directProviders = providers.filter((provider): provider is ProviderDefinition & { id: DirectProviderId; routing: 'direct' } =>
  provider.routing === 'direct',
)

const providerIds = new Set<ProviderId>(providers.map((provider) => provider.id))
const directProviderIds = new Set<DirectProviderId>(directProviders.map((provider) => provider.id))

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && providerIds.has(value as ProviderId)
}

export function isDirectProviderId(value: unknown): value is DirectProviderId {
  return typeof value === 'string' && directProviderIds.has(value as DirectProviderId)
}

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  const definition = providers.find((provider) => provider.id === id)
  if (!definition) {
    throw new Error(`Unknown provider: ${id}`)
  }
  return definition
}

export function getDirectProviderDefinition(id: DirectProviderId): ProviderDefinition & { id: DirectProviderId; routing: 'direct' } {
  const definition = directProviders.find((provider) => provider.id === id)
  if (!definition) {
    throw new Error(`Unknown direct provider: ${id}`)
  }
  return definition
}

export function findProviderDefinition(id: string): ProviderDefinition | null {
  const normalized = id.trim().toLowerCase()
  return providers.find((provider) => provider.id === normalized) ?? null
}

export interface DirectProviderModelRef {
  providerId: DirectProviderId
  rawModelId: string
}

/**
 * Parses a `<providerId>:<modelId>` addressed model id. Returns null for any other
 * shape (bare OpenRouter ids, `codex/` ids, or malformed input).
 */
export function parseDirectProviderModelId(modelId: string): DirectProviderModelRef | null {
  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0) {
    return null
  }
  const providerId = modelId.slice(0, separatorIndex)
  const rawModelId = modelId.slice(separatorIndex + 1)
  if (!isDirectProviderId(providerId) || !rawModelId) {
    return null
  }
  return { providerId, rawModelId }
}

export function isDirectProviderModelId(modelId: string): boolean {
  return parseDirectProviderModelId(modelId) !== null
}

export function buildDirectProviderModelId(providerId: DirectProviderId, rawModelId: string): string {
  return `${providerId}:${rawModelId}`
}
