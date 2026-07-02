import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AppRuntime } from '../../app/bootstrap'
import { createChatGptDeviceAuthorization, pollChatGptDeviceAuthorization } from '../../lib/chatgpt-oauth'
import { testProviderConnection } from '../../lib/directProviderModels'
import {
  clearProviderCredential,
  getProviderCredential,
  isProviderConnected,
  setProviderCredential,
  type ProviderCredential,
} from '../../lib/provider-credentials'
import {
  findProviderDefinition,
  providers,
  type ProviderDefinition,
  type ProviderId,
} from '../../lib/providers'
import { generateId } from '../../lib/id'
import { removeProviderCredential, writeProviderCredential } from '../../session/user-config'

export type ConnectProviderStep = 'list' | 'input' | 'oauth' | 'disconnect-confirm'

export interface ConnectProviderRow {
  id: ProviderId
  name: string
  description: string
  docsUrl: string
  authMethod: ProviderDefinition['authMethod']
  connected: boolean
}

export type ConnectProviderStatus = 'idle' | 'testing' | 'authorizing' | 'error'

export interface ConnectProviderState {
  isOpen: boolean
  step: ConnectProviderStep
  rows: ConnectProviderRow[]
  selectedIndex: number
  activeRow: ConnectProviderRow | null
  inputValue: string
  status: ConnectProviderStatus
  statusMessage: string | null
  canForceSave: boolean
  oauthUrl: string | null
  oauthCode: string | null
}

function buildRows(): ConnectProviderRow[] {
  return providers.map((definition) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    docsUrl: definition.docsUrl,
    authMethod: definition.authMethod,
    connected: isProviderConnected(definition.id),
  }))
}

function defaultInputValueFor(definition: ProviderDefinition): string {
  if (definition.authMethod === 'local') {
    return getProviderCredential(definition.id)?.baseURL ?? definition.defaultBaseURL ?? ''
  }
  return getProviderCredential(definition.id)?.apiKey ?? ''
}

