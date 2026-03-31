import { useCallback, useEffect, useMemo, useState } from "react"

import { defaultModel, freeModelPresets } from "../config"
import type { ReasoningEffort } from "./model"
import { fetchOpenRouterModels, isGpt5Model, type ModelListItem } from "./openrouterModels"

export type ModelPickerMode = "list" | "reasoning"

export type ModelFetchState = "idle" | "loading" | "success" | "error"

export interface UseModelPickerOptions {
  apiKey: string | null
  currentModelId: string
  currentReasoning: ReasoningEffort | null
  onSelect: (model: ModelListItem, effort: ReasoningEffort | null) => void
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
  filteredModels: ModelListItem[]
  allModels: ModelListItem[]
  selectedIndex: number
  reasoningEffort: ReasoningEffort | null
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
  moveSelection: (delta: number) => void
  setSelection: (index: number) => void
  selectHighlighted: () => void
  selectByIndex: (index: number) => void
}

const DEFAULT_REASONING: ReasoningEffort = "medium"

function buildFallbackModels(): ModelListItem[] {
  const candidates = new Set<string>([defaultModel, ...freeModelPresets])
  return Array.from(candidates).map((id) => {
    const provider = id.includes("/") ? id.split("/")[0] ?? null : null
    return {
      id,
      name: id,
      description: null,
      provider,
      promptPrice: null,
      completionPrice: null,
      requestPrice: null,
      supportsReasoning: false,
    }
  })
}

export function useModelPicker({
  apiKey,
  currentModelId,
  currentReasoning,
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
  const [pendingModel, setPendingModel] = useState<ModelListItem | null>(null)
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
      setHint("Set an OpenRouter API key with :key <token> to load the full OpenRouter catalog.")
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
        setAvailableModels(models)
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
    setReasoningInput(currentReasoning ?? DEFAULT_REASONING)
  }, [currentReasoning, isOpen])

  const filteredModels = useMemo(() => {
    const trimmed = filterValue.trim().toLowerCase()
    if (!trimmed) {
      return availableModels
    }
    return availableModels.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(trimmed))
  }, [availableModels, filterValue])

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

  const close = useCallback(
    (nextReasoning: ReasoningEffort | null = currentReasoning ?? null) => {
      setIsOpen(false)
      setMode("list")
      setFilterValue("")
      setHint(null)
      setReasoningError(null)
      setPendingModel(null)
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
    (model: ModelListItem, effort: ReasoningEffort | null) => {
      onSelect(model, effort)
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
    setHint(null)
  }, [])

  const selectModel = useCallback(
    (model: ModelListItem) => {
      if (isGpt5Model(model)) {
        setPendingModel(model)
        setMode("reasoning")
        setReasoningError(null)
        setReasoningInput(currentReasoning ?? DEFAULT_REASONING)
        return
      }
      applySelection(model, null)
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
      const matching = directMatch
        ? directMatch
        : availableModels.find((model) => `${model.id} ${model.name}`.toLowerCase().includes(normalized))

      if (!matching) {
        setHint("No models matched your query.")
        return
      }

      selectModel(matching)
    },
    [availableModels, close, fetchState, resetFetch, selectHighlighted, selectModel],
  )

  const handleReasoningInput = useCallback((value: string) => {
    setReasoningInput(value.toLowerCase())
  }, [])

  const handleReasoningSubmit = useCallback(
    (rawValue: string) => {
      const trimmed = rawValue.trim().toLowerCase()

      if (trimmed === "cancel") {
        close()
        return
      }

      if (trimmed === "back") {
        setMode("list")
        setPendingModel(null)
        setReasoningError(null)
        setReasoningInput(currentReasoning ?? DEFAULT_REASONING)
        return
      }

      if (!pendingModel) {
        setReasoningError("No model pending selection. Type \"back\" to choose again.")
        return
      }

      if (trimmed !== "low" && trimmed !== "medium" && trimmed !== "high") {
        setReasoningError("Enter low, medium, or high.")
        return
      }

      setReasoningError(null)
      applySelection(pendingModel, trimmed as ReasoningEffort)
    },
    [applySelection, close, currentReasoning, pendingModel],
  )

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
      filteredModels,
      allModels: availableModels,
      selectedIndex,
      reasoningEffort: currentReasoning,
      pendingModel,
    },
    open,
    close,
    resetFetch,
    handleFilterChange,
    handleFilterSubmit,
    handleReasoningInput,
    handleReasoningSubmit,
    moveSelection,
    setSelection,
    selectHighlighted,
    selectByIndex,
  }
}
