import { useCallback, useEffect, useMemo, useState } from "react"

import { codexModelPresets, defaultModel, freeModelPresets } from "../config"
import {
  codexReasoningEfforts,
  modelRequiresApiKey,
  normalizeProviderSlug,
  openRouterReasoningEfforts,
  type ReasoningEffort,
} from "./model"
import {
  fetchCodexSubscriptionModels,
  fetchDirectProviderModels,
  getDefaultDirectProviderModels,
  type DirectProviderModel,
} from "./directProviderModels"
import { getProviderCredential, listConnectedDirectProviderIds } from "./provider-credentials"
import { buildDirectProviderModelId, isDirectProviderModelId, type DirectProviderId } from "./providers"
import {
  fetchOpenRouterModelProviders,
  fetchOpenRouterModels,
  isGpt5Model,
  type ModelListItem,
  type ModelProviderOption,
} from "./openrouterModels"

export type ModelPickerMode = "list" | "options"

export type ModelFetchState = "idle" | "loading" | "success" | "error"

export interface UseModelPickerOptions {
  apiKey: string | null
  currentModelId: string
  currentReasoning: ReasoningEffort | null
  currentProvider: string | null
  onSelect: (model: ModelListItem, effort: ReasoningEffort | null, providerSlug: string | null) => void
}

export interface ModelPickerState {
  isOpen: boolean
  mode: ModelPickerMode
  filterValue: string
  hint: string | null
  reasoningInput: string
  reasoningError: string | null
  fetchState: ModelFetchState
  fetchError: string | null
  providerFetchState: ModelFetchState
  providerFetchError: string | null
  filteredModels: ModelListItem[]
  allModels: ModelListItem[]
  providerOptions: ModelProviderOption[]
  selectedProviderIndex: number
  selectedIndex: number
  reasoningEffort: ReasoningEffort | null
  providerSlug: string | null
  pendingModel: ModelListItem | null
}

export interface UseModelPickerResult {
  state: ModelPickerState
  open: (initialFilter?: string) => void
  close: (nextReasoning?: ReasoningEffort | null) => void
  resetFetch: () => void
  handleFilterChange: (value: string) => void
  handleFilterSubmit: (value: string) => void
  handleReasoningInput: (value: string) => void
  handleReasoningSubmit: (value: string) => void
  moveReasoningEffort: (delta: number) => void
  moveProviderSelection: (delta: number) => void
  setProviderSelection: (index: number) => void
  applyOptionsSelection: (providerIndex?: number) => void
  moveSelection: (delta: number) => void
  setSelection: (index: number) => void
  selectHighlighted: () => void
  selectByIndex: (index: number) => void
  selectById: (id: string) => void
}

const DEFAULT_REASONING: ReasoningEffort = "medium"
const modelSearchTextCache = new WeakMap<ModelListItem, string>()

export function isFreeModel(model: ModelListItem): boolean {
  const prices = [model.promptPrice, model.completionPrice, model.requestPrice].filter((price): price is string => price !== null)
  if (prices.length === 0) {
    return /(^|[^a-z])free([^a-z]|$)|:free$/i.test(`${model.id} ${model.name}`)
  }
  return prices.every((price) => Number.parseFloat(price) === 0)
}

/**
 * Whether `model` should go through the OpenRouter-specific "options" screen
 * (reasoning effort + provider routing). Codex models and directly-connected
 * provider models (see `/connect`) select immediately instead.
 */
export function isOpenRouterRoutedModel(model: Pick<ModelListItem, "id">): boolean {
  return modelRequiresApiKey(model.id) && !isDirectProviderModelId(model.id)
}

function directProviderModelToListItem(providerId: DirectProviderId, model: DirectProviderModel): ModelListItem {
  return {
    id: buildDirectProviderModelId(providerId, model.id),
    name: model.name,
    description: model.description,
    provider: providerId,
    promptPrice: null,
    completionPrice: null,
    requestPrice: null,
    supportsReasoning: Boolean(model.reasoningEfforts?.length),
    reasoningEfforts: model.reasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
  }
}

function codexSubscriptionModelToListItem(model: DirectProviderModel): ModelListItem {
  return {
    ...directProviderModelToListItem('chatgpt', model),
    id: `codex/${model.id}`,
    provider: 'codex',
  }
}

