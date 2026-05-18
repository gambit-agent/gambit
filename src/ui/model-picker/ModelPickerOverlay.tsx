import { TextAttributes, type SelectOption, type SubmitEvent } from "@opentui/core"
import { useMemo } from "react"

import type { ReasoningEffort } from "../../lib/model"
import type { ModelPickerState } from "../../lib/modelPicker"
import type { ModelListItem } from "../../lib/openrouterModels"
import { isGpt5Model } from "../../lib/openrouterModels"
import { theme } from "../theme"

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
}

function describePricing(model: ModelListItem): string | null {
  const parts: string[] = []
  if (model.promptPrice) {
    parts.push(`prompt ${model.promptPrice}`)
  }
  if (model.completionPrice) {
    parts.push(`completion ${model.completionPrice}`)
  }
  if (model.requestPrice && model.requestPrice !== "0") {
    parts.push(`request ${model.requestPrice}`)
  }
  if (parts.length === 0) {
    return null
  }
  return parts.join(" · ")
}

function buildOption(
  model: ModelListItem,
  currentModelId: string,
  reasoningEffort: ReasoningEffort | null,
): SelectOption {
  const name = model.name || model.id
  const tags: string[] = []
  if (model.id === currentModelId) {
    tags.push("current")
    if (reasoningEffort) {
      tags.push(`effort:${reasoningEffort}`)
    }
  }
  if (isGpt5Model(model)) {
    tags.push("gpt-5")
  }
  if (model.supportsReasoning) {
    tags.push("reasoning")
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
    details.push(tags.join(", "))
  }
  return {
    name,
    description: details.join(" · ") || model.id,
    value: model.id,
  }
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
}: ModelPickerOverlayProps) {
  const options = useMemo(() => {
    return state.filteredModels.map((model) => buildOption(model, currentModelId, state.reasoningEffort))
  }, [currentModelId, state.filteredModels, state.reasoningEffort])

  function handleFilterSubmit(value: string): void
  function handleFilterSubmit(event: SubmitEvent): void
  function handleFilterSubmit(valueOrEvent: string | SubmitEvent): void {
    onFilterSubmit(typeof valueOrEvent === "string" ? valueOrEvent : state.filterValue)
  }

  function handleReasoningSubmit(value: string): void
  function handleReasoningSubmit(event: SubmitEvent): void
  function handleReasoningSubmit(valueOrEvent: string | SubmitEvent): void {
    onReasoningSubmit(typeof valueOrEvent === "string" ? valueOrEvent : state.reasoningInput)
  }

  if (!state.isOpen) {
    return null
  }

  if (state.mode === "reasoning") {
    return (
      <box
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 100,
        }}
      >
        <box
          flexDirection="column"
          gap={1}
          style={{
            border: ["left"],
            borderStyle: "heavy",
            borderColor: theme.inputBorder,
            padding: 1,
            backgroundColor: theme.background,
            minWidth: 45,
            maxWidth: 65,
          }}
        >
          <text
            fg={theme.headerAccent}
            attributes={TextAttributes.BOLD}
            content="/model · Reasoning effort"
          />
          {state.pendingModel ? (
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`Model · ${state.pendingModel.id}`}
            />
          ) : null}
          <text
            fg={theme.statusFg}
            attributes={TextAttributes.DIM}
            content={'Enter "low", "medium", or "high". Type "back" to re-open the list or "cancel" to exit.'}
          />
          <box flexDirection="row" gap={2}>
            {(["low", "medium", "high"] as const).map((option) => {
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
          {state.reasoningEffort ? (
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={`Current effort · ${state.reasoningEffort}`}
            />
          ) : null}
          {state.reasoningError ? <text fg={theme.errorFg} content={state.reasoningError} /> : null}
          <input
            value={state.reasoningInput}
            onInput={onReasoningChange}
            onSubmit={handleReasoningSubmit}
            focused={hasFocus}
          />
        </box>
      </box>
    )
  }

  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
      }}
    >
      <box
        flexDirection="column"
        gap={1}
        style={{
          border: ["left"],
          borderStyle: "heavy",
          borderColor: theme.inputBorder,
          padding: 1,
          backgroundColor: theme.background,
          minWidth: 50,
          maxWidth: 70,
        }}
      >
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="/model · Select a model" />
        {state.fetchState === "loading" ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Loading models…" />
        ) : null}
        {state.fetchState === "error" ? (
          <>
            <text fg={theme.errorFg} content={`Failed to load models: ${state.fetchError ?? "Unknown error"}`} />
            <text
              fg={theme.statusFg}
              attributes={TextAttributes.DIM}
              content={'Type "retry" to try again or "cancel" to exit.'}
            />
          </>
        ) : null}
        {state.fetchState === "success" && options.length === 0 ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="No models match the current filter." />
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
            style={{ minHeight: 5, minWidth: 50 }}
          />
        ) : null}
        {state.hint ? <text fg={theme.warningAccent} content={state.hint} /> : null}
        <input
          value={state.filterValue}
          onInput={onFilterChange}
          onSubmit={handleFilterSubmit}
          focused={hasFocus}
          placeholder={'Type to filter models. Enter selects. "cancel" to exit.'}
        />
      </box>
    </box>
  )
}
