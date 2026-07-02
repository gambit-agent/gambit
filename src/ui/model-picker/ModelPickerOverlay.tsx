import { TextAttributes, type SelectOption, type SubmitEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/react'
import { useMemo } from 'react'

import {
  codexReasoningEfforts,
  reasoningEfforts,
  type ReasoningEffort,
} from '../../lib/model'
import { isOpenRouterRoutedModel } from '../../lib/modelPicker'
import type { ModelPickerState } from '../../lib/modelPicker'
import type { ModelListItem, ModelProviderOption } from '../../lib/openrouterModels'
import { isGpt5Model } from '../../lib/openrouterModels'
import { getProviderDefinition, parseDirectProviderModelId } from '../../lib/providers'
import { PopupOverlay } from '../components/PopupOverlay'
import { theme } from '../theme'

export interface ModelPickerOverlayProps {
  state: ModelPickerState
  currentModelId: string
  hasFocus: boolean
  onFilterChange: (value: string) => void
  onFilterSubmit: (value: string) => void
  onOptionChange: (index: number, modelId?: string) => void
  onOptionSelect: (index: number, modelId?: string) => void
  onProviderOptionChange: (index: number) => void
  onProviderOptionSelect: (index: number) => void
  onClose?: () => void
}

interface ModelSourceDetails {
  badge: string
  label: string
  route: string
}

function formatTokenPricePerMillion(price: string | null): string | null {
  if (!price) {
    return null
  }
  const value = Number.parseFloat(price)
  if (!Number.isFinite(value)) {
    return price
  }
  const perMillion = value * 1_000_000
  if (perMillion === 0) {
    return '$0/M'
  }
  const fractionDigits = perMillion < 1
    ? { minimumFractionDigits: 2, maximumFractionDigits: perMillion < 0.01 ? 6 : 4 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 2 }
  return `$${perMillion.toLocaleString('en-US', fractionDigits)}/M`
}

function formatRequestPrice(price: string | null): string | null {
  if (!price || price === '0') {
    return null
  }
  const value = Number.parseFloat(price)
  if (!Number.isFinite(value)) {
    return price
  }
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}/request`
}

function describePricing(model: ModelListItem): string | null {
  const parts: string[] = []
  const promptPrice = formatTokenPricePerMillion(model.promptPrice)
  const completionPrice = formatTokenPricePerMillion(model.completionPrice)
  const requestPrice = formatRequestPrice(model.requestPrice)
  if (promptPrice) {
    parts.push(`input ${promptPrice}`)
  }
  if (completionPrice) {
    parts.push(`output ${completionPrice}`)
  }
  if (requestPrice) {
    parts.push(`request ${requestPrice}`)
  }
  if (parts.length === 0) {
    return null
  }
  return parts.join(' · ')
}

function getModelSourceDetails(model: ModelListItem): ModelSourceDetails {
  const directRef = parseDirectProviderModelId(model.id)
  if (directRef) {
    const provider = getProviderDefinition(directRef.providerId)
    return {
      badge: provider.id.toUpperCase(),
      label: provider.name,
      route: 'direct connector',
    }
  }

  if (model.id.startsWith('codex/') || model.id.startsWith('openai-codex/')) {
    return {
      badge: 'CODEX',
      label: 'Codex',
      route: 'local CLI connector',
    }
  }

  if (isOpenRouterRoutedModel(model)) {
    return {
      badge: 'OR',
      label: 'OpenRouter',
      route: 'routed catalog',
    }
  }

  return {
    badge: 'PRESET',
    label: model.provider ?? 'Preset',
    route: 'saved preset',
  }
}

function formatTags(tags: readonly string[]): string | null {
  return tags.length > 0 ? tags.join(', ') : null
}

function buildOption(
  model: ModelListItem,
  currentModelId: string,
  reasoningEffort: ReasoningEffort | null,
  providerSlug: string | null,
): SelectOption {
  const name = model.name || model.id
  const statusTags: string[] = []
  const featureTags: string[] = []
  const source = getModelSourceDetails(model)
  if (model.id === currentModelId) {
    statusTags.push('current')
    if (reasoningEffort) {
      statusTags.push(`effort ${reasoningEffort}`)
    }
    if (providerSlug) {
      statusTags.push(`provider ${providerSlug}`)
    }
  }
  if (isGpt5Model(model)) {
    featureTags.push('GPT-5')
  }
  if (model.supportsReasoning) {
    featureTags.push('reasoning')
  }
  const pricing = describePricing(model)
  const details: string[] = []
  details.push(`${source.label} ${source.route}`)
  if (pricing) {
    details.push(`pricing ${pricing}`)
  }
  const features = formatTags(featureTags)
  if (features) {
    details.push(`features ${features}`)
  }
  const status = formatTags(statusTags)
  if (status) {
    details.push(status)
  }
  if (model.id !== name) {
    details.push(`id ${model.id}`)
  }
  return {
    name: `[${source.badge}] ${name}`,
    description: details.join(' · ') || model.id,
    value: model.id,
  }
}

function getEffortOptions(model: ModelListItem | null): readonly ReasoningEffort[] {
  if (!model?.supportsReasoning) {
    return []
  }
  return isOpenRouterRoutedModel(model) ? reasoningEfforts : codexReasoningEfforts
}

function describeProviderOption(provider: ModelProviderOption): string {
  const parts: string[] = []
  if (provider.name !== provider.slug) {
    parts.push(provider.name)
  }
  if (provider.quantization) {
    parts.push(provider.quantization)
  }
  const pricing = describeProviderPricing(provider)
  if (pricing) {
    parts.push(pricing)
  }
  if (provider.status && provider.status !== 'available') {
    parts.push(provider.status)
  }
  return parts.join(' · ')
}

function describeProviderPricing(provider: ModelProviderOption): string | null {
  const parts: string[] = []
  const promptPrice = formatTokenPricePerMillion(provider.promptPrice)
  const completionPrice = formatTokenPricePerMillion(provider.completionPrice)
  const requestPrice = formatRequestPrice(provider.requestPrice)
  if (promptPrice) {
    parts.push(`input ${promptPrice}`)
  }
  if (completionPrice) {
    parts.push(`output ${completionPrice}`)
  }
  if (requestPrice) {
    parts.push(`request ${requestPrice}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function buildProviderOptions(providers: readonly ModelProviderOption[]): SelectOption[] {
  return [
    {
      name: 'Auto routing',
      description: 'Let OpenRouter choose the best available provider',
      value: '',
    },
    ...providers.map((provider) => ({
      name: provider.slug,
      description: describeProviderOption(provider) || provider.name,
      value: provider.slug,
    })),
  ]
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
  onOptionChange,
  onOptionSelect,
  onProviderOptionChange,
  onProviderOptionSelect,
  onClose,
}: ModelPickerOverlayProps) {
  const { height: terminalHeight } = useTerminalDimensions()
  const options = useMemo(() => {
    return state.filteredModels.map((model) => buildOption(model, currentModelId, state.reasoningEffort, state.providerSlug))
  }, [currentModelId, state.filteredModels, state.providerSlug, state.reasoningEffort])
  const providerSelectOptions = useMemo(() => buildProviderOptions(state.providerOptions), [state.providerOptions])
  const listHeight = Math.max(5, Math.min(14, terminalHeight - 13))
  const effortOptions = getEffortOptions(state.pendingModel)
  const showProviderOptions = Boolean(state.pendingModel && isOpenRouterRoutedModel(state.pendingModel))

  function handleFilterSubmit(value: string): void
  function handleFilterSubmit(event: SubmitEvent): void
  function handleFilterSubmit(valueOrEvent: string | SubmitEvent): void {
    onFilterSubmit(typeof valueOrEvent === 'string' ? valueOrEvent : state.filterValue)
  }

  if (!state.isOpen) {
    return null
  }

  if (state.mode === 'options') {
    return (
      <PopupOverlay size="medium" zIndex={100} onClose={onClose}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text
              fg={theme.headerAccent}
              attributes={TextAttributes.BOLD}
              content="Model options"
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
          {effortOptions.length > 0 ? (
            <box flexDirection="column" gap={1}>
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Reasoning effort" />
              <box flexDirection="row" gap={2}>
              {effortOptions.map((option) => {
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
            </box>
          ) : null}
          {showProviderOptions ? (
            <box flexDirection="column" gap={1}>
              <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Provider" />
              {state.providerFetchState === 'loading' ? (
                <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Loading providers…" />
              ) : null}
              {state.providerFetchState === 'error' ? (
                <text
                  fg={theme.warningAccent}
                  content="Provider suggestions unavailable."
                />
              ) : null}
              <select
                options={providerSelectOptions}
                selectedIndex={state.selectedProviderIndex}
                onChange={(index) => onProviderOptionChange(index ?? 0)}
                onSelect={(index) => onProviderOptionSelect(index ?? 0)}
                showDescription
                backgroundColor={theme.background}
                selectedBackgroundColor={theme.selectedBg}
                selectedTextColor={theme.selectedFg}
                textColor={theme.statusFg}
                descriptionColor={theme.descriptionFg}
                focusedBackgroundColor={theme.selectedBg}
                focusedTextColor={theme.selectedFg}
                selectedDescriptionColor={theme.descriptionFg}
                height={Math.max(3, Math.min(8, terminalHeight - 18))}
                width="100%"
              />
            </box>
          ) : null}
          {state.reasoningEffort ? (
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`Current effort · ${state.reasoningEffort}`}
            />
          ) : null}
          {state.providerSlug ? (
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`Current provider · ${state.providerSlug}`}
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
            {effortOptions.length > 0 ? <FooterHint title="←→" label="effort" /> : null}
            {showProviderOptions ? <FooterHint title="↑↓" label="provider" /> : null}
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
            placeholder="Search by model, provider, feature, or connector"
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
          <box paddingLeft={3} paddingRight={3}>
            <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
              <span fg={theme.headerAccent}>[OR]</span><span> OpenRouter  </span><span fg={theme.headerAccent}>[OPENAI]</span><span> direct connectors  </span><span fg={theme.headerAccent}>[CODEX]</span><span> local/preset</span>
            </text>
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