export function useConnectProvider({
  runtime,
  onProviderCredentialChange,
}: {
  runtime: AppRuntime
  onProviderCredentialChange?: (providerId: ProviderId) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<ConnectProviderStep>('list')
  const [rows, setRows] = useState<ConnectProviderRow[]>(() => buildRows())
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [inputValue, setInputValue] = useState('')
  const [status, setStatus] = useState<ConnectProviderStatus>('idle')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [lastAttemptedValue, setLastAttemptedValue] = useState<string | null>(null)
  const [oauthUrl, setOauthUrl] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState<string | null>(null)
  const oauthAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    oauthAbortRef.current?.abort()
  }, [])

  const refreshRows = useCallback(() => {
    setRows(buildRows())
  }, [])

  const abortOAuth = useCallback(() => {
    oauthAbortRef.current?.abort()
    oauthAbortRef.current = null
  }, [])

  const close = useCallback(() => {
    abortOAuth()
    setIsOpen(false)
    setStep('list')
    setSelectedIndex(0)
    setInputValue('')
    setStatus('idle')
    setStatusMessage(null)
    setLastAttemptedValue(null)
    setOauthUrl(null)
    setOauthCode(null)
  }, [abortOAuth])

  const openProviderInput = useCallback((definition: ProviderDefinition) => {
    setStep('input')
    setInputValue(defaultInputValueFor(definition))
    setStatus('idle')
    setStatusMessage(null)
    setLastAttemptedValue(null)
    setOauthUrl(null)
    setOauthCode(null)
  }, [])

  const persistCredential = useCallback(
    async (definition: ProviderDefinition, credential: ProviderCredential) => {
      await writeProviderCredential(definition.id, credential)
      setProviderCredential(definition.id, credential)
      refreshRows()
      onProviderCredentialChange?.(definition.id)
      await runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'system',
        content: `Connected to ${definition.name}.`,
        timestamp: new Date().toISOString(),
      })
      close()
    },
    [close, onProviderCredentialChange, refreshRows, runtime.conversationStore],
  )

  const startOAuth = useCallback(
    (definition: ProviderDefinition) => {
      if (definition.id !== 'chatgpt') {
        setStatus('error')
        setStatusMessage(`${definition.name} does not support OAuth login yet.`)
        return
      }

      abortOAuth()
      const controller = new AbortController()
      oauthAbortRef.current = controller
      setStep('oauth')
      setStatus('authorizing')
      setStatusMessage('Starting ChatGPT authorization…')
      setOauthUrl(null)
      setOauthCode(null)

      void (async () => {
        try {
          const authorization = await createChatGptDeviceAuthorization()
          if (controller.signal.aborted) {
            return
          }
          setOauthUrl(authorization.verificationUrl)
          setOauthCode(authorization.userCode)
          setStatusMessage('Open the URL and enter the code. Waiting for approval…')
          const credential = await pollChatGptDeviceAuthorization(authorization, controller.signal)
          if (controller.signal.aborted) {
            return
          }
          await persistCredential(definition, credential)
        } catch (error) {
          if (controller.signal.aborted) {
            return
          }
          setStatus('error')
          setStatusMessage(error instanceof Error ? error.message : String(error))
        } finally {
          if (oauthAbortRef.current === controller) {
            oauthAbortRef.current = null
          }
        }
      })()
    },
    [abortOAuth, persistCredential],
  )

  const open = useCallback(
    (initialProviderId?: string) => {
      refreshRows()
      setIsOpen(true)
      const trimmed = initialProviderId?.trim()
      if (!trimmed) {
        setStep('list')
        setSelectedIndex(0)
        setStatusMessage(null)
        return
      }

      const definition = findProviderDefinition(trimmed)
      if (!definition) {
        setStep('list')
        setSelectedIndex(0)
        setStatusMessage(`Unknown provider "${trimmed}". Pick one from the list below.`)
        return
      }

      const index = providers.findIndex((entry) => entry.id === definition.id)
      setSelectedIndex(index >= 0 ? index : 0)
      if (isProviderConnected(definition.id)) {
        setStep('disconnect-confirm')
      } else {
        if (definition.authMethod === 'oauth') {
          startOAuth(definition)
        } else {
          openProviderInput(definition)
        }
      }
    },
    [openProviderInput, refreshRows, startOAuth],
  )

  const moveSelection = useCallback(
    (delta: number) => {
      if (step !== 'list') {
        return
      }
      setSelectedIndex((previous) => {
        const next = previous + delta
        return Math.max(0, Math.min(next, rows.length - 1))
      })
    },
    [rows.length, step],
  )

  const back = useCallback(() => {
    abortOAuth()
    setStep('list')
    setStatus('idle')
    setStatusMessage(null)
    setLastAttemptedValue(null)
    setOauthUrl(null)
    setOauthCode(null)
  }, [abortOAuth])

  const enterSelected = useCallback(() => {
    const row = rows[selectedIndex]
    if (!row) {
      return
    }
    const definition = findProviderDefinition(row.id)
    if (!definition) {
      return
    }
    if (row.connected) {
      setStep('disconnect-confirm')
      setStatusMessage(null)
      return
    }
    if (definition.authMethod === 'oauth') {
      startOAuth(definition)
      return
    }
    openProviderInput(definition)
  }, [openProviderInput, rows, selectedIndex, startOAuth])

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
    setStatus('idle')
    setStatusMessage(null)
  }, [])

  const activeRow = rows[selectedIndex] ?? null

  const submitInput = useCallback(() => {
    const row = activeRow
    if (!row) {
      return
    }
    const definition = findProviderDefinition(row.id)
    if (!definition) {
      return
    }

    const trimmedValue = inputValue.trim()
    const credential = definition.authMethod === 'local'
      ? { apiKey: null, baseURL: trimmedValue || definition.defaultBaseURL || null }
      : { apiKey: trimmedValue || null, baseURL: null }

    if (definition.authMethod === 'api-key' && !credential.apiKey) {
      setStatus('error')
      setStatusMessage(`Enter an API key for ${definition.name}.`)
      return
    }
    if (definition.authMethod === 'local' && !credential.baseURL) {
      setStatus('error')
      setStatusMessage(`Enter a base URL for ${definition.name}.`)
      return
    }

    // Pressing submit again with the same value after a failed test saves anyway,
    // so a flaky/offline check never blocks the user from connecting.
    if (status === 'error' && lastAttemptedValue === trimmedValue) {
      void persistCredential(definition, credential)
      return
    }

    setStatus('testing')
    setStatusMessage(null)
    setLastAttemptedValue(trimmedValue)

    void testProviderConnection(definition.id, credential)
      .then(async (result) => {
        if (!result.ok) {
          setStatus('error')
          setStatusMessage(`${result.error ?? `Could not verify ${definition.name}.`} Press Enter again to save anyway.`)
          return
        }
        await persistCredential(definition, credential)
      })
      .catch(() => {
        setStatus('error')
        setStatusMessage(`Could not verify ${definition.name}. Press Enter again to save anyway.`)
      })
  }, [activeRow, inputValue, lastAttemptedValue, persistCredential, status])

  const confirmDisconnect = useCallback(() => {
    const row = activeRow
    if (!row) {
      return
    }
    void (async () => {
      await removeProviderCredential(row.id)
      clearProviderCredential(row.id)
      refreshRows()
      onProviderCredentialChange?.(row.id)
      await runtime.conversationStore.pushMessage({
        id: generateId(),
        role: 'system',
        content: `Disconnected ${row.name}.`,
        timestamp: new Date().toISOString(),
      })
      setStep('list')
    })()
  }, [activeRow, onProviderCredentialChange, refreshRows, runtime.conversationStore])

  const state = useMemo<ConnectProviderState>(
    () => ({
      isOpen,
      step,
      rows,
      selectedIndex,
      activeRow,
      inputValue,
      status,
      statusMessage,
      canForceSave: status === 'error',
      oauthUrl,
      oauthCode,
    }),
    [activeRow, inputValue, isOpen, oauthCode, oauthUrl, rows, selectedIndex, status, statusMessage, step],
  )

  return {
    state,
    open,
    close,
    back,
    moveSelection,
    enterSelected,
    handleInputChange,
    submitInput,
    confirmDisconnect,
  }
}

export type UseConnectProviderResult = ReturnType<typeof useConnectProvider>
