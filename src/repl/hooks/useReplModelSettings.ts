import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const [contextLength, setContextLength] = useState<number | null>(null)
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

  // The model's context length only depends on the selection, so it is looked
  // up when that changes rather than on every message update: streaming
  // rewrites the message list several times a second, and resolving a promise
  // plus committing a new usage object on each flush was an extra render pass
  // per flush for the whole screen.
  useEffect(() => {
    let cancelled = false
    const selectedModelId = modelId?.trim()
    const trimmedKey = apiKey.trim()

    if (!selectedModelId || !trimmedKey) {
      setContextLength(DEFAULT_MODEL_CONTEXT_LENGTH)
      return
    }

    void getModelContextLength(selectedModelId, trimmedKey).then((resolvedLength) => {
      if (!cancelled) {
        setContextLength(resolvedLength)
      }
    })

    return () => {
      cancelled = true
    }
  }, [modelId, apiKey])

  const usedContextTokens = useMemo(() => estimateContextTokens(messages), [messages])
  const contextUsage = useMemo(
    () => (contextLength === null ? null : { used: usedContextTokens, max: contextLength }),
    [contextLength, usedContextTokens],
  )

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
