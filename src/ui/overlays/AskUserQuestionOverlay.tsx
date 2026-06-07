import { TextAttributes } from '@opentui/core'

import { theme } from '../theme'
import type { AskUserQuestionController } from './useAskUserQuestionController'

export {
  useAskUserQuestionController,
} from './useAskUserQuestionController'
export type {
  AskUserQuestionController,
  UseAskUserQuestionControllerOptions,
} from './useAskUserQuestionController'

export interface AskUserQuestionOverlayProps {
  controller: AskUserQuestionController
  hasFocus: boolean
}

export function AskUserQuestionOverlay({ controller, hasFocus }: AskUserQuestionOverlayProps) {
  const {
    record,
    currentQuestion,
    currentIndex,
    totalQuestions,
    focusedIndex,
    selectedIndices,
    otherText,
    isInOther,
    showHelp,
    handleOtherInput,
  } = controller

  if (!record || !currentQuestion) {
    return null
  }

  const hasPreviews = !currentQuestion.multiSelect && currentQuestion.options.some((option) => option.preview)
  const focusedOption =
    focusedIndex < currentQuestion.options.length ? currentQuestion.options[focusedIndex] : null
  const focusedPreview = focusedOption?.preview
  const progress = totalQuestions > 1 ? `${currentIndex + 1}/${totalQuestions}` : null
  const modeLabel = currentQuestion.multiSelect ? 'Multi-select' : 'Single-select'

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
        zIndex: 92,
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
          minWidth: hasPreviews ? 96 : 72,
          maxWidth: 120,
        }}
      >
        <box flexDirection="row" gap={2} alignItems="center">
          <box style={{ backgroundColor: theme.toolBg, paddingLeft: 1, paddingRight: 1 }}>
            <text fg={theme.toolFg} attributes={TextAttributes.BOLD}>
              {currentQuestion.header}
            </text>
          </box>
          {progress ? (
            <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
              Question {progress}
            </text>
          ) : null}
          <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
            · {modeLabel}
          </text>
        </box>

        <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
          {currentQuestion.question}
        </text>

        <box flexDirection="row" gap={2}>
          <box flexDirection="column" gap={0} style={{ minWidth: hasPreviews ? 44 : 64 }}>
            {currentQuestion.options.map((option, index) => (
              <OptionRow
                key={`${option.label}-${index}`}
                option={option}
                index={index}
                isFocused={!isInOther && focusedIndex === index}
                isSelected={currentQuestion.multiSelect && selectedIndices.has(index)}
                multiSelect={currentQuestion.multiSelect}
              />
            ))}
            <OtherRow
              index={currentQuestion.options.length}
              isFocused={!isInOther && focusedIndex === currentQuestion.options.length}
              isSelected={currentQuestion.multiSelect && selectedIndices.has(currentQuestion.options.length)}
              multiSelect={currentQuestion.multiSelect}
              otherText={otherText}
              isInOther={isInOther}
              onInput={handleOtherInput}
              hasFocus={hasFocus && isInOther}
            />
          </box>

          {hasPreviews ? (
            <box
              flexDirection="column"
              gap={0}
              style={{
                border: ['left', 'right', 'top', 'bottom'],
                borderStyle: 'rounded',
                borderColor: theme.bodyBorder,
                padding: 1,
                minWidth: 48,
                maxWidth: 72,
                backgroundColor: theme.codeBlockBg,
              }}
            >
              <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                Preview
              </text>
              {focusedPreview ? (
                <PreviewContent content={focusedPreview} />
              ) : (
                <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
                  (no preview for this option)
                </text>
              )}
            </box>
          ) : null}
        </box>

        <box flexDirection="column" gap={0}>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
            {currentQuestion.multiSelect
              ? 'Space toggles · Enter submits · ↑/↓ navigate · Tab next · Esc cancel · ? help'
              : 'Enter selects · ↑/↓ navigate · 1-4 quick pick · Tab next · Esc cancel · ? help'}
          </text>
          {showHelp ? <HelpPanel multiSelect={currentQuestion.multiSelect} /> : null}
        </box>
      </box>
    </box>
  )
}

