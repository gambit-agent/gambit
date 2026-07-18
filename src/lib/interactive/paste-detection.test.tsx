import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import { act } from 'react'
import type { MutableRefObject } from 'react'

import type { InteractiveHistory } from './history'
import { usePasteDetection } from './paste-detection'

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy()
  })
  testSetup = null
})

type PasteHandler = (event: FakePasteEvent) => void

class FakeKeyInput {
  handlers = new Set<PasteHandler>()
  on(_event: 'paste', handler: PasteHandler) {
    this.handlers.add(handler)
  }
  off(_event: 'paste', handler: PasteHandler) {
    this.handlers.delete(handler)
  }
  emitPaste(event: FakePasteEvent) {
    for (const handler of this.handlers) {
      handler(event)
    }
  }
}

class FakePasteEvent {
  bytes: Uint8Array
  defaultPrevented = false
  constructor(text: string) {
    this.bytes = new TextEncoder().encode(text)
  }
  preventDefault() {
    this.defaultPrevented = true
  }
}

function Harness({
  keyInput,
  enabled,
  values,
  previews,
}: {
  keyInput: FakeKeyInput
  enabled: boolean
  values: string[]
  previews: (string | null)[]
}) {
  const historyRef: MutableRefObject<InteractiveHistory | null> = { current: null }
  const suppressNextInputRef: MutableRefObject<boolean> = { current: false }
  usePasteDetection({
    renderer: { keyInput },
    inputPreview: null,
    setInputPreview: (next) => {
      previews.push(typeof next === 'function' ? next(null) : next)
    },
    setInputValueWithRef: (next) => {
      values.push(typeof next === 'function' ? next('') : next)
    },
    historyRef,
    suppressNextInputRef,
    enabled,
  })
  return <text content="harness" />
}

test('captures paste into the main input when enabled', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const previews: (string | null)[] = []

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={values} previews={previews} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent('sk-test-key')
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(true)
  expect(values).toEqual(['sk-test-key'])
  expect(previews).toEqual(['[Pasted Content 11 chars]'])
})

test('lets paste flow to the focused overlay input when disabled', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const previews: (string | null)[] = []

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled={false} values={values} previews={previews} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent('sk-test-key')
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(false)
  expect(values).toEqual([])
  expect(previews).toEqual([])
})
