import { TextAttributes, type SelectOption, type SubmitEvent } from '@opentui/core'
import { useMemo } from 'react'

import { theme } from '../theme'

export interface SessionPickerOption {
  key: string
  kind: 'new' | 'session'
  title: string
  description: string
}

export interface SessionPickerOverlayProps {
  isOpen: boolean
  hasFocus: boolean
  filterValue: string
  selectedIndex: number
  fetchState: 'idle' | 'loading' | 'success' | 'error'
  fetchError: string | null
  options: SessionPickerOption[]
  onFilterChange: (value: string) => void
  onFilterSubmit: (value: string) => void
  onOptionChange: (index: number) => void
  onOptionSelect: (index: number) => void
}

export function SessionPickerOverlay({
  isOpen,
  hasFocus,
  filterValue,
  selectedIndex,
  fetchState,
  fetchError,
  options,
  onFilterChange,
  onFilterSubmit,
  onOptionChange,
  onOptionSelect,
}: SessionPickerOverlayProps) {
  const selectOptions = useMemo<SelectOption[]>(
    () =>
      options.map((option) => ({
        name: option.title,
        description: option.description,
        value: option.key,
      })),
    [options],
  )

  function handleSubmit(value: string): void
  function handleSubmit(event: SubmitEvent): void
  function handleSubmit(valueOrEvent: string | SubmitEvent): void {
    onFilterSubmit(typeof valueOrEvent === 'string' ? valueOrEvent : filterValue)
  }

  if (!isOpen) {
    return null
  }

  return (
    <box
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 95,
      }}
    >
      <box
        flexDirection="column"
        gap={1}
        style={{
          border: ['left'],
          borderStyle: 'heavy',
          borderColor: theme.inputBorder,
          padding: 2,
          backgroundColor: theme.header,
          minWidth: 70,
          maxWidth: 92,
        }}
      >
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Resume Conversation" />
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={'Type to filter saved sessions. Enter resumes the highlighted session. Type "new" to start clean or "cancel" to close.'}
        />
        {fetchState === 'loading' ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Loading saved conversations…" />
        ) : null}
        {fetchState === 'error' ? (
          <>
            <text fg={theme.errorFg} content={`Failed to load saved conversations: ${fetchError ?? 'Unknown error'}`} />
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={'Type "retry" to try again, "new" to start clean, or "cancel" to close.'}
            />
          </>
        ) : null}
        {fetchState === 'success' && options.length === 0 ? (
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content='No saved conversations match the current filter.'
          />
        ) : null}
        {selectOptions.length > 0 ? (
          <select
            options={selectOptions}
            selectedIndex={selectedIndex}
            onChange={(index) => onOptionChange(index ?? 0)}
            onSelect={(index) => onOptionSelect(index ?? 0)}
            showDescription
            backgroundColor={theme.background}
            selectedBackgroundColor={theme.selectedBg}
            selectedTextColor={theme.selectedFg}
            textColor={theme.statusFg}
            descriptionColor={theme.descriptionFg}
            focusedBackgroundColor={theme.selectedBg}
            focusedTextColor={theme.selectedFg}
            selectedDescriptionColor={theme.descriptionFg}
            style={{ minHeight: 8, minWidth: 62 }}
          />
        ) : null}
        <input
          value={filterValue}
          onInput={onFilterChange}
          onSubmit={handleSubmit}
          focused={hasFocus}
          textColor={theme.userFg}
        />
      </box>
    </box>
  )
}
