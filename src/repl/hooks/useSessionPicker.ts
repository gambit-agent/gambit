import { useCallback, useMemo, useState } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import type { ConversationSessionSummary } from '../../session/conversation-sessions'
import type { SessionPickerOption } from '../../ui/overlays/SessionPickerOverlay'
import { describeSessionOption } from '../repl-format'

export interface SessionPickerState {
  isOpen: boolean
  filterValue: string
  selectedIndex: number
  sessions: ConversationSessionSummary[]
  fetchState: 'idle' | 'loading' | 'success' | 'error'
  fetchError: string | null
}

interface SessionPickerConversation {
  conversationId: string
  initialized: boolean
  status: 'idle' | 'running' | 'error'
}

export function useSessionPicker({
  runtime,
  conversation,
  initialInitializing,
}: {
  runtime: AppRuntime
  conversation: SessionPickerConversation
  initialInitializing: boolean
}) {
  const [sessionInitializing, setSessionInitializing] = useState(initialInitializing)
  const [state, setState] = useState<SessionPickerState>({
    isOpen: false,
    filterValue: '',
    selectedIndex: 0,
    sessions: [],
    fetchState: 'idle',
    fetchError: null,
  })

  const options = useMemo<SessionPickerOption[]>(() => {
    const filter = state.filterValue.trim().toLowerCase()
    const filteredSessions = state.sessions.filter((session) => {
      if (!filter) {
        return true
      }

      const haystack = [
        session.conversationId,
        session.title,
        session.preview ?? '',
      ]
        .join('\n')
        .toLowerCase()

      return haystack.includes(filter)
    })

    const sessionOptions: SessionPickerOption[] = filteredSessions.map((session) => ({
      key: session.conversationId,
      kind: 'session',
      title: session.title,
      description: describeSessionOption(session, session.conversationId === conversation.conversationId),
    }))

    const newOption: SessionPickerOption = {
      key: 'new',
      kind: 'new',
      title: 'Start new conversation',
      description: 'Create a fresh session with a new conversation ID.',
    }

    return sessionOptions.length === 0 ? [newOption] : [...sessionOptions, newOption]
  }, [conversation.conversationId, state.filterValue, state.sessions])

  const dismiss = useCallback(() => {
    setState((current) => ({
      ...current,
      isOpen: false,
      selectedIndex: 0,
      fetchError: null,
    }))
  }, [])

  const refresh = useCallback(
    async (filterValue: string = '') => {
      setState((current) => ({
        ...current,
        isOpen: true,
        filterValue,
        selectedIndex: 0,
        fetchState: 'loading',
        fetchError: null,
      }))

      try {
        const sessions = await runtime.listConversationSessions()
        setState((current) => ({
          ...current,
          isOpen: true,
          filterValue,
          selectedIndex: 0,
          sessions,
          fetchState: 'success',
          fetchError: null,
        }))
      } catch (error) {
        setState((current) => ({
          ...current,
          isOpen: true,
          filterValue,
          selectedIndex: 0,
          fetchState: 'error',
          fetchError: error instanceof Error ? error.message : String(error),
        }))
      }
    },
    [runtime],
  )

  const startFreshConversation = useCallback(async () => {
    if (conversation.status === 'running') {
      runtime.conversationStore.setError('Finish or cancel the current run before starting a new conversation.')
      return
    }

    setSessionInitializing(true)
    try {
      await runtime.resetConversation()
      dismiss()
    } catch (error) {
      runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSessionInitializing(false)
    }
  }, [conversation.status, dismiss, runtime])

  const open = useCallback(
    (initialFilter: string = '') => {
      if (conversation.status === 'running') {
        runtime.conversationStore.setError('Finish or cancel the current run before switching conversations.')
        return
      }

      void refresh(initialFilter)
    },
    [conversation.status, refresh, runtime],
  )

  const moveSelection = useCallback(
    (delta: number) => {
      setState((current) => {
        const maxIndex = Math.max(0, options.length - 1)
        const nextIndex = Math.min(maxIndex, Math.max(0, current.selectedIndex + delta))
        return {
          ...current,
          selectedIndex: nextIndex,
        }
      })
    },
    [options.length],
  )

  const setSelection = useCallback(
    (index: number) => {
      setState((current) => ({
        ...current,
        selectedIndex: Math.min(Math.max(index, 0), Math.max(0, options.length - 1)),
      }))
    },
    [options.length],
  )

  const selectByIndex = useCallback(
    async (index: number) => {
      const option = options[index]
      if (!option) {
        return
      }

      if (option.kind === 'new') {
        await startFreshConversation()
        return
      }

      setSessionInitializing(true)
      try {
        await runtime.resumeConversation(option.key)
        dismiss()
      } catch (error) {
        runtime.conversationStore.setError(error instanceof Error ? error.message : String(error))
      } finally {
        setSessionInitializing(false)
      }
    },
    [dismiss, runtime, options, startFreshConversation],
  )

  const handleFilterChange = useCallback((value: string) => {
    setState((current) => ({
      ...current,
      filterValue: value,
      selectedIndex: 0,
    }))
  }, [])

  const handleFilterSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim().toLowerCase()
      if (trimmed === 'cancel') {
        if (conversation.initialized) {
          dismiss()
        } else {
          void startFreshConversation()
        }
        return
      }

      if (trimmed === 'new') {
        void startFreshConversation()
        return
      }

      if (trimmed === 'retry' && state.fetchState === 'error') {
        void refresh(state.filterValue)
        return
      }

      void selectByIndex(state.selectedIndex)
    },
    [
      conversation.initialized,
      dismiss,
      refresh,
      selectByIndex,
      state.fetchState,
      state.filterValue,
      state.selectedIndex,
      startFreshConversation,
    ],
  )

  return {
    state,
    options,
    sessionInitializing,
    setSessionInitializing,
    dismiss,
    refresh,
    startFreshConversation,
    open,
    moveSelection,
    setSelection,
    selectByIndex,
    handleFilterChange,
    handleFilterSubmit,
  }
}