/** Synchronous curated entries for every currently-connected direct provider. */
function buildConnectedProviderModels(): ModelListItem[] {
  return listConnectedDirectProviderIds().flatMap((providerId) =>
    getDefaultDirectProviderModels(providerId).map((model) => directProviderModelToListItem(providerId, model)),
  )
}

/** Merges connected-provider entries into `models`, without duplicating ids. */
function mergeConnectedProviderModels(models: readonly ModelListItem[]): ModelListItem[] {
  const existingIds = new Set(models.map((model) => model.id))
  const additions = buildConnectedProviderModels().filter((model) => !existingIds.has(model.id))
  return additions.length > 0 ? [...models, ...additions] : [...models]
}

/** Replaces any existing entries for `providerId` with a freshly-fetched list. */
function replaceProviderModels(models: readonly ModelListItem[], providerId: string, replacement: ModelListItem[]): ModelListItem[] {
  const kept = models.filter((model) => model.provider !== providerId)
  return [...kept, ...replacement]
}

export function buildModelSearchText(model: ModelListItem): string {
  const tags = [
    model.id,
    model.name,
    model.description,
    model.provider,
    model.promptPrice ? `prompt ${model.promptPrice}` : null,
    model.completionPrice ? `completion ${model.completionPrice}` : null,
    model.requestPrice ? `request ${model.requestPrice}` : null,
    model.supportsReasoning ? 'reasoning' : null,
    isGpt5Model(model) ? 'gpt-5 gpt5' : null,
    isFreeModel(model) ? 'free' : null,
  ]
  return tags.filter(Boolean).join(' ').toLowerCase()
}

function getCachedModelSearchText(model: ModelListItem): string {
  const cached = modelSearchTextCache.get(model)
  if (cached !== undefined) {
    return cached
  }
  const searchText = buildModelSearchText(model)
  modelSearchTextCache.set(model, searchText)
  return searchText
}

export function filterModels(models: readonly ModelListItem[], filterValue: string): ModelListItem[] {
  const terms = filterValue.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return [...models]
  }
  return models.filter((model) => {
    const searchText = getCachedModelSearchText(model)
    return terms.every((term) => searchText.includes(term))
  })
}

function buildFallbackModels(): ModelListItem[] {
  const candidates = new Set<string>(
    [defaultModel, ...freeModelPresets, ...codexModelPresets]
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )
  const presets = Array.from(candidates).map((id) => {
    const provider = id.includes("/") ? id.split("/")[0] ?? null : null
    return {
      id,
      name: id,
      description: null,
      provider,
      promptPrice: null,
      completionPrice: null,
      requestPrice: null,
      supportsReasoning: id.startsWith('codex/') || id.startsWith('openai-codex/'),
      reasoningEfforts: null,
      defaultReasoningEffort: null,
    }
  })
  return mergeConnectedProviderModels(presets)
}

function shouldConfigureModel(model: ModelListItem): boolean {
  return model.supportsReasoning || isOpenRouterRoutedModel(model)
}

export function getAllowedReasoningEfforts(model: ModelListItem): readonly ReasoningEffort[] {
  if (model.reasoningEfforts?.length) {
    return model.reasoningEfforts
  }
  return isOpenRouterRoutedModel(model) ? openRouterReasoningEfforts : codexReasoningEfforts
}

function getInitialReasoningEffort(
  model: ModelListItem,
  currentReasoning: ReasoningEffort | null,
): ReasoningEffort {
  const allowed = getAllowedReasoningEfforts(model)
  if (currentReasoning && allowed.includes(currentReasoning)) {
    return currentReasoning
  }
  if (model.defaultReasoningEffort && allowed.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }
  return allowed.includes(DEFAULT_REASONING) ? DEFAULT_REASONING : allowed[0] ?? DEFAULT_REASONING
}

function getProviderSlugAtIndex(providerOptions: readonly ModelProviderOption[], selectedIndex: number): string | null {
  if (selectedIndex <= 0) {
    return null
  }
  return providerOptions[selectedIndex - 1]?.slug ?? null
}

function getProviderIndex(providerOptions: readonly ModelProviderOption[], providerSlug: string | null): number {
  if (!providerSlug) {
    return 0
  }
  const normalized = normalizeProviderSlug(providerSlug)
  if (!normalized) {
    return 0
  }
  const index = providerOptions.findIndex((provider) => provider.slug === normalized)
  return index >= 0 ? index + 1 : 0
}

function clampProviderIndex(index: number, providerOptions: readonly ModelProviderOption[]): number {
  return Math.max(0, Math.min(index, providerOptions.length))
}

