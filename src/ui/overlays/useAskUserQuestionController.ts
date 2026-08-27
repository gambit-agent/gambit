import type { ParsedKey } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  Question,
  QuestionAnnotation,
  QuestionAnswerBundle,
  QuestionRequestRecord,
} from '../../questions/question-types'

export interface AskUserQuestionController {
  record: QuestionRequestRecord | null
  currentIndex: number
  currentQuestion: Question | null
  totalQuestions: number
  focusedIndex: number
  selectedIndices: Set<number>
  otherText: string
  /** True while the Other row holds focus, which is also when it is typeable. */
  isOtherFocused: boolean
  /**
   * Changes whenever the Other field is reset from code. OpenTUI's `<input>`
   * keeps its own text and ignores later `value` props, so the overlay uses
   * this as a React key to remount the field.
   */
  otherResetToken: number
  showHelp: boolean
  handleKey: (key: ParsedKey) => boolean
  handleOtherInput: (value: string) => void
  submit: () => void
  cancel: () => void
}

interface UseAskUserQuestionControllerOptions {
  record: QuestionRequestRecord | null
  onResolve: (id: string, bundle: QuestionAnswerBundle) => void
  onReject: (id: string, reason: string) => void
}

type QuestionState = {
  selected: Set<number>
  otherText: string
  confirmed?: string | string[]
}

export function useAskUserQuestionController(
  options: UseAskUserQuestionControllerOptions,
): AskUserQuestionController {
  const { record, onResolve, onReject } = options
  const [currentIndex, setCurrentIndex] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [perQuestionState, setPerQuestionState] = useState<Record<string, QuestionState>>({})
  const [showHelp, setShowHelp] = useState(false)
  const [otherResetToken, setOtherResetToken] = useState(0)
  // Mirrors the focused question's Other text synchronously. Key events can
  // arrive before React re-renders — typing then immediately pressing Enter —
  // and reading the render closure there would submit stale text.
  const otherTextRef = useRef('')

  useEffect(() => {
    setCurrentIndex(0)
    setFocusedIndex(0)
    setPerQuestionState({})
    setShowHelp(false)
    otherTextRef.current = ''
    setOtherResetToken((token) => token + 1)
  }, [record?.id])

  const currentQuestion = record?.questions[currentIndex] ?? null
  const totalQuestions = record?.questions.length ?? 0
  const questionKey = currentQuestion?.question ?? ''
  const state = perQuestionState[questionKey] ?? { selected: new Set<number>(), otherText: '' }

  const totalOptionsForCurrent = useMemo(() => {
    if (!currentQuestion) return 0
    return currentQuestion.options.length + 1
  }, [currentQuestion])

  // The Other row is the last one. Focusing it is all it takes to type into
  // it, so there is no separate "editing Other" mode to track.
  const isOtherFocused = currentQuestion !== null && focusedIndex === currentQuestion.options.length

  const ensureStateBucket = useCallback(
    (updater: (current: QuestionState) => QuestionState) => {
      setPerQuestionState((prev) => {
        const existing = prev[questionKey] ?? { selected: new Set<number>(), otherText: '' }
        return { ...prev, [questionKey]: updater(existing) }
      })
    },
    [questionKey],
  )

  const handleOtherInput = useCallback(
    (value: string) => {
      otherTextRef.current = value
      ensureStateBucket((current) => ({ ...current, otherText: value }))
    },
    [ensureStateBucket],
  )

  /** Reset the field and remount it, since the input ignores value changes. */
  const clearOtherText = useCallback(() => {
    otherTextRef.current = ''
    ensureStateBucket((current) => ({ ...current, otherText: '' }))
    setOtherResetToken((token) => token + 1)
  }, [ensureStateBucket])

  /** Point the field at another question's stored answer. */
  const adoptOtherTextFor = useCallback((questionText: string, states: Record<string, QuestionState>) => {
    otherTextRef.current = states[questionText]?.otherText ?? ''
    setOtherResetToken((token) => token + 1)
  }, [])

  const commitCurrent = useCallback((overrideIndex?: number): { values: string[]; preview?: string; otherUsed: boolean } | null => {
    if (!currentQuestion) return null
    const effectiveIndex = overrideIndex ?? focusedIndex
    const committingOther = effectiveIndex === currentQuestion.options.length
    const selected = state.selected
    const otherText = otherTextRef.current.trim()

    if (currentQuestion.multiSelect) {
      const values: string[] = []
      let otherUsed = false
      for (const [index, option] of currentQuestion.options.entries()) {
        if (selected.has(index)) {
          values.push(option.label)
        }
      }
      // Text in the Other field counts as selecting it: having to also tick a
      // box for something you just typed is the step this flow removes.
      if (otherText) {
        values.push(otherText)
        otherUsed = true
      }
      if (values.length === 0) return null
      return { values, otherUsed }
    }

    if (committingOther) {
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
    (finalStates: Record<string, QuestionState>) => {
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
        otherText: otherTextRef.current,
        confirmed: confirmedValue,
      },
    }
    setPerQuestionState(nextStates)

    if (currentIndex + 1 < record.questions.length) {
      const nextQuestion = record.questions[currentIndex + 1]
      setCurrentIndex(currentIndex + 1)
      setFocusedIndex(0)
      if (nextQuestion) {
        adoptOtherTextFor(nextQuestion.question, nextStates)
      }
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
    if (currentIndex === 0 || !record) return
    const previousQuestion = record.questions[currentIndex - 1]
    setCurrentIndex(currentIndex - 1)
    setFocusedIndex(0)
    if (previousQuestion) {
      adoptOtherTextFor(previousQuestion.question, perQuestionState)
    }
  }, [adoptOtherTextFor, currentIndex, perQuestionState, record])

  const toggleMultiSelectCurrent = useCallback(() => {
    if (!currentQuestion || !currentQuestion.multiSelect) return
    if (focusedIndex >= currentQuestion.options.length) return
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

  const handleKey = useCallback(
    (key: ParsedKey): boolean => {
      if (!record || !currentQuestion) return false

      // The Other row's input is live whenever the row is focused, so only the
      // keys that would otherwise be lost are intercepted here. Everything
      // else — digits, '?', space — must reach the field as typed text rather
      // than firing the shortcut it triggers on the other rows.
      if (isOtherFocused) {
        if (key.name === 'escape') {
          // Clear a draft first so a stray Esc cannot discard typing along
          // with the whole request.
          if (otherTextRef.current) {
            clearOtherText()
            return true
          }
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
          } else if (currentIndex + 1 < totalQuestions) {
            confirmAndAdvance()
          }
          return true
        }
        if (key.name === 'return') {
          confirmAndAdvance()
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
        } else if (currentIndex + 1 < totalQuestions) {
          confirmAndAdvance()
        }
        return true
      }
      if (key.name === 'space' && currentQuestion.multiSelect) {
        toggleMultiSelectCurrent()
        return true
      }
      if (key.name === 'return') {
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
      clearOtherText,
      goPrev,
      isOtherFocused,
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
    isOtherFocused,
    otherResetToken,
    showHelp,
    handleKey,
    handleOtherInput,
    submit: confirmAndAdvance,
    cancel: () => {
      if (record) onReject(record.id, 'User cancelled the question.')
    },
  }
}
