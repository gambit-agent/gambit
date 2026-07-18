/**
 * Fetches and caches model metadata (context length) from the OpenRouter API,
 * with direct-provider id normalization and a static family fallback table.
 */

import { DEFAULT_MODEL_CONTEXT_LENGTH, MODEL_METADATA_TIMEOUT_MS } from '../config'
import { isCodexModel, normalizeCodexModelId } from './codex-auth'

interface ModelInfo {
  id: string
  contextLength: number
}

const cache = new Map<string, ModelInfo>()
let allModelsFetched = false
let allModelsFetchPromise: Promise<void> | null = null

/**
 * Map a direct-provider model id (`anthropic:claude-opus-4-5`, `openai:gpt-5.2`,
 * `chatgpt:gpt-5.2-codex`, `codex/gpt-5.2-codex`, ...) to its OpenRouter
 * equivalent id (`anthropic/claude-opus-4-5`, `openai/gpt-5.2`, ...) so the
 * OpenRouter metadata cache can serve direct-provider models too.
 * Returns null when there is no meaningful OpenRouter equivalent (local models).
 */
export function normalizeModelIdForLookup(modelId: string): string | null {
  if (isCodexModel(modelId)) {
    return `openai/${normalizeCodexModelId(modelId)}`
  }

  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0) {
    return modelId
  }

  const providerId = modelId.slice(0, separatorIndex)
  const rawModelId = modelId.slice(separatorIndex + 1)
  switch (providerId) {
    case 'anthropic':
      return `anthropic/${rawModelId}`
    case 'openai':
    case 'chatgpt':
      return `openai/${rawModelId}`
    case 'zai':
      return `z-ai/${rawModelId}`
    case 'lmstudio':
      // Local models have no OpenRouter listing.
      return null
    default:
      return modelId
  }
}

function isLmStudioModel(modelId: string): boolean {
  return modelId.startsWith('lmstudio:')
}

/**
 * Context length for LM Studio (local) models. Conservative default, but
 * configurable via the GAMBIT_LMSTUDIO_CONTEXT_LENGTH environment variable.
 */
function getLmStudioContextLength(): number {
  const configured = Number.parseInt(
    (typeof Bun !== 'undefined' ? Bun.env : process.env).GAMBIT_LMSTUDIO_CONTEXT_LENGTH ?? '',
    10,
  )
  if (Number.isFinite(configured) && configured > 0) {
    return configured
  }
  return DEFAULT_MODEL_CONTEXT_LENGTH
}

interface StaticContextRule {
  pattern: RegExp
  contextLength: number
}

/**
 * Known model-family context lengths, used when the OpenRouter catalog has no
 * entry (direct providers, offline, codex subscription models).
 * Order matters: the first matching rule wins.
 */
const STATIC_CONTEXT_RULES: readonly StaticContextRule[] = [
  // Claude 1M-context variants (long-context betas are tagged with 1m).
  { pattern: /claude[^\s]*(?:\[1m\]|-1m)/i, contextLength: 1_000_000 },
  // Claude models default to 200k (Sonnet 4.x reaches 1M only via the beta
  // tag matched above).
  { pattern: /claude/i, contextLength: 200_000 },
  // GPT-5 family (including gpt-5.x and codex variants) is 400k.
  { pattern: /gpt-5/i, contextLength: 400_000 },
  { pattern: /codex/i, contextLength: 400_000 },
  // o-series reasoning models.
  { pattern: /\bo[134](?:-mini|-pro)?(?:-|$)/i, contextLength: 200_000 },
  // GPT-4.1 shipped with a 1M context window; gpt-4o is 128k.
  { pattern: /gpt-4\.1/i, contextLength: 1_000_000 },
  { pattern: /gpt-4o/i, contextLength: 128_000 },
  // GLM 4.x (Z.AI) is 200k.
  { pattern: /glm-4/i, contextLength: 200_000 },
  // Gemini 2.x/3.x models are 1M.
  { pattern: /gemini-[23]/i, contextLength: 1_000_000 },
]

/** Resolve a context length from the static family table, if any rule matches. */
export function resolveStaticContextLength(modelId: string): number | null {
  const normalized = normalizeModelIdForLookup(modelId) ?? modelId
  for (const rule of STATIC_CONTEXT_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.contextLength
    }
  }
  return null
}

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

function lookupCachedContextLength(modelId: string, normalizedId: string | null): number | null {
  const direct = cache.get(modelId)
  if (direct) return direct.contextLength
  if (normalizedId) {
    const normalized = cache.get(normalizedId)
    if (normalized) return normalized.contextLength
  }
  return null
}

/**
 * Get the context length for a model. Fetches from OpenRouter API if not
 * cached (normalizing direct-provider ids to their OpenRouter equivalents),
 * then falls back to the static family table.
 */
export async function getModelContextLength(modelId: string, apiKey: string): Promise<number> {
  if (isLmStudioModel(modelId)) {
    return getLmStudioContextLength()
  }

  const normalizedId = normalizeModelIdForLookup(modelId)

  const cached = lookupCachedContextLength(modelId, normalizedId)
  if (cached !== null) return cached

  if (apiKey) await fetchAllModels(apiKey)

  return (
    lookupCachedContextLength(modelId, normalizedId) ??
    resolveStaticContextLength(modelId) ??
    DEFAULT_MODEL_CONTEXT_LENGTH
  )
}

/**
 * Compute the compaction threshold for a given model context length.
 * Triggers at 85% of context to leave room for the response and system prompt.
 */
export function getCompactionThreshold(contextLength: number): number {
  return Math.floor(contextLength * 0.85)
}
