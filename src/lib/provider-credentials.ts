/**
 * Synchronous in-memory cache of provider credentials. Model construction
 * (`RuntimeModelProvider.getModel`) needs to resolve a credential without awaiting a
 * disk read, so the cache is primed once at bootstrap from `~/.gambit/config.json`
 * and kept in sync whenever `/connect` writes a new credential.
 */

import {
  directProviders,
  getProviderDefinition,
  isProviderId,
  type DirectProviderId,
  type ProviderId,
} from './providers'

export interface ProviderCredential {
  apiKey: string | null
  baseURL: string | null
  accessToken?: string | null
  refreshToken?: string | null
  expiresAt?: number | null
  accountId?: string | null
}

const cache = new Map<ProviderId, ProviderCredential>()

function normalize(credential: Partial<ProviderCredential> | null | undefined): ProviderCredential {
  const normalized: ProviderCredential = {
    apiKey: credential?.apiKey?.trim() || null,
    baseURL: credential?.baseURL?.trim() || null,
  }
  const accessToken = credential?.accessToken?.trim() || null
  const refreshToken = credential?.refreshToken?.trim() || null
  const accountId = credential?.accountId?.trim() || null
  const expiresAt = typeof credential?.expiresAt === 'number' && Number.isFinite(credential.expiresAt)
    ? Math.max(0, Math.floor(credential.expiresAt))
    : null

  if (accessToken) normalized.accessToken = accessToken
  if (refreshToken) normalized.refreshToken = refreshToken
  if (expiresAt) normalized.expiresAt = expiresAt
  if (accountId) normalized.accountId = accountId
  return normalized
}

/** Replaces the entire cache, e.g. from a freshly-loaded user config. */
export function primeProviderCredentials(
  providers: Record<string, Partial<ProviderCredential> | null | undefined> | null | undefined,
): void {
  cache.clear()
  if (!providers) {
    return
  }
  for (const [id, credential] of Object.entries(providers)) {
    if (!isProviderId(id)) {
      continue
    }
    const normalized = normalize(credential)
    if (normalized.apiKey || normalized.baseURL || normalized.accessToken || normalized.refreshToken) {
      cache.set(id, normalized)
    }
  }
}

export function setProviderCredential(id: ProviderId, credential: Partial<ProviderCredential>): void {
  cache.set(id, normalize(credential))
}

export function clearProviderCredential(id: ProviderId): void {
  cache.delete(id)
}

/**
 * Resolves a credential for `id`, falling back to the provider's environment
 * variables (`envVar`/`baseUrlEnvVar`) when nothing has been saved via `/connect`.
 * Returns null when the provider isn't connected — callers needing a default base
 * URL for a *connected* local provider apply `definition.defaultBaseURL` themselves.
 */
export function getProviderCredential(id: ProviderId): ProviderCredential | null {
  const cached = cache.get(id)
  const definition = getProviderDefinition(id)
  const envApiKey = definition.envVar ? Bun.env[definition.envVar]?.trim() || null : null
  const envBaseURL = definition.baseUrlEnvVar ? Bun.env[definition.baseUrlEnvVar]?.trim() || null : null

  const apiKey = cached?.apiKey || envApiKey
  const baseURL = cached?.baseURL || envBaseURL || null

  if (definition.authMethod === 'api-key' && !apiKey) {
    return null
  }
  if (definition.authMethod === 'oauth' && !cached?.accessToken && !cached?.refreshToken) {
    return null
  }
  if (definition.authMethod === 'local' && !baseURL) {
    return null
  }

  return {
    ...cached,
    apiKey: apiKey ?? null,
    baseURL: baseURL ?? null,
  }
}

export function isProviderConnected(id: ProviderId): boolean {
  return getProviderCredential(id) !== null
}

export function listConnectedDirectProviderIds(): DirectProviderId[] {
  return directProviders.map((provider) => provider.id).filter((id) => isProviderConnected(id))
}
