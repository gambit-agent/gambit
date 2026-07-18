import { afterEach, describe, expect, it } from 'bun:test'

import {
  getCompactionThreshold,
  getModelContextLength,
  normalizeModelIdForLookup,
  resolveStaticContextLength,
} from './model-info'

// All tests pass an empty API key so no OpenRouter fetch is attempted.
const NO_KEY = ''

describe('normalizeModelIdForLookup', () => {
  it('maps direct provider ids to their OpenRouter equivalents', () => {
    expect(normalizeModelIdForLookup('anthropic:claude-opus-4-5')).toBe('anthropic/claude-opus-4-5')
    expect(normalizeModelIdForLookup('openai:gpt-5.2')).toBe('openai/gpt-5.2')
    expect(normalizeModelIdForLookup('chatgpt:gpt-5.2-codex')).toBe('openai/gpt-5.2-codex')
    expect(normalizeModelIdForLookup('zai:glm-4.6')).toBe('z-ai/glm-4.6')
  })

  it('maps codex subscription ids to openai ids', () => {
    expect(normalizeModelIdForLookup('codex/gpt-5.2-codex')).toBe('openai/gpt-5.2-codex')
    expect(normalizeModelIdForLookup('openai-codex/gpt-5.2')).toBe('openai/gpt-5.2')
  })

  it('passes OpenRouter ids through unchanged', () => {
    expect(normalizeModelIdForLookup('anthropic/claude-opus-4-5')).toBe('anthropic/claude-opus-4-5')
    expect(normalizeModelIdForLookup('qwen/qwen3-coder')).toBe('qwen/qwen3-coder')
  })

  it('returns null for local LM Studio models', () => {
    expect(normalizeModelIdForLookup('lmstudio:qwen3-8b')).toBeNull()
  })
})

describe('resolveStaticContextLength', () => {
  it('knows the Claude family sizes', () => {
    expect(resolveStaticContextLength('anthropic:claude-opus-4-5')).toBe(200_000)
    expect(resolveStaticContextLength('anthropic/claude-sonnet-4.5')).toBe(200_000)
    expect(resolveStaticContextLength('anthropic/claude-sonnet-4.5[1m]')).toBe(1_000_000)
    expect(resolveStaticContextLength('anthropic:claude-sonnet-4-5-1m')).toBe(1_000_000)
  })

  it('knows the GPT-5 family is 400k', () => {
    expect(resolveStaticContextLength('openai:gpt-5.2')).toBe(400_000)
    expect(resolveStaticContextLength('chatgpt:gpt-5.2-codex')).toBe(400_000)
    expect(resolveStaticContextLength('codex/gpt-5.2-codex')).toBe(400_000)
  })

  it('returns null for unknown models', () => {
    expect(resolveStaticContextLength('some/unknown-model')).toBeNull()
  })
})

describe('getModelContextLength', () => {
  it('resolves direct Anthropic ids without OpenRouter data', async () => {
    expect(await getModelContextLength('anthropic:claude-opus-4-5', NO_KEY)).toBe(200_000)
  })

  it('resolves codex models per family instead of a hardcoded 128k', async () => {
    expect(await getModelContextLength('codex/gpt-5.2-codex', NO_KEY)).toBe(400_000)
    expect(await getModelContextLength('chatgpt:gpt-5.2', NO_KEY)).toBe(400_000)
  })

  it('falls back to the default for unknown models', async () => {
    expect(await getModelContextLength('mystery/model-x', NO_KEY)).toBe(128_000)
  })

  describe('LM Studio models', () => {
    const previous = Bun.env.GAMBIT_LMSTUDIO_CONTEXT_LENGTH

    afterEach(() => {
      if (previous === undefined) {
        delete Bun.env.GAMBIT_LMSTUDIO_CONTEXT_LENGTH
      } else {
        Bun.env.GAMBIT_LMSTUDIO_CONTEXT_LENGTH = previous
      }
    })

    it('uses a conservative default', async () => {
      delete Bun.env.GAMBIT_LMSTUDIO_CONTEXT_LENGTH
      expect(await getModelContextLength('lmstudio:qwen3-8b', NO_KEY)).toBe(128_000)
    })

    it('honors the GAMBIT_LMSTUDIO_CONTEXT_LENGTH override', async () => {
      Bun.env.GAMBIT_LMSTUDIO_CONTEXT_LENGTH = '32768'
      expect(await getModelContextLength('lmstudio:qwen3-8b', NO_KEY)).toBe(32_768)
    })
  })
})

describe('getCompactionThreshold', () => {
  it('is 85% of the context length', () => {
    expect(getCompactionThreshold(200_000)).toBe(170_000)
  })
})
