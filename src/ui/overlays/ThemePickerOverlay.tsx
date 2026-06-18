import { TextAttributes } from '@opentui/core'

import { PopupOverlay } from '../components/PopupOverlay'
import { theme } from '../theme'

export interface ThemePickerEntry {
  id: string
  name: string
  mode: 'light' | 'dark'
}

export interface ThemePickerOverlayProps {
  isOpen: boolean
  entries: ThemePickerEntry[]
  selectedIndex: number
  activeThemeId: string
  onMove: (delta: number) => void
  onSelect: () => void
  onClose: () => void
}

export function ThemePickerOverlay({
  isOpen,
  entries,
  selectedIndex,
  activeThemeId,
  onMove,
  onSelect,
  onClose,
}: ThemePickerOverlayProps) {
  if (!isOpen) {
    return null
  }

  return (
    <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Color themes" />
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
        </box>
      </box>

      <box flexDirection="column" gap={0} paddingLeft={2} paddingRight={2}>
        {entries.map((entry, index) => (
          <ThemeRow
            key={entry.id}
            entry={entry}
            isFocused={index === selectedIndex}
            isActive={entry.id === activeThemeId}
          />
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
          <FooterHint title="↑↓" label="preview" />
          <FooterHint title="Enter" label="apply" />
        </box>
        <FooterHint title="Esc" label="cancel" />
      </box>
    </PopupOverlay>
  )
}

interface ThemeRowProps {
  entry: ThemePickerEntry
  isFocused: boolean
  isActive: boolean
}

function ThemeRow({ entry, isFocused, isActive }: ThemeRowProps) {
  const prefix = isFocused ? '›' : ' '
  const labelColor = isFocused ? theme.headerAccent : theme.userFg
  const modeLabel = entry.mode === 'light' ? 'light' : 'dark'
  const modeColor = entry.mode === 'light' ? theme.warningFg : theme.infoFg

  return (
    <box flexDirection="row" gap={1}>
      <text fg={isFocused ? theme.headerAccent : theme.statusFg} attributes={TextAttributes.BOLD}>
        {prefix}
      </text>
      <text fg={labelColor} attributes={isFocused ? TextAttributes.BOLD : undefined}>
        {entry.name}
      </text>
      <text fg={modeColor} attributes={TextAttributes.DIM}>
        {modeLabel}
      </text>
      {isActive ? (
        <text fg={theme.successFg} attributes={TextAttributes.BOLD}>
          *
        </text>
      ) : null}
    </box>
  )
}

function FooterHint({ title, label }: { title: string; label: string }) {
  return (
    <text>
      <span fg={theme.userFg} attributes={TextAttributes.BOLD}>{title}</span>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${label}`}</span>
    </text>
  )
}
