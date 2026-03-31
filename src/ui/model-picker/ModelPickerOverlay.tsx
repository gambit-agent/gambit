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
  onFilterChange: (value: string) => void
  onFilterSubmit: (value: string) => void
  onReasoningChange: (value: string) => void
  onReasoningSubmit: (value: string) => void
  onOptionChange: (index: number) => void
  onOptionSelect: (index: number) => void
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
            padding: 2,
            backgroundColor: theme.header,
            minWidth: 60,
            maxWidth: 80,
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
          {state.reasoningError ? <text fg="#ff6b6b" content={state.reasoningError} /> : null}
          <input value={state.reasoningInput} onInput={onReasoningChange} onSubmit={handleReasoningSubmit} focused />
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
          padding: 2,
          backgroundColor: theme.header,
          minWidth: 70,
          maxWidth: 90,
        }}
      >
        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD} content="/model · Select a model" />
        <text
          fg={theme.statusFg}
          attributes={TextAttributes.DIM}
          content={'Type to filter models. Enter selects the highlighted result. Type "cancel" to exit.'}
        />
        {state.fetchState === "loading" ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM} content="Loading models…" />
        ) : null}
        {state.fetchState === "error" ? (
          <>
            <text fg="#ff6b6b" content={`Failed to load models: ${state.fetchError ?? "Unknown error"}`} />
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
            onChange={(index) => onOptionChange(index ?? 0)}
            onSelect={(index) => onOptionSelect(index ?? 0)}
            showDescription
            style={{ minHeight: 8, minWidth: 60 }}
          />
        ) : null}
        {state.hint ? <text fg="#ffae42" content={state.hint} /> : null}
        <input value={state.filterValue} onInput={onFilterChange} onSubmit={handleFilterSubmit} focused />
      </box>
    </box>
  )
}
