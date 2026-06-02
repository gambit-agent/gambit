import { TextAttributes, type SelectOption, type SubmitEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/react'
import { useMemo } from 'react'

import type { ReasoningEffort } from '../../lib/model'
import type { ModelPickerState } from '../../lib/modelPicker'
import type { ModelListItem } from '../../lib/openrouterModels'
import { isGpt5Model } from '../../lib/openrouterModels'
import { PopupOverlay } from '../components/PopupOverlay'
import { theme } from '../theme'

export interface ModelPickerOverlayProps {
  state: ModelPickerState
  currentModelId: string
  hasFocus: boolean
  onFilterChange: (value: string) => void
  onFilterSubmit: (value: string) => void
  onReasoningChange: (value: string) => void
  onReasoningSubmit: (value: string) => void
  onOptionChange: (index: number, modelId?: string) => void
  onOptionSelect: (index: number, modelId?: string) => void
  onClose?: () => void
}

function describePricing(model: ModelListItem): string | null {
  const parts: string[] = []
  if (model.promptPrice) {
    parts.push(`in ${model.promptPrice}`)
  }
  if (model.completionPrice) {
    parts.push(`out ${model.completionPrice}`)
  }
  if (model.requestPrice && model.requestPrice !== '0') {
    parts.push(`request ${model.requestPrice}`)
  }
  if (parts.length === 0) {
    return null
  }
  return parts.join(' · ')
}

function buildOption(
  model: ModelListItem,
  currentModelId: string,
  reasoningEffort: ReasoningEffort | null,
): SelectOption {
  const name = model.name || model.id
  const tags: string[] = []
  if (model.id === currentModelId) {
    tags.push('current')
    if (reasoningEffort) {
      tags.push(`effort:${reasoningEffort}`)
    }
  }
  if (isGpt5Model(model)) {
    tags.push('gpt-5')
  }
  if (model.supportsReasoning) {
    tags.push('reasoning')
  }
  const pricing = describePricing(model)
  const details: string[] = []
  if (model.id !== name) {
    details.push(model.id)
  }
  if (model.provider) {
    details.push(model.provider)
  }
  if (pricing) {
    details.push(pricing)
  }
  if (tags.length) {
    details.push(tags.join(', '))
  }
  return {
    name,
    description: details.join(' · ') || model.id,
    value: model.id,
  }
}

function FooterHint({ title, label }: { title: string; label: string }) {
  return (
    <text>
      <span fg={theme.userFg} attributes={TextAttributes.BOLD}>{title}</span>
      <span fg={theme.statusFg} attributes={TextAttributes.DIM}>{` ${label}`}</span>
    </text>
  )
}

export function ModelPickerOverlay({
  state,
  currentModelId,
  hasFocus,
  onFilterChange,
  onFilterSubmit,
  onReasoningChange,
  onReasoningSubmit,
  onOptionChange,
  onOptionSelect,
  onClose,
}: ModelPickerOverlayProps) {
  const { height: terminalHeight } = useTerminalDimensions()
  const options = useMemo(() => {
    return state.filteredModels.map((model) => buildOption(model, currentModelId, state.reasoningEffort))
  }, [currentModelId, state.filteredModels, state.reasoningEffort])
  const listHeight = Math.max(5, Math.min(14, terminalHeight - 13))

  function handleFilterSubmit(value: string): void
  function handleFilterSubmit(event: SubmitEvent): void
  function handleFilterSubmit(valueOrEvent: string | SubmitEvent): void {
    onFilterSubmit(typeof valueOrEvent === 'string' ? valueOrEvent : state.filterValue)
  }

  function handleReasoningSubmit(value: string): void
  function handleReasoningSubmit(event: SubmitEvent): void
  function handleReasoningSubmit(valueOrEvent: string | SubmitEvent): void {
    onReasoningSubmit(typeof valueOrEvent === 'string' ? valueOrEvent : state.reasoningInput)
  }

  if (!state.isOpen) {
    return null
  }

  if (state.mode === 'reasoning') {
    return (
      <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text
              fg={theme.headerAccent}
              attributes={TextAttributes.BOLD}
              content="Reasoning effort"
            />
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
          </box>
          {state.pendingModel ? (
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`Model · ${state.pendingModel.id}`}
            />
          ) : null}
        </box>
        <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4}>
          <box flexDirection="row" gap={2}>
            {(['low', 'medium', 'high'] as const).map((option) => {
              const active = state.reasoningInput === option
              return (
                <text
                  key={option}
                  fg={theme.headerAccent}
                  attributes={active ? TextAttributes.BOLD : TextAttributes.DIM}
                  content={option}
                />
              )
            })}
          </box>
          <input
            value={state.reasoningInput}
            onInput={onReasoningChange}
            onSubmit={handleReasoningSubmit}
            focused={hasFocus}
            textColor={theme.userFg}
            focusedBackgroundColor={theme.panel}
            placeholder={'low, medium, high, back, or cancel'}
            placeholderColor={theme.statusFg}
          />
          {state.reasoningEffort ? (
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`Current effort · ${state.reasoningEffort}`}
            />
          ) : null}
          {state.reasoningError ? <text fg={theme.errorFg} content={state.reasoningError} /> : null}
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
            <FooterHint title="Enter" label="apply" />
            <FooterHint title="back" label="model list" />
          </box>
          <FooterHint title="Esc" label="close" />
        </box>
      </PopupOverlay>
    )
  }

  return (
    <PopupOverlay size="large" zIndex={100} onClose={onClose}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="Select model" />
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="esc" />
        </box>
        <box paddingTop={1}>
          <input
            value={state.filterValue}
            onInput={onFilterChange}
            onSubmit={handleFilterSubmit}
            focused={hasFocus}
            textColor={theme.userFg}
            focusedBackgroundColor={theme.panel}
            cursorColor={theme.headerAccent}
            placeholder="Search models"
            placeholderColor={theme.statusFg}
          />
        </box>
      </box>
      <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={1}>
        {state.fetchState === 'loading' ? (
          <box paddingLeft={3} paddingRight={3}>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Loading models…" />
          </box>
        ) : null}
        {state.fetchState === 'error' ? (
          <box flexDirection="column" gap={1} paddingLeft={3} paddingRight={3}>
            <text fg={theme.errorFg} content={`Failed to load models: ${state.fetchError ?? 'Unknown error'}`} />
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={'Type "retry" to try again or "cancel" to exit.'}
            />
          </box>
        ) : null}
        {state.fetchState === 'success' && options.length === 0 ? (
          <box paddingLeft={3} paddingRight={3}>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No models match the current filter." />
          </box>
        ) : null}
        {options.length > 0 ? (
          <select
            options={options}
            selectedIndex={state.selectedIndex}
            onChange={(index, option) =>
              onOptionChange(index ?? 0, typeof option?.value === 'string' ? option.value : undefined)
            }
            onSelect={(index, option) =>
              onOptionSelect(index ?? 0, typeof option?.value === 'string' ? option.value : undefined)
            }
            showDescription
            backgroundColor={theme.background}
            selectedBackgroundColor={theme.selectedBg}
            selectedTextColor={theme.selectedFg}
            textColor={theme.statusFg}
            descriptionColor={theme.descriptionFg}
            focusedBackgroundColor={theme.selectedBg}
            focusedTextColor={theme.selectedFg}
            selectedDescriptionColor={theme.descriptionFg}
            height={listHeight}
            width="100%"
          />
        ) : null}
      </box>
      {state.hint ? (
        <box paddingTop={1} paddingLeft={4} paddingRight={4}>
          <text fg={theme.warningAccent} content={state.hint} />
        </box>
      ) : null}
      <box
        paddingTop={1}
        paddingLeft={4}
        paddingRight={4}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <FooterHint title="Enter" label="select" />
          <FooterHint title="↑↓" label="move" />
        </box>
        <FooterHint title="Esc" label="close" />
      </box>
    </PopupOverlay>
  )
}
