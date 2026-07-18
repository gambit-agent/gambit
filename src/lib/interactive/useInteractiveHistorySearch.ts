import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

import { InteractiveHistory } from './history'

interface HistorySearchState {
  active: boolean
  query: string
  match: string | null
}

interface UseInteractiveHistorySearchOptions {
  historyRef: MutableRefObject<InteractiveHistory | null>
  suppressNextInputRef: MutableRefObject<boolean>
  setInputValueWithRef: (next: SetStateAction<string>) => void
  clearPreviewLabel: () => void
  /** Returns the composer's current value; used to stash/restore drafts. */
  getCurrentInputValue?: () => string
}

export function useInteractiveHistorySearch({
  historyRef,
  suppressNextInputRef,
  setInputValueWithRef,
  clearPreviewLabel,
  getCurrentInputValue,
}: UseInteractiveHistorySearchOptions) {
  const [historySearch, setHistorySearch] = useState<HistorySearchState>({ active: false, query: '', match: null })
  const lastSearchIndex = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<InteractiveHistory> | null>(null)
  const stashedDraftRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadPromise = InteractiveHistory.load()
    loadPromiseRef.current = loadPromise

    loadPromise.then((history) => {
      if (!cancelled) {
        historyRef.current = history
      }
    }).finally(() => {
      if (loadPromiseRef.current === loadPromise) {
        loadPromiseRef.current = null
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const ensureHistoryLoaded = useCallback(async (): Promise<InteractiveHistory> => {
    if (historyRef.current) {
      return historyRef.current
    }

    const loadPromise = loadPromiseRef.current ?? InteractiveHistory.load()
    loadPromiseRef.current = loadPromise

    const history = await loadPromise
    historyRef.current = history

    if (loadPromiseRef.current === loadPromise) {
      loadPromiseRef.current = null
    }

    return history
  }, [])

  const persistHistory = useCallback(async () => {
    try {
      await historyRef.current?.persist()
    } catch (error) {
      console.warn('Failed to persist history', error)
    }
  }, [])

  const exitHistorySearch = useCallback(() => {
    setHistorySearch({ active: false, query: '', match: null })
    lastSearchIndex.current = null
  }, [])

  const applyRecalledValue = useCallback(
    (value: string): boolean => {
      const current = getCurrentInputValue?.()
      if (current !== undefined && current === value) {
        // Navigation was a no-op; do not leave a dangling suppress flag.
        return true
      }
      clearPreviewLabel()
      suppressNextInputRef.current = true
      setInputValueWithRef(value)
      return true
    },
    [clearPreviewLabel, getCurrentInputValue, setInputValueWithRef, suppressNextInputRef],
  )

  /**
   * Navigates history in the given direction. Returns true when the key was
   * handled (the composer content was replaced, or the navigation pinned on
   * an existing entry) so the caller can consume the key event.
   */
  const handleHistoryNavigation = useCallback(
    (direction: 'previous' | 'next'): boolean => {
      const history = historyRef.current
      if (!history) {
        return false
      }

      if (direction === 'previous') {
        // Stash the in-progress draft before the first step back so
        // down-arrow past the newest entry restores it.
        if (!history.isNavigating) {
          stashedDraftRef.current = getCurrentInputValue?.() ?? null
        }
        const nextValue = history.previous()
        if (nextValue === null) {
          return false
        }
        return applyRecalledValue(nextValue)
      }

      const nextValue = history.next()
      if (nextValue === null) {
        return false
      }
      if (nextValue === '' && !history.isNavigating) {
        // Walked past the newest entry: restore the stashed draft.
        const draft = stashedDraftRef.current ?? ''
        stashedDraftRef.current = null
        return applyRecalledValue(draft)
      }
      return applyRecalledValue(nextValue)
    },
    [applyRecalledValue, getCurrentInputValue],
  )

  const updateHistorySearch = useCallback(
    (query: string, advanced: boolean = false) => {
      const history = historyRef.current
      if (!history) {
        setHistorySearch({ active: true, query, match: null })
        return
      }

      const startIndex = advanced
        ? Math.max((lastSearchIndex.current ?? history.size) - 1, 0)
        : history.size - 1

      const match = history.findLatestMatch(query, startIndex)
      lastSearchIndex.current = match ? match.index : null
      setHistorySearch({ active: true, query, match: match?.value ?? null })

      if (match?.value) {
        applyRecalledValue(match.value)
      }
    },
    [applyRecalledValue],
  )

  return {
    historyRef,
    historySearch,
    ensureHistoryLoaded,
    persistHistory,
    exitHistorySearch,
    handleHistoryNavigation,
    updateHistorySearch,
  }
}

export type { HistorySearchState }
