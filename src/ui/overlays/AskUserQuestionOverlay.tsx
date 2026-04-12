import { TextAttributes, type ParsedKey } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  Question,
  QuestionAnnotation,
  QuestionAnswerBundle,
  QuestionRequestRecord,
} from '../../questions/question-types'
import { theme } from '../theme'

const OTHER_VALUE = '__other__'

export interface AskUserQuestionController {
  record: QuestionRequestRecord | null
  currentIndex: number
  currentQuestion: Question | null
  totalQuestions: number
  focusedIndex: number
  selectedIndices: Set<number>
  otherText: string
  isInOther: boolean
  showHelp: boolean
  handleKey: (key: ParsedKey) => boolean
  handleOtherInput: (value: string) => void
  submit: () => void
  cancel: () => void
}

export interface UseAskUserQuestionControllerOptions {
  record: QuestionRequestRecord | null
  onResolve: (id: string, bundle: QuestionAnswerBundle) => void
  onReject: (id: string, reason: string) => void
}

export function useAskUserQuestionController(
  options: UseAskUserQuestionControllerOptions,
): AskUserQuestionController {
  const { record, onResolve, onReject } = options
  const [currentIndex, setCurrentIndex] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [perQuestionState, setPerQuestionState] = useState<
    Record<string, { selected: Set<number>; otherText: string; confirmed?: string | string[] }>
  >({})
  const [isInOther, setIsInOther] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    setCurrentIndex(0)
    setFocusedIndex(0)
    setPerQuestionState({})
    setIsInOther(false)
    setShowHelp(false)
  }, [record?.id])

  const currentQuestion = record?.questions[currentIndex] ?? null
  const totalQuestions = record?.questions.length ?? 0
  const questionKey = currentQuestion?.question ?? ''
  const state = perQuestionState[questionKey] ?? { selected: new Set<number>(), otherText: '' }

  const totalOptionsForCurrent = useMemo(() => {
    if (!currentQuestion) return 0
    return currentQuestion.options.length + 1 // + Other
  }, [currentQuestion])

  const ensureStateBucket = useCallback(
    (updater: (current: { selected: Set<number>; otherText: string; confirmed?: string | string[] }) => {
      selected: Set<number>
      otherText: string
      confirmed?: string | string[]
    }) => {
      setPerQuestionState((prev) => {
        const existing = prev[questionKey] ?? { selected: new Set<number>(), otherText: '' }
        const next = updater(existing)
        return { ...prev, [questionKey]: next }
      })
    },
    [questionKey],
  )

  const commitCurrent = useCallback((overrideIndex?: number): { values: string[]; preview?: string; otherUsed: boolean } | null => {
    if (!currentQuestion) return null
    const effectiveIndex = overrideIndex ?? focusedIndex
    const isOtherFocused = effectiveIndex === currentQuestion.options.length
    const selected = state.selected
    const otherText = state.otherText.trim()

    if (currentQuestion.multiSelect) {
      const values: string[] = []
      let otherUsed = false
      for (const [index, option] of currentQuestion.options.entries()) {
        if (selected.has(index)) {
          values.push(option.label)
        }
      }
      if (selected.has(currentQuestion.options.length)) {
        if (!otherText) return null
        values.push(otherText)
        otherUsed = true
      }
      if (values.length === 0) return null
      return { values, otherUsed }
    }

    if (isOtherFocused) {
      if (!otherText) return null
      return { values: [otherText], otherUsed: true }
    }
    const option = currentQuestion.options[effectiveIndex]
    if (!option) return null
    return {
      values: [option.label],
      preview: option.preview,
      otherUsed: false,
    }
  }, [currentQuestion, focusedIndex, state.selected, state.otherText])

  const submitRecord = useCallback(
    (finalStates: Record<string, { selected: Set<number>; otherText: string; confirmed?: string | string[] }>) => {
      if (!record) return
      const answers: Record<string, string> = {}
      const annotations: Record<string, QuestionAnnotation> = {}

      for (const question of record.questions) {
        const bucket = finalStates[question.question]
        if (!bucket) return
        const confirmed = bucket.confirmed
        if (confirmed === undefined) return
        answers[question.question] = Array.isArray(confirmed) ? confirmed.join(', ') : confirmed
        if (!question.multiSelect && !Array.isArray(confirmed)) {
          const option = question.options.find((opt) => opt.label === confirmed)
          if (option?.preview) {
            annotations[question.question] = { preview: option.preview }
          }
        }
      }

      const bundle: QuestionAnswerBundle = {
        answers,
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
      }
      onResolve(record.id, bundle)
    },
    [record, onResolve],
  )

  const confirmAndAdvance = useCallback((overrideIndex?: number) => {
    if (!record || !currentQuestion) return
    const commit = commitCurrent(overrideIndex)
    if (!commit) return

    const confirmedValue = currentQuestion.multiSelect ? commit.values : commit.values[0]!
    const nextStates: typeof perQuestionState = {
      ...perQuestionState,
      [currentQuestion.question]: {
        selected: state.selected,
        otherText: state.otherText,
        confirmed: confirmedValue,
      },
    }
    setPerQuestionState(nextStates)
    setIsInOther(false)

    if (currentIndex + 1 < record.questions.length) {
      setCurrentIndex(currentIndex + 1)
      setFocusedIndex(0)
      return
    }

    submitRecord(nextStates)
  }, [
    commitCurrent,
    currentIndex,
    currentQuestion,
    perQuestionState,
    record,
    state.otherText,
    state.selected,
    submitRecord,
  ])

  const goPrev = useCallback(() => {
    if (currentIndex === 0) return
    setIsInOther(false)
    setCurrentIndex(currentIndex - 1)
    setFocusedIndex(0)
  }, [currentIndex])

  const toggleMultiSelectCurrent = useCallback(() => {
    if (!currentQuestion || !currentQuestion.multiSelect) return
    ensureStateBucket((current) => {
      const next = new Set(current.selected)
      if (next.has(focusedIndex)) {
        next.delete(focusedIndex)
      } else {
        next.add(focusedIndex)
      }
      return { ...current, selected: next }
    })
  }, [currentQuestion, ensureStateBucket, focusedIndex])

  const handleOtherInput = useCallback(
    (value: string) => {
      ensureStateBucket((current) => ({ ...current, otherText: value }))
    },
    [ensureStateBucket],
  )

  const handleKey = useCallback(
    (key: ParsedKey): boolean => {
      if (!record || !currentQuestion) return false

      if (isInOther) {
        if (key.name === 'escape') {
          setIsInOther(false)
          return true
        }
        if (key.name === 'return') {
          if (!currentQuestion.multiSelect) {
            confirmAndAdvance()
          } else {
            ensureStateBucket((current) => {
              const next = new Set(current.selected)
              if (current.otherText.trim()) {
                next.add(currentQuestion.options.length)
              } else {
                next.delete(currentQuestion.options.length)
              }
              return { ...current, selected: next }
            })
            setIsInOther(false)
          }
          return true
        }
        return false
      }

      if (key.name === 'escape') {
        onReject(record.id, 'User cancelled the question.')
        return true
      }
      if (key.name === 'up') {
        setFocusedIndex((current) => Math.max(0, current - 1))
        return true
      }
      if (key.name === 'down') {
        setFocusedIndex((current) => Math.min(totalOptionsForCurrent - 1, current + 1))
        return true
      }
      if (key.name === 'tab') {
        if (key.shift) {
          goPrev()
        } else {
          if (currentIndex + 1 < totalQuestions) {
            confirmAndAdvance()
          }
        }
        return true
      }
      if (key.name === 'space' && currentQuestion.multiSelect) {
        if (focusedIndex === currentQuestion.options.length) {
          setIsInOther(true)
        } else {
          toggleMultiSelectCurrent()
        }
        return true
      }
      if (key.name === 'return') {
        if (!currentQuestion.multiSelect && focusedIndex === currentQuestion.options.length) {
          setIsInOther(true)
          return true
        }
        confirmAndAdvance()
        return true
      }
      if (key.name === '?') {
        setShowHelp((current) => !current)
        return true
      }
      if (key.raw === '1' || key.raw === '2' || key.raw === '3' || key.raw === '4') {
        const digit = Number.parseInt(key.raw, 10) - 1
        if (digit < currentQuestion.options.length) {
          setFocusedIndex(digit)
          if (!currentQuestion.multiSelect) {
            confirmAndAdvance(digit)
          }
        }
        return true
      }

      return false
    },
    [
      confirmAndAdvance,
      currentIndex,
      currentQuestion,
      ensureStateBucket,
      goPrev,
      isInOther,
      focusedIndex,
      onReject,
      record,
      toggleMultiSelectCurrent,
      totalOptionsForCurrent,
      totalQuestions,
    ],
  )

  return {
    record,
    currentIndex,
    currentQuestion,
    totalQuestions,
    focusedIndex,
    selectedIndices: state.selected,
    otherText: state.otherText,
    isInOther,
    showHelp,
    handleKey,
    handleOtherInput,
    submit: confirmAndAdvance,
    cancel: () => {
      if (record) onReject(record.id, 'User cancelled the question.')
    },
  }
}

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
          <box
            style={{
              backgroundColor: theme.toolBg,
              paddingLeft: 1,
              paddingRight: 1,
            }}
          >
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
