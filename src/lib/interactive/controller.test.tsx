import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockKeys } from '@opentui/core/testing'
import { testRender } from '@opentui/react/test-utils'
import { act, useState } from 'react'

import { setWorkspaceRootForTesting } from '../../config'
import { setUserGambitDirectoryForTesting } from '../../session/user-data-paths'
import type { UIMessage } from '../../types/chat'
import { useInteractiveController, type UseInteractiveControllerResult } from './controller'
import { loadUserHistoryEntries, resetSessionHistoryForTesting } from './sessionHistory'

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

/** Long enough for the key parser to stop waiting on a lone ESC. */
const ESCAPE_FLUSH_MS = 60

/**
 * Raw control bytes. The mock's `{ ctrl: true }` modifier sends an ESC-prefixed
 * sequence, which parses as Ctrl+Alt rather than the bare Ctrl a terminal sends.
 */
const CTRL_C = ''
const CTRL_D = ''
const CTRL_N = ''
const CTRL_P = ''

beforeEach(async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'gambit-controller-'))
  setWorkspaceRootForTesting(workspaceDir)
  setUserGambitDirectoryForTesting(workspaceDir)
  resetSessionHistoryForTesting()
})

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy()
  })
  testSetup = null
})

interface Harness {
  controller: UseInteractiveControllerResult
  /** Every value the composer was set to, oldest first. */
  inputValues: string[]
  /** Every value handed to `performSubmit`, oldest first. */
  submitted: string[]
  submittedCount: number
  aborts: number
  rewinds: number
  /** Drives real key events through the controller's keyboard handler. */
  press: (key: string) => Promise<void>
}

function Composer({
  harness,
  performSubmit,
}: {
  harness: Harness
  performSubmit: (value: string) => void
}) {
  const [inputValue, setInputValue] = useState('')
  const controller = useInteractiveController({
    inputValue,
    setInputValue,
    messages: [] as UIMessage[],
    setMessages: () => {},
    isRunning: false,
    performSubmit: async (value) => {
      performSubmit(value)
    },
    onSubmitted: () => {
      harness.submittedCount += 1
    },
    onAbort: () => {
      harness.aborts += 1
    },
    onRewind: () => {
      harness.rewinds += 1
    },
  })
  harness.controller = controller
  if (harness.inputValues.at(-1) !== inputValue) {
    harness.inputValues.push(inputValue)
  }
  return <text content="harness" />
}

async function mountHarness(): Promise<Harness> {
  const harness: Harness = {
    controller: null as unknown as UseInteractiveControllerResult,
    inputValues: [],
    submitted: [],
    submittedCount: 0,
    aborts: 0,
    rewinds: 0,
    press: async () => {},
  }
  testSetup = await testRender(
    <Composer harness={harness} performSubmit={(value) => harness.submitted.push(value)} />,
    { width: 40, height: 6 },
  )
  const keys = createMockKeys(testSetup.renderer)
  harness.press = async (key) => {
    await act(async () => {
      // A lone ESC byte is held as a possible escape-sequence prefix, so the
      // parser only emits it once the next input arrives or the read times
      // out; pressKeys' delay gives it that gap.
      await keys.pressKeys([key], key === 'ESCAPE' ? ESCAPE_FLUSH_MS : 0)
    })
  }
  return harness
}

/**
 * Waits for a fire-and-forget history write to land before the test recalls
 * it. Polls the persisted file rather than sleeping a fixed span: the write is
 * the last step after the in-memory `add`, so seeing it on disk proves recall
 * will find the entry.
 */
async function settleHistory(entry: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await loadUserHistoryEntries(50)).includes(entry)) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`History never recorded ${JSON.stringify(entry)}`)
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')
}

test('submits the source text behind a collapsed paste label', async () => {
  const harness = await mountHarness()
  const pasted = lines(12)

  let displayValue = ''
  await act(async () => {
    displayValue = harness.controller.handleInput('look at ')
    displayValue = harness.controller.handleInput(`look at ${pasted}`)
    displayValue = harness.controller.handleInput(`${displayValue} please`)
  })

  expect(displayValue).toBe('look at [Pasted text #1 +12 lines] please')

  await act(async () => {
    await harness.controller.handleSubmit(displayValue)
  })

  expect(harness.submitted).toEqual([`look at ${pasted} please`])
  expect(harness.inputValues.at(-1)).toBe('')
})

test('collapses a paste that fills the whole composer', async () => {
  const harness = await mountHarness()

  let displayValue = ''
  await act(async () => {
    displayValue = harness.controller.handleInput(lines(12))
  })

  expect(displayValue).toBe('[Pasted text #1 +12 lines]')
})

