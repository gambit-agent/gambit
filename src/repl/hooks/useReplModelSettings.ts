import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import { DEFAULT_MODEL_CONTEXT_LENGTH, defaultModel } from '../../config'
import { estimateContextTokens } from '../../conversation/compaction'
import { generateId } from '../../lib/id'
import type { ReasoningEffort } from '../../lib/model'
import { getModelContextLength } from '../../lib/model-info'
import { useModelPicker } from '../../lib/modelPicker'
import { getProviderCredential } from '../../lib/provider-credentials'
import { readModelSelection, writeModelSelection } from '../../session/model-selection'
import type { ConversationMessage } from '../../conversation/conversation-types'

interface UseReplModelSettingsOptions {
  runtime: AppRuntime
  messages: ConversationMessage[]
}

export function useReplModelSettings({ runtime, messages }: UseReplModelSettingsOptions) {
  const [modelId, setModelId] = useState<string | null>(defaultModel)
  const [apiKey, setApiKey] = useState<string>(() => getProviderCredential('openrouter')?.apiKey ?? '')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [providerSlug, setProviderSlug] = useState<string | null>(null)
  const [contextUsage, setContextUsage] = useState<{ used: number; max: number } | null>(null)
  const modelSelectionDirtyRef = useRef(false)

  const persistModelSelection = useCallback(
    (nextModelId: string, nextReasoningEffort: ReasoningEffort | null) => {
      modelSelectionDirtyRef.current = true
      setModelId(nextModelId)
      setReasoningEffort(nextReasoningEffort)
      setProviderSlug(null)

      void writeModelSelection({
        modelId: nextModelId,
        reasoningEffort: nextReasoningEffort,
        providerSlug: null,
      }).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })
    },
    [runtime.conversationStore],
  )

  const refreshOpenRouterCredential = useCallback(() => {
    setApiKey(getProviderCredential('openrouter')?.apiKey ?? '')
  }, [])

  const modelPicker = useModelPicker({
    apiKey: apiKey.trim().length > 0 ? apiKey.trim() : null,
    currentModelId: modelId ?? '',
    currentReasoning: reasoningEffort,
    currentProvider: providerSlug,
    onSelect: (model, effort, provider) => {
      modelSelectionDirtyRef.current = true
      setModelId(model.id)
      setReasoningEffort(effort)
      setProviderSlug(provider)

      void writeModelSelection({
        modelId: model.id,
        reasoningEffort: effort,
        providerSlug: provider,
      }).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })

      const details = [
        effort ? `${effort} reasoning effort` : null,
        provider ? `provider ${provider}` : null,
      ].filter(Boolean)
      void runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'system',
        content: `Model set to ${model.id}${details.length ? ` with ${details.join(' and ')}` : ''}.`,
        timestamp: new Date().toISOString(),
      })
    },
  })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const persistedSelection = await readModelSelection()
        if (!persistedSelection || cancelled || modelSelectionDirtyRef.current) {
          return
        }

        setModelId(persistedSelection.modelId)
        setReasoningEffort(persistedSelection.reasoningEffort)
        setProviderSlug(persistedSelection.providerSlug)
      } catch (error) {
        if (!cancelled) {
          runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [runtime.conversationStore])

  useEffect(() => {
    let cancelled = false
    const used = estimateContextTokens(messages)
    const selectedModelId = modelId?.trim()
    const trimmedKey = apiKey.trim()

    if (!selectedModelId || !trimmedKey) {
      setContextUsage({ used, max: DEFAULT_MODEL_CONTEXT_LENGTH })
      return
    }

    void getModelContextLength(selectedModelId, trimmedKey).then((contextLength) => {
      if (!cancelled) {
        setContextUsage({ used, max: contextLength })
      }
    })

    return () => {
      cancelled = true
    }
  }, [messages, modelId, apiKey])

  return {
    modelId,
    apiKey,
    reasoningEffort,
    providerSlug,
    contextUsage,
    persistModelSelection,
    refreshOpenRouterCredential,
    modelPicker,
  }
}