export function useModelPicker({
  apiKey,
  currentModelId,
  currentReasoning,
  currentProvider,
  onSelect,
}: UseModelPickerOptions): UseModelPickerResult {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<ModelPickerMode>("list")
  const [filterValue, setFilterValue] = useState("")
  const [hint, setHint] = useState<string | null>(null)
  const [reasoningInput, setReasoningInput] = useState<string>(currentReasoning ?? DEFAULT_REASONING)
  const [reasoningError, setReasoningError] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<ModelListItem[]>([])
  const [fetchState, setFetchState] = useState<ModelFetchState>("idle")
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchKey, setFetchKey] = useState<string | null>(null)
  const [providerOptions, setProviderOptions] = useState<ModelProviderOption[]>([])
  const [providerFetchState, setProviderFetchState] = useState<ModelFetchState>("idle")
  const [providerFetchError, setProviderFetchError] = useState<string | null>(null)
  const [providerFetchNonce, setProviderFetchNonce] = useState(0)
  const [pendingModel, setPendingModel] = useState<ModelListItem | null>(null)
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const sanitizedKey = apiKey?.trim() ?? ""
    const normalizedKey = sanitizedKey.length > 0 ? sanitizedKey : null
    const targetKey = normalizedKey ?? "__public__"
    const fallback = buildFallbackModels()

    if (fallback.length > 0 && availableModels.length === 0) {
      setAvailableModels(fallback)
    }

    if (!normalizedKey) {
      setFetchState("idle")
      setFetchError(null)
      setFetchKey(targetKey)
      if (fallback.length > 0) {
        setAvailableModels(fallback)
      }
      setHint("Connect OpenRouter with /connect openrouter to load the full OpenRouter catalog.")
      return
    }

    if (fetchKey === targetKey) {
      return
    }

    let cancelled = false
    setFetchState("loading")
    setFetchError(null)

    ;(async () => {
      try {
        const models = await fetchOpenRouterModels(normalizedKey ?? undefined)
        if (cancelled) {
          return
        }
        setAvailableModels(mergeConnectedProviderModels(models))
        setFetchState("success")
        setFetchKey(targetKey)
        setHint(null)
      } catch (error) {
        if (cancelled) {
          return
        }
        const message = error instanceof Error ? error.message : `Failed to load models: ${String(error)}`
        if (fallback.length > 0) {
          setAvailableModels(fallback)
          setFetchState("success")
          setFetchError(null)
          setFetchKey(targetKey)
          setHint(`${message}. Showing preset models instead.`)
        } else {
          setFetchState("error")
          setFetchError(message)
          setFetchKey(targetKey)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [apiKey, fetchKey, isOpen])

  useEffect(() => {
    if (pendingModel?.supportsReasoning) {
      setReasoningInput(getInitialReasoningEffort(pendingModel, currentReasoning))
      return
    }
    setReasoningInput(currentReasoning ?? DEFAULT_REASONING)
  }, [currentReasoning, isOpen, pendingModel])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    let cancelled = false
    for (const providerId of listConnectedDirectProviderIds()) {
      const credential = getProviderCredential(providerId)
      if (!credential) {
        continue
      }
      void fetchDirectProviderModels(providerId, credential).then((models) => {
        if (cancelled) {
          return
        }
        const items = models.map((model) => directProviderModelToListItem(providerId, model))
        setAvailableModels((current) => replaceProviderModels(current, providerId, items))
      })
    }

    void fetchCodexSubscriptionModels().then((models) => {
      if (cancelled) {
        return
      }
      setAvailableModels((current) => replaceProviderModels(
        current,
        'codex',
        models.map(codexSubscriptionModelToListItem),
      ))
    }).catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || mode !== "options" || !pendingModel || !isOpenRouterRoutedModel(pendingModel)) {
      setProviderOptions([])
      setProviderFetchState("idle")
      setProviderFetchError(null)
      return
    }

    const sanitizedKey = apiKey?.trim() ?? ""
    if (!sanitizedKey) {
      setProviderOptions([])
      setProviderFetchState("idle")
      setProviderFetchError(null)
      return
    }

    let cancelled = false
    setProviderFetchState("loading")
    setProviderFetchError(null)
    setProviderOptions([])

    ;(async () => {
      try {
        const providers = await fetchOpenRouterModelProviders(pendingModel.id, sanitizedKey)
        if (cancelled) {
          return
        }
        setProviderOptions(providers)
        setSelectedProviderIndex(
          pendingModel.id === currentModelId ? getProviderIndex(providers, currentProvider) : 0,
        )
        setProviderFetchState("success")
      } catch (error) {
        if (cancelled) {
          return
        }
        setProviderOptions([])
        setProviderFetchState("error")
        setProviderFetchError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [apiKey, currentModelId, currentProvider, isOpen, mode, pendingModel, providerFetchNonce])

  const filteredModels = useMemo(() => filterModels(availableModels, filterValue), [availableModels, filterValue])

  useEffect(() => {
    setSelectedIndex((previous) => {
      if (filteredModels.length === 0) {
        return 0
      }
      if (previous >= filteredModels.length) {
        return filteredModels.length - 1
      }
      return previous
    })
  }, [filteredModels])

  useEffect(() => {
    setSelectedProviderIndex((previous) => clampProviderIndex(previous, providerOptions))
  }, [providerOptions])

  const close = useCallback(
    (nextReasoning: ReasoningEffort | null = currentReasoning ?? null) => {
      setIsOpen(false)
      setMode("list")
      setFilterValue("")
      setHint(null)
      setReasoningError(null)
      setPendingModel(null)
      setProviderOptions([])
      setProviderFetchState("idle")
      setProviderFetchError(null)
      setSelectedProviderIndex(0)
      setSelectedIndex(0)
      setReasoningInput(nextReasoning ?? DEFAULT_REASONING)
    },
    [currentReasoning],
  )

  const open = useCallback(
    (initialFilter: string = "") => {
      setIsOpen(true)
      setMode("list")
      setFilterValue(initialFilter)
      setHint(null)
      setReasoningError(null)
      setPendingModel(null)
      setProviderOptions([])
      setProviderFetchState("idle")
      setProviderFetchError(null)
      setSelectedProviderIndex(0)
      setSelectedIndex(0)
      setReasoningInput(currentReasoning ?? DEFAULT_REASONING)
      if (availableModels.length === 0) {
        const fallback = buildFallbackModels()
        if (fallback.length > 0) {
          setAvailableModels(fallback)
        }
      }
    },
    [availableModels.length, currentReasoning],
  )

  const resetFetch = useCallback(() => {
    setFetchState("idle")
    setFetchError(null)
    setFetchKey(null)
  }, [])

  const applySelection = useCallback(
    (model: ModelListItem, effort: ReasoningEffort | null, providerSlug: string | null) => {
      onSelect(model, effort, providerSlug)
      close(effort)
    },
    [close, onSelect],
  )

  const moveSelection = useCallback(
    (delta: number) => {
      if (!isOpen || mode !== "list") {
        return
      }

      setHint(null)
      setSelectedIndex((previous) => {
        if (filteredModels.length === 0) {
          return 0
        }
        const next = previous + delta
        if (next < 0) {
          return 0
        }
        if (next >= filteredModels.length) {
          return filteredModels.length - 1
        }
        return next
      })
    },
    [filteredModels, isOpen, mode],
  )

  const setSelection = useCallback(
    (index: number) => {
      if (!isOpen || mode !== "list") {
        return
      }
      if (index < 0 || index >= filteredModels.length) {
        return
      }
      setSelectedIndex(index)
    },
    [filteredModels, isOpen, mode],
  )

  const handleFilterChange = useCallback((value: string) => {
    setFilterValue(value)
    setSelectedIndex(0)
    setHint(null)
  }, [])

  const selectModel = useCallback(
    (model: ModelListItem) => {
      if (shouldConfigureModel(model)) {
        setPendingModel(model)
        setMode("options")
        setReasoningError(null)
        setReasoningInput(getInitialReasoningEffort(model, currentReasoning))
        setSelectedProviderIndex(0)
        return
      }
      applySelection(model, null, null)
    },
    [applySelection, currentReasoning],
  )

  const selectHighlighted = useCallback(() => {
    const highlighted = filteredModels[selectedIndex]
    if (!highlighted) {
      setHint("No models available to select.")
      return
    }
    selectModel(highlighted)
  }, [filteredModels, selectedIndex, selectModel])

  const handleFilterSubmit = useCallback(
    (rawValue: string) => {
      const trimmed = rawValue.trim()
      const normalized = trimmed.toLowerCase()

      if (normalized === "cancel") {
        close()
        return
      }

      if (normalized === "retry" || normalized === "refresh") {
        resetFetch()
        return
      }

      if (fetchState !== "success" && filteredModels.length === 0) {
        setHint("Models are still loading. Please wait or type \"cancel\" to exit.")
        return
      }

      if (!trimmed) {
        selectHighlighted()
        return
      }

      const directMatch = availableModels.find(
        (model) => model.id.toLowerCase() === normalized || model.name.toLowerCase() === normalized,
      )
      if (directMatch) {
        selectModel(directMatch)
        return
      }

      const matching = filterModels(availableModels, trimmed)
      if (matching.length === 0) {
        setHint("No models matched your query.")
        return
      }

      selectModel(matching[Math.min(selectedIndex, matching.length - 1)] ?? matching[0]!)
    },
    [availableModels, close, fetchState, resetFetch, selectHighlighted, selectModel, selectedIndex],
  )

  const moveReasoningEffort = useCallback(
    (delta: number) => {
      if (!pendingModel?.supportsReasoning) {
        return
      }
      const efforts = getAllowedReasoningEfforts(pendingModel)
      const currentIndex = Math.max(0, efforts.indexOf(reasoningInput as ReasoningEffort))
      const nextIndex = Math.max(0, Math.min(currentIndex + delta, efforts.length - 1))
      setReasoningInput(efforts[nextIndex] ?? DEFAULT_REASONING)
      setReasoningError(null)
    },
    [pendingModel, reasoningInput],
  )

  const moveProviderSelection = useCallback(
    (delta: number) => {
      if (!pendingModel || !isOpenRouterRoutedModel(pendingModel)) {
        return
      }
      setSelectedProviderIndex((previous) => clampProviderIndex(previous + delta, providerOptions))
      setReasoningError(null)
    },
    [pendingModel, providerOptions],
  )

  const setProviderSelection = useCallback(
    (index: number) => {
      if (!pendingModel || !isOpenRouterRoutedModel(pendingModel)) {
        return
      }
      setSelectedProviderIndex(clampProviderIndex(index, providerOptions))
      setReasoningError(null)
    },
    [pendingModel, providerOptions],
  )

  const applyOptionsSelection = useCallback((providerIndex: number = selectedProviderIndex) => {
    if (!pendingModel) {
      setReasoningError("No model pending selection. Choose a model again.")
      return
    }

    const effort = pendingModel.supportsReasoning ? reasoningInput as ReasoningEffort : null
    const providerSlug = isOpenRouterRoutedModel(pendingModel)
      ? getProviderSlugAtIndex(providerOptions, clampProviderIndex(providerIndex, providerOptions))
      : null
    setReasoningError(null)
    applySelection(pendingModel, effort, providerSlug)
  }, [applySelection, pendingModel, providerOptions, reasoningInput, selectedProviderIndex])

  const handleReasoningInput = useCallback((value: string) => {
    if (pendingModel?.supportsReasoning && getAllowedReasoningEfforts(pendingModel).includes(value as ReasoningEffort)) {
      setReasoningInput(value)
    }
  }, [pendingModel])

  const handleReasoningSubmit = useCallback(() => {
    applyOptionsSelection()
  }, [applyOptionsSelection])

  const selectByIndex = useCallback(
    (index: number) => {
      const model = filteredModels[index]
      if (!model) {
        return
      }
      selectModel(model)
    },
    [filteredModels, selectModel],
  )

  const selectById = useCallback(
    (id: string) => {
      const model = availableModels.find((candidate) => candidate.id === id)
      if (!model) {
        setHint("No models matched your selection.")
        return
      }
      selectModel(model)
    },
    [availableModels, selectModel],
  )

  return {
    state: {
      isOpen,
      mode,
      filterValue,
      hint,
      reasoningInput,
      reasoningError,
      fetchState,
      fetchError,
      providerFetchState,
      providerFetchError,
      filteredModels,
      allModels: availableModels,
      providerOptions,
      selectedProviderIndex,
      selectedIndex,
      reasoningEffort: currentReasoning,
      providerSlug: currentProvider,
      pendingModel,
    },
    open,
    close,
    resetFetch,
    handleFilterChange,
    handleFilterSubmit,
    handleReasoningInput,
    handleReasoningSubmit,
    moveReasoningEffort,
    moveProviderSelection,
    setProviderSelection,
    applyOptionsSelection,
    moveSelection,
    setSelection,
    selectHighlighted,
    selectByIndex,
    selectById,
  }
}