test('submits the label verbatim once the user has edited it', async () => {
  const harness = await mountHarness()

  let displayValue = ''
  await act(async () => {
    displayValue = harness.controller.handleInput(lines(12))
  })
  // Typing over the label breaks the token; the source text is dropped and
  // what is left on screen is what gets sent.
  const edited = displayValue.replace('Pasted', 'Edited')
  await act(async () => {
    harness.controller.handleInput(edited)
  })
  await act(async () => {
    await harness.controller.handleSubmit(edited)
  })

  expect(harness.submitted).toEqual([edited])
})

test('a backslash buried inside a collapsed paste still submits', async () => {
  const harness = await mountHarness()

  let displayValue = ''
  await act(async () => {
    displayValue = harness.controller.handleInput(`${lines(12)}\\`)
  })

  // The '\' is inside the blob, not on screen, so it must not be read as a
  // multi-line continuation the way a typed one is.
  const outcome = await act(async () => harness.controller.handleSubmit(displayValue))

  expect(outcome).toBe('submitted')
  expect(harness.submitted).toEqual([`${lines(12)}\\`])
})

test('a trailing backslash typed after the label opens a continuation', async () => {
  const harness = await mountHarness()

  let displayValue = ''
  await act(async () => {
    displayValue = harness.controller.handleInput(lines(12))
    displayValue = harness.controller.handleInput(`${displayValue}\\`)
  })

  const outcome = await act(async () => harness.controller.handleSubmit(displayValue))

  expect(outcome).toBe('continuation')
  expect(harness.submitted).toEqual([])
  // The label survives the continuation, so the paste can still be submitted.
  const continued = `${harness.inputValues.at(-1)}and now go`
  await act(async () => {
    await harness.controller.handleSubmit(continued)
  })
  expect(harness.submitted).toEqual([`${lines(12)}\nand now go`])
})

test('a drained follow-up submits without clearing the composer draft', async () => {
  const harness = await mountHarness()

  await act(async () => {
    harness.controller.handleInput('a draft typed while the run was going')
  })

  await act(async () => {
    await harness.controller.submitFollowUp(
      { value: 'queued follow-up', attachments: [] },
      { fromFollowUpDrain: true },
    )
  })

  expect(harness.submitted).toEqual(['queued follow-up'])
  expect(harness.inputValues.at(-1)).toBe('a draft typed while the run was going')
  // The conversation still scrolls to the drained submission.
  expect(harness.submittedCount).toBe(1)
})

test('Ctrl+C clears the draft before it arms an exit', async () => {
  const harness = await mountHarness()

  await act(async () => {
    harness.controller.handleInput('a draft I changed my mind about')
  })

  await harness.press(CTRL_C)

  expect(harness.inputValues.at(-1)).toBe('')
  // Clearing is not a step toward exiting: the next press starts fresh.
  expect(harness.controller.exitPending).toBe(false)
})

test('Ctrl+C on an empty composer arms the exit hint', async () => {
  const harness = await mountHarness()

  await harness.press(CTRL_C)

  expect(harness.controller.exitPending).toBe(true)
})

test('Ctrl+D with a draft is left to the textarea as delete-forward', async () => {
  const harness = await mountHarness()

  await act(async () => {
    harness.controller.handleInput('keep me')
  })
  await harness.press(CTRL_D)

  // Neither exiting nor clearing: the composer keeps its draft.
  expect(harness.inputValues.at(-1)).toBe('keep me')
  expect(harness.controller.exitPending).toBe(false)
})

test('Ctrl+D on an empty composer arms the exit hint', async () => {
  const harness = await mountHarness()

  await harness.press(CTRL_D)

  expect(harness.controller.exitPending).toBe(true)
})

test('double Esc clears the draft and records it in history', async () => {
  const harness = await mountHarness()

  await act(async () => {
    harness.controller.handleInput('draft worth recalling')
  })
  await harness.press('ESCAPE')
  await harness.press('ESCAPE')

  expect(harness.inputValues.at(-1)).toBe('')
  // Saved to history, so up-arrow brings it straight back.
  await settleHistory('draft worth recalling')
  await harness.press('ARROW_UP')
  expect(harness.inputValues.at(-1)).toBe('draft worth recalling')
})

test('double Esc on an empty composer rewinds instead of clearing', async () => {
  const harness = await mountHarness()

  await act(async () => {
    await harness.controller.handleSubmit('first prompt')
  })
  await harness.press('ESCAPE')
  await harness.press('ESCAPE')

  expect(harness.rewinds).toBe(1)
})

test('Ctrl+P and Ctrl+N walk history like the arrows', async () => {
  const harness = await mountHarness()

  await act(async () => {
    await harness.controller.handleSubmit('an earlier prompt')
  })
  await settleHistory('an earlier prompt')

  await harness.press(CTRL_P)
  expect(harness.inputValues.at(-1)).toBe('an earlier prompt')

  await harness.press(CTRL_N)
  expect(harness.inputValues.at(-1)).toBe('')
})
