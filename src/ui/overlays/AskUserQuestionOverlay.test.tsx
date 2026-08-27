import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { act, useEffect, useRef, type MutableRefObject } from 'react'
import { useKeyboard } from '@opentui/react'
import type { ParsedKey } from '@opentui/core'

import { AskUserQuestionOverlay, useAskUserQuestionController } from './AskUserQuestionOverlay'
import type { Question, QuestionAnswerBundle, QuestionRequestRecord } from '../../questions/question-types'

let setup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    setup?.renderer.destroy()
  })
  setup = null
})

function makeRecord(question: Question): QuestionRequestRecord {
  return {
    id: 'req-1',
    questions: [question],
    state: 'pending',
    createdAt: '2026-08-26T19:00:00.000Z',
  }
}

const SINGLE: Question = {
  question: 'Which approach?',
  header: 'Approach',
  multiSelect: false,
  options: [
    { label: 'Rewrite it', description: 'Start over' },
    { label: 'Patch it', description: 'Minimal change' },
  ],
}

const MULTI: Question = {
  question: 'Which features?',
  header: 'Features',
  multiSelect: true,
  options: [
    { label: 'Tables', description: 'Grid rendering' },
    { label: 'Diagrams', description: 'Mermaid' },
  ],
}

interface HarnessResult {
  resolved: QuestionAnswerBundle | null
  rejected: string | null
}

/**
 * The test renderer never dispatches a lone ESC byte as a key event — it is
 * ambiguous with the start of a CSI sequence — so keys the harness cannot
 * deliver are pushed straight into the controller instead.
 */
function pressSynthetic(controller: { handleKey: (key: ParsedKey) => boolean }, name: string): void {
  controller.handleKey({ name } as unknown as ParsedKey)
}

async function mountOverlay(question: Question) {
  const result: HarnessResult = { resolved: null, rejected: null }
  const controllerRef: MutableRefObject<{ handleKey: (key: ParsedKey) => boolean } | null> = { current: null }

  function Harness() {
    const controller = useAskUserQuestionController({
      record: makeRecord(question),
      onResolve: (_id, bundle) => {
        result.resolved = bundle
      },
      onReject: (_id, reason) => {
        result.rejected = reason
      },
    })

    controllerRef.current = controller

    // Mirrors how the REPL routes keys into the overlay.
    useKeyboard((key) => {
      controller.handleKey(key)
    })

    useEffect(() => {
      // Start focus on the Other row, which is the last one.
      for (let index = 0; index < question.options.length; index += 1) {
        controller.handleKey({ name: 'down' } as never)
      }
    }, [])

    return <AskUserQuestionOverlay controller={controller} hasFocus />
  }

  setup = await testRender(<Harness />, { width: 90, height: 26 })
  await setup.renderOnce()
  return { result, controllerRef }
}

test('focusing Other reveals its input without an extra keypress', async () => {
  await mountOverlay(SINGLE)

  const frame = setup!.captureCharFrame()
  expect(frame).toContain('Other')
  // The field is live as soon as the row has focus.
  expect(frame).toContain('Type your answer')
  expect(frame).toContain('Type your answer · Enter submits')
})

test('typing on the Other row goes into the field, digits included', async () => {
  const { result } = await mountOverlay(SINGLE)

  // '1' is the quick-pick shortcut on every other row; here it must be text.
  await act(async () => {
    await setup!.mockInput.typeText('plan 1 first')
  })
  await setup!.renderOnce()

  expect(setup!.captureCharFrame()).toContain('plan 1 first')
  expect(result.resolved).toBeNull()

  await act(async () => {
    setup!.mockInput.pressEnter()
  })

  expect(result.resolved?.answers['Which approach?']).toBe('plan 1 first')
})

test('arrow keys still leave the Other row while its input is live', async () => {
  const { result } = await mountOverlay(SINGLE)

  await act(async () => {
    await setup!.mockInput.typeText('typed')
    setup!.mockInput.pressArrow('up')
  })
  await setup!.renderOnce()

  // Focus moved to the last real option, so Enter picks that option.
  await act(async () => {
    setup!.mockInput.pressEnter()
  })

  expect(result.resolved?.answers['Which approach?']).toBe('Patch it')
})

test('escape clears a typed answer before it cancels the request', async () => {
  const { result, controllerRef } = await mountOverlay(SINGLE)

  await act(async () => {
    await setup!.mockInput.typeText('draft')
  })
  await setup!.renderOnce()
  expect(setup!.captureCharFrame()).toContain('draft')

  // First escape clears the draft rather than discarding the whole request.
  await act(async () => {
    pressSynthetic(controllerRef.current!, 'escape')
  })
  await setup!.renderOnce()
  expect(setup!.captureCharFrame()).not.toContain('draft')
  expect(result.rejected).toBeNull()

  await act(async () => {
    pressSynthetic(controllerRef.current!, 'escape')
  })
  expect(result.rejected).toBe('User cancelled the question.')
})

test('multi-select counts typed Other text as a selection', async () => {
  const { result } = await mountOverlay(MULTI)

  await act(async () => {
    await setup!.mockInput.typeText('a custom one')
  })
  await setup!.renderOnce()

  // The marker follows the field, so there is no separate box to tick.
  expect(setup!.captureCharFrame()).toContain('[✓]')

  await act(async () => {
    setup!.mockInput.pressEnter()
  })

  expect(result.resolved?.answers['Which features?']).toBe('a custom one')
})

test('space types into Other instead of toggling in multi-select', async () => {
  const { result } = await mountOverlay(MULTI)

  await act(async () => {
    await setup!.mockInput.typeText('two words')
  })
  await setup!.renderOnce()
  await act(async () => {
    setup!.mockInput.pressEnter()
  })

  expect(result.resolved?.answers['Which features?']).toBe('two words')
})
