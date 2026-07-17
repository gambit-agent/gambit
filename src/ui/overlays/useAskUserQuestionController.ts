import type { ParsedKey } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
  isInOther: boolean
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
    return currentQuestion.options.length + 1
  }, [currentQuestion])

  const ensureStateBucket = useCallback(
    (updater: (current: QuestionState) => QuestionState) => {
      setPerQuestionState((prev) => {
        const existing = prev[questionKey] ?? { selected: new Set<number>(), otherText: '' }
        return { ...prev, [questionKey]: updater(existing) }
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
        } else if (currentIndex + 1 < totalQuestions) {
          confirmAndAdvance()
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