interface OptionRowProps {
  option: { label: string; description: string }
  index: number
  isFocused: boolean
  isSelected: boolean
  multiSelect: boolean
}

function OptionRow({ option, index, isFocused, isSelected, multiSelect }: OptionRowProps) {
  const prefix = multiSelect ? (isSelected ? '[✓]' : '[ ]') : isFocused ? '›' : ' '
  const labelColor = isFocused ? theme.headerAccent : theme.userFg
  const descriptionColor = isFocused ? theme.assistantFg : theme.statusFg

  return (
    <box flexDirection="column" gap={0} paddingY={0}>
      <box flexDirection="row" gap={1}>
        <text fg={isFocused ? theme.headerAccent : theme.statusFg} attributes={TextAttributes.BOLD}>
          {prefix}
        </text>
        <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
          {index + 1}.
        </text>
        <text fg={labelColor} attributes={isFocused ? TextAttributes.BOLD : undefined}>
          {option.label}
        </text>
      </box>
      {isFocused ? (
        <box paddingLeft={5}>
          <text fg={descriptionColor} attributes={TextAttributes.DIM}>
            {option.description}
          </text>
        </box>
      ) : null}
    </box>
  )
}

interface OtherRowProps {
  index: number
  isFocused: boolean
  isSelected: boolean
  multiSelect: boolean
  otherText: string
  isInOther: boolean
  onInput: (value: string) => void
  hasFocus: boolean
}

function OtherRow({
  index,
  isFocused,
  isSelected,
  multiSelect,
  otherText,
  isInOther,
  onInput,
  hasFocus,
}: OtherRowProps) {
  const prefix = multiSelect ? (isSelected ? '[✓]' : '[ ]') : isFocused ? '›' : ' '
  const labelColor = isFocused ? theme.headerAccent : theme.userFg

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1}>
        <text fg={isFocused ? theme.headerAccent : theme.statusFg} attributes={TextAttributes.BOLD}>
          {prefix}
        </text>
        <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
          {index + 1}.
        </text>
        <text fg={labelColor} attributes={isFocused ? TextAttributes.BOLD : undefined}>
          Other
        </text>
        {otherText && !isInOther ? (
          <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
            — {otherText}
          </text>
        ) : null}
      </box>
      {isInOther ? (
        <box paddingLeft={5} paddingTop={0}>
          <input
            value={otherText}
            onInput={onInput}
            focused={hasFocus}
            backgroundColor={theme.inputBg}
            focusedBackgroundColor={theme.inputFocusedBg}
            textColor={theme.userFg}
            placeholderColor={theme.statusFg}
            placeholder="Type your answer…"
            cursorColor={theme.headerAccent}
          />
        </box>
      ) : null}
    </box>
  )
}

function PreviewContent({ content }: { content: string }) {
  const lines = content.split('\n').slice(0, 24)
  return (
    <box flexDirection="column" gap={0}>
      {lines.map((line, index) => (
        <text key={index} fg={theme.codeBlockFg}>
          {line || ' '}
        </text>
      ))}
    </box>
  )
}

function HelpPanel({ multiSelect }: { multiSelect: boolean }) {
  const rows: [string, string][] = [
    ['↑ / ↓', 'Move focus between options'],
    ['Enter', multiSelect ? 'Submit current selections' : 'Pick focused option and advance'],
    ['1-4', 'Quick-pick option by number'],
    ['Tab / Shift+Tab', 'Advance or go back between questions'],
    ['Space', multiSelect ? 'Toggle focused option' : 'Toggle Other input (when focused)'],
    ['Esc', 'Cancel this question request'],
    ['?', 'Toggle this help'],
  ]
  return (
    <box flexDirection="column" paddingTop={1} gap={0}>
      <text fg={theme.headerAccent} attributes={TextAttributes.BOLD}>
        Keyboard shortcuts
      </text>
      {rows.map(([keys, description]) => (
        <box key={keys} flexDirection="row" gap={2}>
          <box style={{ minWidth: 18 }}>
            <text fg={theme.userFg} attributes={TextAttributes.BOLD}>
              {keys}
            </text>
          </box>
          <text fg={theme.statusFg} attributes={TextAttributes.DIM}>
            {description}
          </text>
        </box>
      ))}
    </box>
  )
}
