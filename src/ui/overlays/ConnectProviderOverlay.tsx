import { TextAttributes } from '@opentui/core'

import type { ConnectProviderState } from '../../repl/hooks/useConnectProvider'
import { PopupOverlay } from '../components/PopupOverlay'
import { theme } from '../theme'

export interface ConnectProviderOverlayProps {
  state: ConnectProviderState
  onMove: (delta: number) => void
  onEnter: () => void
  onInputChange: (value: string) => void
  onSubmitInput: () => void
  onConfirmDisconnect: () => void
  onBack: () => void
  onClose: () => void
}

function FooterHint({ title, label }: { title: string; label: string }) {
  return (
    <text>
      <span fg={theme.userFg} attributes={TextAttributes.BOLD}>{title}</span>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${label}`}</span>
    </text>
  )
}

function ProviderRow({
  row,
  isFocused,
}: {
  row: ConnectProviderState['rows'][number]
  isFocused: boolean
}) {
  const prefix = isFocused ? '›' : ' '
  const labelColor = isFocused ? theme.headerAccent : theme.userFg
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1}>
        <text fg={isFocused ? theme.headerAccent : theme.statusFg} attributes={TextAttributes.BOLD}>
          {prefix}
        </text>
        <text fg={labelColor} attributes={isFocused ? TextAttributes.BOLD : undefined}>
          {row.name}
        </text>
        {row.connected ? (
          <text fg={theme.successFg} attributes={TextAttributes.BOLD} content="connected" />
        ) : (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="not connected" />
        )}
      </box>
      {isFocused ? (
        <box paddingLeft={2}>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={row.description} />
        </box>
      ) : null}
    </box>
  )
}

export function ConnectProviderOverlay({
  state,
  onMove,
  onEnter,
  onInputChange,
  onSubmitInput,
  onConfirmDisconnect,
  onBack,
  onClose,
}: ConnectProviderOverlayProps) {
  if (!state.isOpen) {
    return null
  }

  if (state.step === 'oauth' && state.activeRow) {
    const row = state.activeRow
    return (
      <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content={`Connect ${row.name}`} />
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
          </box>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={row.description} />
        </box>
        <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4}>
          {state.oauthUrl ? (
            <text>
              <span fg={theme.statusFg} attributes={TextAttributes.DIM}>URL </span>
              <span fg={theme.userFg}>{state.oauthUrl}</span>
            </text>
          ) : null}
          {state.oauthCode ? (
            <text>
              <span fg={theme.statusFg} attributes={TextAttributes.DIM}>Code </span>
              <span fg={theme.headerAccent} attributes={TextAttributes.BOLD}>{state.oauthCode}</span>
            </text>
          ) : null}
          {state.status === 'authorizing' && state.statusMessage ? (
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={state.statusMessage} />
          ) : null}
          {state.status === 'error' && state.statusMessage ? (
            <text fg={theme.warningAccent} content={state.statusMessage} />
          ) : null}
        </box>
        <box
          paddingTop={1}
          paddingLeft={4}
          paddingRight={4}
          paddingBottom={1}
          flexDirection="row"
          justifyContent="space-between"
        >
          <FooterHint title="Enter" label="retry" />
          <FooterHint title="Esc" label="cancel" />
        </box>
      </PopupOverlay>
    )
  }

  if (state.step === 'input' && state.activeRow) {
    const row = state.activeRow
    const label = row.authMethod === 'local' ? 'Base URL' : 'API key'
    return (
      <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content={`Connect ${row.name}`} />
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
          </box>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={row.description} />
        </box>
        <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4}>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={label} />
          <input
            value={state.inputValue}
            onInput={onInputChange}
            onSubmit={onSubmitInput}
            focused
            textColor={theme.userFg}
            focusedBackgroundColor={theme.panel}
            cursorColor={theme.headerAccent}
            placeholder={row.authMethod === 'local' ? 'http://localhost:1234/v1' : 'sk-...'}
            placeholderColor={theme.statusFg}
          />
          {state.status === 'testing' ? (
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Testing connection…" />
          ) : null}
          {state.status === 'error' && state.statusMessage ? (
            <text fg={theme.warningAccent} content={state.statusMessage} />
          ) : null}
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content={`Get a key: ${row.docsUrl}`} />
        </box>
        <box
          paddingTop={1}
          paddingLeft={4}
          paddingRight={4}
          paddingBottom={1}
          flexDirection="row"
          justifyContent="space-between"
        >
          <FooterHint title="Enter" label={state.canForceSave ? 'save anyway' : 'connect'} />
          <FooterHint title="Esc" label="back" />
        </box>
      </PopupOverlay>
    )
  }

  if (state.step === 'disconnect-confirm' && state.activeRow) {
    const row = state.activeRow
    return (
      <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content={`Disconnect ${row.name}?`} />
        </box>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.statusFg} content="This removes the saved credential from ~/.gambit/config.json." />
        </box>
        <box
          paddingTop={1}
          paddingLeft={4}
          paddingRight={4}
          paddingBottom={1}
          flexDirection="row"
          justifyContent="space-between"
        >
          <FooterHint title="Enter" label="disconnect" />
          <FooterHint title="Esc" label="cancel" />
        </box>
      </PopupOverlay>
    )
  }

  return (
    <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Connect a provider" />
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
        </box>
        {state.statusMessage ? (
          <text fg={theme.warningAccent} content={state.statusMessage} />
        ) : null}
      </box>

      <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2}>
        {state.rows.map((row, index) => (
          <ProviderRow key={row.id} row={row} isFocused={index === state.selectedIndex} />
        ))}
      </box>

      <box
        paddingTop={1}
        paddingLeft={4}
        paddingRight={4}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <FooterHint title="↑↓" label="move" />
          <FooterHint title="Enter" label="connect / manage" />
        </box>
        <FooterHint title="Esc" label="close" />
      </box>
    </PopupOverlay>
  )
}
