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
  inputValueRef: MutableRefObject<string>
  suppressNextInputRef: MutableRefObject<boolean>
  setInputValueWithRef: (next: SetStateAction<string>) => void
  clearPreviewLabel: () => void
}

export function useInteractiveHistorySearch({
  historyRef,
  inputValueRef,
  suppressNextInputRef,
  setInputValueWithRef,
  clearPreviewLabel,
}: UseInteractiveHistorySearchOptions) {
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historySearch, setHistorySearch] = useState<HistorySearchState>({ active: false, query: '', match: null })
  const lastSearchIndex = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    InteractiveHistory.load().then((history) => {
      if (!cancelled) {
        historyRef.current = history
        setHistoryLoaded(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ensureHistoryLoaded = useCallback(async () => {
    if (!historyLoaded || !historyRef.current) {
      const history = await InteractiveHistory.load()
      historyRef.current = history
      setHistoryLoaded(true)
    }
  }, [historyLoaded])

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

  const handleHistoryNavigation = useCallback(
    (direction: 'previous' | 'next') => {
      const history = historyRef.current
      if (!history) {
        return
      }

      if (direction === 'previous') {
        const nextValue = history.previous(inputValueRef.current)
        if (nextValue !== null) {
          clearPreviewLabel()
          suppressNextInputRef.current = true
          setInputValueWithRef(nextValue)
        }
        return
      }

      const nextValue = history.next()
      if (nextValue !== null) {
        clearPreviewLabel()
        suppressNextInputRef.current = true
        setInputValueWithRef(nextValue)
      }
    },
    [clearPreviewLabel, inputValueRef, setInputValueWithRef, suppressNextInputRef],
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
        clearPreviewLabel()
        suppressNextInputRef.current = true
        setInputValueWithRef(match.value)
      }
    },
    [clearPreviewLabel, setInputValueWithRef, suppressNextInputRef],
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
