/**
 * Fetches and caches model metadata (context length) from the OpenRouter API.
 */

import { DEFAULT_MODEL_CONTEXT_LENGTH, MODEL_METADATA_TIMEOUT_MS } from '../config'
import { isCodexModel } from './codex-auth'

export interface ModelInfo {
  id: string
  contextLength: number
}

const cache = new Map<string, ModelInfo>()
let allModelsFetched = false
let allModelsFetchPromise: Promise<void> | null = null

/**
 * Fetch all models from OpenRouter and populate the cache.
 */
async function fetchAllModels(apiKey: string): Promise<void> {
  if (allModelsFetched) return
  if (allModelsFetchPromise) return allModelsFetchPromise

  allModelsFetchPromise = (async () => {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(MODEL_METADATA_TIMEOUT_MS),
      })

      if (!response.ok) return

      const data = (await response.json()) as { data?: Array<{ id?: string; context_length?: number }> }
      if (!Array.isArray(data.data)) return

      for (const model of data.data) {
        if (typeof model.id === 'string' && typeof model.context_length === 'number') {
          cache.set(model.id, {
            id: model.id,
            contextLength: model.context_length,
          })
        }
      }

      allModelsFetched = true
    } catch {
      // Silently fail — we'll use fallback
    } finally {
      allModelsFetchPromise = null
    }
  })()

  return allModelsFetchPromise
}

/**
 * Get the context length for a model. Fetches from OpenRouter API if not cached.
 */
export async function getModelContextLength(modelId: string, apiKey: string): Promise<number> {
  if (isCodexModel(modelId)) return DEFAULT_MODEL_CONTEXT_LENGTH

  const cached = cache.get(modelId)
  if (cached) return cached.contextLength

  if (apiKey) await fetchAllModels(apiKey)

  return cache.get(modelId)?.contextLength ?? DEFAULT_MODEL_CONTEXT_LENGTH
}

/**
 * Compute the compaction threshold for a given model context length.
 * Triggers at 85% of context to leave room for the response and system prompt.
 */
export function getCompactionThreshold(contextLength: number): number {
  return Math.floor(contextLength * 0.85)
}

/**
 * Reset the cache (for testing).
 */
export function resetModelInfoCache(): void {
  cache.clear()
  allModelsFetched = false
  allModelsFetchPromise = null
}
