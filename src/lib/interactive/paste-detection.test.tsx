import { afterEach, expect, test } from 'bun:test'
import type { PasteEvent } from '@opentui/core'
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

type PasteHandler = (event: PasteEvent) => void

type PasteControls = ReturnType<typeof usePasteDetection>

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
      handler(event as unknown as PasteEvent)
    }
  }
}

class FakePasteEvent {
  bytes: Uint8Array
  metadata?: { mimeType?: string; kind?: 'text' | 'binary' | 'unknown' }
  defaultPrevented = false
  constructor(value: string | Uint8Array, metadata?: FakePasteEvent['metadata']) {
    this.bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    this.metadata = metadata
  }
  preventDefault() {
    this.defaultPrevented = true
  }
}

function Harness({
  keyInput,
  enabled,
  values,
  controls,
  images = [],
}: {
  keyInput: FakeKeyInput
  enabled: boolean
  values: string[]
  controls?: MutableRefObject<PasteControls | null>
  images?: Array<{ bytes?: Uint8Array; mediaType?: string; path?: string }>
}) {
  const historyRef: MutableRefObject<InteractiveHistory | null> = { current: null }
  const suppressNextInputRef: MutableRefObject<boolean> = { current: false }
  const result = usePasteDetection({
    renderer: { keyInput },
    setInputValueWithRef: (next) => {
      const previous = values.at(-1) ?? ''
      values.push(typeof next === 'function' ? next(previous) : next)
    },
    historyRef,
    suppressNextInputRef,
    onImagePaste: (image) => images.push(image),
    enabled,
  })
  if (controls) {
    controls.current = result
  }
  return <text content="harness" />
}

test('keeps a short paste visible in the main input', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={values} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent('sk-test-key')
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(true)
  expect(values).toEqual(['sk-test-key'])
})

test('collapses a large explicit paste and preserves its source text', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const controls: MutableRefObject<PasteControls | null> = { current: null }
  const pasted = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={values} controls={controls} />,
    { width: 40, height: 4 },
  )

  const event = new FakePasteEvent(pasted)
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(true)
  expect(values).toEqual(['[Pasted text #1 +10 lines]'])
  expect(controls.current?.materializePastedText(values[0]!)).toBe(pasted)
})

test('collapses a large inferred paste inserted inside existing text', async () => {
  const keyInput = new FakeKeyInput()
  const controls: MutableRefObject<PasteControls | null> = { current: null }
  const pasted = 'x'.repeat(1_000)

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={[]} controls={controls} />,
    { width: 40, height: 4 },
  )

  const displayValue = controls.current?.compactInferredPaste('before  after', `before ${pasted} after`)
  expect(displayValue).toBe('before [Pasted text #1 +1000 chars] after')
  expect(controls.current?.materializePastedText(displayValue!)).toBe(`before ${pasted} after`)
})

test('lets paste flow to the focused overlay input when disabled', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled={false} values={values} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent('sk-test-key')
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(false)
  expect(values).toEqual([])
})

test('captures binary image paste as an attachment instead of text', async () => {
  const keyInput = new FakeKeyInput()
  const values: string[] = []
  const images: Array<{ bytes?: Uint8Array; mediaType?: string; path?: string }> = []
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  testSetup = await testRender(
    <Harness keyInput={keyInput} enabled values={values} images={images} />,
    { width: 20, height: 4 },
  )

  const event = new FakePasteEvent(png, { kind: 'binary', mimeType: 'image/png' })
  await act(async () => {
    keyInput.emitPaste(event)
  })

  expect(event.defaultPrevented).toBe(true)
  expect(values).toEqual([])
  expect(images[0]?.mediaType).toBe('image/png')
  expect(images[0]?.bytes).toEqual(png)
})
