import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import { DEFAULT_MODEL_CONTEXT_LENGTH, defaultModel } from '../../config'
import { estimateContextTokens } from '../../conversation/compaction'
import { generateId } from '../../lib/id'
import type { ReasoningEffort } from '../../lib/model'
import { getModelContextLength } from '../../lib/model-info'
import { useModelPicker } from '../../lib/modelPicker'
import { readModelSelection, writeModelSelection } from '../../session/model-selection'
import { readOpenRouterApiKey, writeOpenRouterApiKey } from '../../session/user-config'
import type { ConversationMessage } from '../../conversation/conversation-types'

interface UseReplModelSettingsOptions {
  runtime: AppRuntime
  messages: ConversationMessage[]
}

export function useReplModelSettings({ runtime, messages }: UseReplModelSettingsOptions) {
  const [modelId, setModelId] = useState<string | null>(defaultModel)
  const [apiKey, setApiKey] = useState<string>(Bun.env.OPENROUTER_API_KEY ?? '')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [contextUsage, setContextUsage] = useState<{ used: number; max: number } | null>(null)
  const modelSelectionDirtyRef = useRef(false)
  const apiKeyDirtyRef = useRef(false)

  const persistModelSelection = useCallback(
    (nextModelId: string, nextReasoningEffort: ReasoningEffort | null) => {
      modelSelectionDirtyRef.current = true
      setModelId(nextModelId)
      setReasoningEffort(nextReasoningEffort)

      void writeModelSelection({
        modelId: nextModelId,
        reasoningEffort: nextReasoningEffort,
      }).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })
    },
    [runtime.conversationStore],
  )

  const persistApiKey = useCallback(
    (nextApiKey: string) => {
      const trimmedKey = nextApiKey.trim()
      apiKeyDirtyRef.current = true
      setApiKey(trimmedKey)

      void writeOpenRouterApiKey(trimmedKey).catch((error) => {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      })
    },
    [runtime.conversationStore],
  )

  const modelPicker = useModelPicker({
    apiKey: apiKey.trim().length > 0 ? apiKey.trim() : null,
    currentModelId: modelId ?? '',
    currentReasoning: reasoningEffort,
    onSelect: (model, effort) => {
      persistModelSelection(model.id, effort)
      void runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'system',
        content: `Model set to ${model.id}${effort ? ` with ${effort} reasoning effort` : ''}.`,
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
    if (Bun.env.OPENROUTER_API_KEY?.trim()) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const persistedApiKey = await readOpenRouterApiKey()
        if (!persistedApiKey || cancelled || apiKeyDirtyRef.current) {
          return
        }

        setApiKey(persistedApiKey)
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
    contextUsage,
    persistModelSelection,
    persistApiKey,
    modelPicker,
  }
}
